import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env, Investor, Session } from "./env";
import { adminEmails, now, randomId, sha256 } from "./util";

export const LOGIN_TTL = 15 * 60 * 1000;
const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000;
const INVESTOR_SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_REQUESTS_PER_15_MIN = 5;

const secureOrigin = (env: Env) => env.APP_ORIGIN.startsWith("https://");
const cookieName = (env: Env) => (secureOrigin(env) ? "__Host-dataroom" : "dataroom");

export const isAdmin = (env: Env, email: string) => adminEmails(env.ADMIN_EMAILS).has(email.toLowerCase());

/** An investor who may use the room right now: invited, not revoked, not past their end date. */
export async function activeInvestor(env: Env, email: string): Promise<Investor | null> {
  return env.DB.prepare(
    "SELECT * FROM investors WHERE email = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
  )
    .bind(email, now())
    .first<Investor>();
}

export async function createLoginToken(env: Env, email: string): Promise<string> {
  const token = randomId(32);
  const t = now();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), email, t, t + LOGIN_TTL)
    .run();
  return token;
}

export async function recentLoginRequests(env: Env, email: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?")
    .bind(email, now() - LOGIN_TTL)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function tokenIsUsable(env: Env, token: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(await sha256(token), now())
    .first();
  return !!row;
}

/** Marks the token used in the same statement that reads it, so a link works exactly once. */
export async function consumeLoginToken(env: Env, token: string): Promise<string | null> {
  const t = now();
  const row = await env.DB.prepare(
    "UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email",
  )
    .bind(t, await sha256(token), t)
    .first<{ email: string }>();
  return row?.email ?? null;
}

export async function startSession(c: Context<AppEnv>, email: string, role: "admin" | "investor") {
  const id = randomId(32);
  const t = now();
  const ttl = role === "admin" ? ADMIN_SESSION_TTL : INVESTOR_SESSION_TTL;
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(id), email, role, t, t + ttl)
    .run();
  setCookie(c, cookieName(c.env), id, {
    path: "/",
    httpOnly: true,
    secure: secureOrigin(c.env),
    sameSite: "Lax",
    maxAge: Math.floor(ttl / 1000),
  });
}

export async function endSession(c: Context<AppEnv>) {
  const id = getCookie(c, cookieName(c.env));
  if (id) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(id)).run();
  deleteCookie(c, cookieName(c.env), { path: "/", secure: secureOrigin(c.env) });
}

/**
 * Loads the session on every request and re-checks the person behind it, so revoking an
 * investor, passing their end date or removing an admin email takes effect immediately.
 */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("session", null);
  const id = getCookie(c, cookieName(c.env));
  if (id) {
    const row = await c.env.DB.prepare("SELECT email, role FROM sessions WHERE id_hash = ? AND expires_at > ?")
      .bind(await sha256(id), now())
      .first<{ email: string; role: "admin" | "investor" }>();
    let session: Session | null = null;
    if (row?.role === "admin" && isAdmin(c.env, row.email)) session = { role: "admin", email: row.email };
    if (row?.role === "investor") {
      const investor = await activeInvestor(c.env, row.email);
      if (investor) session = { role: "investor", email: row.email, investor };
    }
    c.set("session", session);
  }
  await next();
};

/** Every form post must come from this site. Blocks cross-site form posts (CSRF). */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    const fetchSite = c.req.header("sec-fetch-site");
    const ok = origin && origin !== "null" ? origin === c.env.APP_ORIGIN : fetchSite === "same-origin";
    if (!ok) return c.text("Forbidden", 403);
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.get("session");
  if (!s) return c.redirect("/");
  if (s.role !== "admin") return c.text("Not found", 404);
  await next();
};
