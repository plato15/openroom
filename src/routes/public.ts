import { Hono } from "hono";
import { safeNext } from "../links";
import { html } from "hono/html";
import {
  activeInvestor,
  consumeLoginToken,
  createLoginToken,
  endSession,
  isAdmin,
  LOGIN_REQUESTS_PER_15_MIN,
  recentLoginRequests,
  startSession,
  tokenIsUsable,
} from "../auth";
import { outbox, sendMail, signInMail } from "../email";
import { brand } from "../brand";
import type { AppEnv } from "../env";
import { logEvent } from "../events";
import { notice, page } from "../layout";
import { isLocalOrigin, normalizeEmail, now } from "../util";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/", (c) => {
  const s = c.get("session");
  const next = safeNext(c.req.query("next"));
  if (s) return c.redirect(next ?? (s.role === "admin" ? "/admin" : "/room"));
  return c.html(signInPage(undefined, next));
});

/** `next`: where the person was going (a document or folder link); they land there after signing in. */
function signInPage(error?: string, next?: string | null) {
  return page({
    title: "Sign in",
    narrow: true,
    body: html`<section class="hero">
        <p class="eyebrow">Investor access</p>
        <h1 class="display">${brand().roomName}</h1>
        <p class="lead">Enter the email address you were invited with. We will email you a link to sign in. No password needed.</p>
      </section>
      <section class="card">
        ${notice("error", error)}
        <form method="post" action="/login" class="stack">
          ${next ? html`<input type="hidden" name="next" value="${next}">` : ""}
          <label for="email">Email address</label>
          <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required autofocus placeholder="you@fund.com">
          <button type="submit" class="btn wide">Email me a sign-in link</button>
        </form>
      </section>`,
  });
}

publicRoutes.post("/login", async (c) => {
  const form = await c.req.parseBody();
  const email = normalizeEmail(form.email);
  const next = safeNext(form.next);
  if (!email) return c.html(signInPage("Please enter a valid email address.", next), 400);

  // Same answer whether or not the email is invited, so the page never reveals who is.
  let devLink: string | null = null;
  const eligible = (await isAdmin(c.env, email)) || !!(await activeInvestor(c.env, email));
  if (eligible && (await recentLoginRequests(c.env, email)) < LOGIN_REQUESTS_PER_15_MIN) {
    const token = await createLoginToken(c.env, email);
    const link = `${c.env.APP_ORIGIN}/auth?t=${encodeURIComponent(token)}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    if (c.env.ENVIRONMENT === "local" && isLocalOrigin(c.env.APP_ORIGIN)) devLink = link;
    const send = sendMail(c.env, signInMail(c.env.APP_ORIGIN, email, link)).then(async (ok) => {
      if (!ok) await logEvent(c, { email, action: "email_failed" });
    });
    c.executionCtx.waitUntil(send);
  }
  // Housekeeping: drop sign-in links and sessions that ended more than a day ago.
  const dayAgo = now() - 24 * 60 * 60 * 1000;
  c.executionCtx.waitUntil(
    c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(dayAgo),
      c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(dayAgo),
    ]),
  );

  return c.html(
    page({
      title: "Check your email",
      narrow: true,
      body: html`<section class="card center">
        <div class="mail-icon" aria-hidden="true">✉</div>
        <h1 class="h2">Check your email</h1>
        <p class="muted">If ${email} has access to the ${brand().roomName}, a sign-in link is on its way. It works once and expires in 15 minutes.</p>
        <p class="small muted">Nothing arrived after a few minutes? Check spam, or ask the person who invited you to confirm your email address.</p>
        ${devLink ? html`<p class="dev">Local mode: <a href="${devLink}">open sign-in link</a></p>` : ""}
        <p><a href="/" class="link">Use a different email</a></p>
      </section>`,
    }),
  );
});

/**
 * The emailed link lands here. It only shows a button: link scanners in mail systems open
 * links automatically, and a plain GET must not use up the one-time token.
 */
publicRoutes.get("/auth", async (c) => {
  const token = c.req.query("t") ?? "";
  const next = safeNext(c.req.query("next"));
  const usable = token.length > 20 && (await tokenIsUsable(c.env, token));
  if (!usable) return c.html(expiredPage(), 400);
  return c.html(
    page({
      title: "Sign in",
      narrow: true,
      body: html`<section class="card center">
        <h1 class="h2">Welcome</h1>
        <p class="muted">Continue to open the ${brand().roomName}.</p>
        <form method="post" action="/auth">
          <input type="hidden" name="t" value="${token}">
          ${next ? html`<input type="hidden" name="next" value="${next}">` : ""}
          <button type="submit" class="btn wide">Continue to the data room</button>
        </form>
      </section>`,
    }),
  );
});

function expiredPage() {
  return page({
    title: "Link expired",
    narrow: true,
    body: html`<section class="card center">
      <h1 class="h2">This link has expired</h1>
      <p class="muted">Sign-in links work once and last 15 minutes. Request a new one below.</p>
      <p><a class="btn" href="/">Get a new link</a></p>
    </section>`,
  });
}

publicRoutes.post("/auth", async (c) => {
  const form = await c.req.parseBody();
  const token = typeof form.t === "string" ? form.t : "";
  const email = token ? await consumeLoginToken(c.env, token) : null;
  if (!email) return c.html(expiredPage(), 400);

  if (await isAdmin(c.env, email)) {
    await startSession(c, email, "admin");
    await logEvent(c, { email, action: "sign_in" });
    return c.redirect(safeNext(form.next) ?? "/admin", 303);
  }
  if (await activeInvestor(c.env, email)) {
    await startSession(c, email, "investor");
    await logEvent(c, { email, action: "sign_in" });
    return c.redirect(safeNext(form.next) ?? "/room", 303);
  }
  return c.html(expiredPage(), 400);
});

publicRoutes.post("/logout", async (c) => {
  await endSession(c);
  return c.redirect("/", 303);
});

// Test-only peek at captured mail. Not mounted unless ENVIRONMENT is "test".
export const testRoutes = new Hono<AppEnv>();
testRoutes.get("/__test/outbox", (c) => c.json(outbox));
