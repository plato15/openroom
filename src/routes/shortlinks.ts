import { Hono } from "hono";
import type { AppEnv } from "../env";
import { resolveLink, safeNext } from "../links";
import { documentPage, investorOf, notAvailable } from "./investor";

/**
 * Short links at the top level: /deck opens a file, /legal opens the room at a folder.
 * Mounted last, so the room's own pages always win; reserved names can never be links.
 */
export const shortLinkRoutes = new Hono<AppEnv>();

shortLinkRoutes.get("/:slug{[a-z0-9]+(?:-[a-z0-9]+)*}", async (c) => {
  const slug = c.req.param("slug");
  const next = safeNext(`/${slug}`);
  if (!next) return c.notFound();
  const session = c.get("session");
  if (!session) return c.redirect(`/?next=${encodeURIComponent(next)}`);

  const target = await resolveLink(c.env, slug);
  if (session.role === "admin") {
    if (target?.kind === "file") return c.redirect(`/admin/preview/f/${target.id}`);
    if (target?.kind === "folder") return c.redirect(`/admin#${target.id}`);
    return c.notFound();
  }

  if (target?.kind === "file") return documentPage(c, slug);
  if (target?.kind === "folder") {
    // The same access rule as files: the grant on the folder's top-level folder.
    const ok = await c.env.DB.prepare(
      `SELECT 1 FROM folders f JOIN grants g ON g.folder_id = COALESCE(f.parent_id, f.id) AND g.investor_id = ?
        WHERE f.id = ?`,
    )
      .bind(investorOf(c).id, target.id)
      .first();
    if (ok) return c.redirect(`/room#${target.id}`);
  }
  return notAvailable(c);
});
