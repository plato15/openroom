import type { Env } from "./env";
import { isSlug } from "./util";

/**
 * Short links: dataroom.example.com/deck opens a file, /legal opens the room at a folder.
 * Files and folders share one set of names. A link is only a nicer address: every open still
 * goes through the access checks, and a link to something you cannot see looks exactly like a
 * link that does not exist.
 */

/** Names the room uses itself, or may later. Never available as a link. */
export const RESERVED = new Set([
  "admin", "room", "login", "logout", "auth", "setup", "static", "brand", "theme", "robots", "favicon",
  "d", "f", "s", "api", "app", "assets", "settings", "investors", "investor", "preview", "files", "folders",
  "templates", "activity", "documents", "help", "support", "docs", "about", "privacy", "terms", "account",
  "signin", "sign-in", "signup", "sign-up", "home", "index", "health", "status", "download", "view", "www",
  "mail", "email", "null", "undefined", "test",
]);

export type LinkCheck = "ok" | "invalid" | "reserved" | "taken";

/** Whether a name can be a link for this file or folder (or is already its own). */
export async function checkLink(env: Env, slug: string, own: { file?: string; folder?: string }): Promise<LinkCheck> {
  if (!isSlug(slug)) return "invalid";
  if (RESERVED.has(slug)) return "reserved";
  const taken = await env.DB.prepare(
    `SELECT 1 FROM files WHERE (slug = ?1 OR id = ?1) AND id != ?2
     UNION ALL SELECT 1 FROM folders WHERE (slug = ?1 OR id = ?1) AND id != ?3 LIMIT 1`,
  )
    .bind(slug, own.file ?? "", own.folder ?? "")
    .first();
  return taken ? "taken" : "ok";
}

/** What a short link points at, before any access check. */
export async function resolveLink(env: Env, slug: string): Promise<{ kind: "file"; id: string } | { kind: "folder"; id: string } | null> {
  const file = await env.DB.prepare("SELECT id FROM files WHERE slug = ?").bind(slug).first<{ id: string }>();
  if (file) return { kind: "file", id: file.id };
  const folder = await env.DB.prepare("SELECT id FROM folders WHERE slug = ?").bind(slug).first<{ id: string }>();
  return folder ? { kind: "folder", id: folder.id } : null;
}

/**
 * Where to go after signing in. Only the room's own document and folder addresses are accepted,
 * so a crafted link can never send someone to another site.
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^\/(?:d\/([A-Za-z0-9_-]{3,64})|([a-z0-9]+(?:-[a-z0-9]+)*))$/);
  if (!m) return null;
  if (m[2] && (RESERVED.has(m[2]) || !isSlug(m[2]))) return null;
  return value;
}
