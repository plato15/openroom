import { Hono, type Context, type MiddlewareHandler } from "hono";
import { html } from "hono/html";
import { fileForInvestor, orientationFor, serveFile } from "../access";
import type { AppEnv, FileRow, Folder, Investor } from "../env";
import { logEvent } from "../events";
import { messagePage, page } from "../layout";
import { safeNext } from "../links";
import { now, VIEWABLE_TYPES } from "../util";
import { roomBody, viewerBody, type RoomLinks } from "../views";

const INVESTOR_LINKS: RoomLinks = { room: "/room", file: (id) => `/d/${id}` };

export const investorRoutes = new Hono<AppEnv>();

// Everything here needs a live investor session. Admins use /admin.
const investorOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.get("session");
  // Signed out: sign in first, then come back to this document.
  if (!s) {
    const next = safeNext(c.req.path);
    return c.redirect(next ? `/?next=${encodeURIComponent(next)}` : "/");
  }
  if (s.role !== "investor") return c.redirect("/admin");
  await next();
};
investorRoutes.use("/room", investorOnly);
investorRoutes.use("/d/*", investorOnly);

export const investorOf = (c: { get: (k: "session") => unknown }) =>
  (c.get("session") as { investor: Investor }).investor;

investorRoutes.get("/room", async (c) => {
  const investor = investorOf(c);
  const [folders, files] = await Promise.all([
    c.env.DB.prepare(
      `SELECT f.* FROM folders f JOIN grants g ON g.folder_id = COALESCE(f.parent_id, f.id)
        WHERE g.investor_id = ? ORDER BY f.position, f.name COLLATE NOCASE`,
    )
      .bind(investor.id)
      .all<Folder>(),
    c.env.DB.prepare(
      `SELECT fi.* FROM files fi JOIN folders f ON f.id = fi.folder_id JOIN grants g ON g.folder_id = COALESCE(f.parent_id, f.id)
        WHERE g.investor_id = ? AND fi.published = 1 AND fi.placeholder = 0 ORDER BY fi.name COLLATE NOCASE`,
    )
      .bind(investor.id)
      .all<FileRow>(),
  ]);
  c.executionCtx.waitUntil(
    c.env.DB.prepare("UPDATE investors SET last_seen_at = ? WHERE id = ?").bind(now(), investor.id).run(),
  );
  return c.html(
    page({
      title: "Documents",
      session: c.get("session"),
      body: roomBody({ investor, folders: folders.results, files: files.results, links: INVESTOR_LINKS }),
    }),
  );
});

/** The document page for an investor, by id or link name. Used by /d/<ref> and by short links. */
export async function documentPage(c: Context<AppEnv>, ref: string) {
  const file = await fileForInvestor(c.env, investorOf(c).id, ref);
  if (!file) return notAvailable(c);
  return c.html(page({ title: file.name, session: c.get("session"), body: viewerBody(file, INVESTOR_LINKS, await orientationFor(c.env, file)) }));
}

/** One answer for anything an investor cannot open, so links give nothing away. */
export const notAvailable = (c: Context<AppEnv>) =>
  c.html(messagePage(c.get("session"), "Not found", "This document is not available to you."), 404);

investorRoutes.get("/d/:id", (c) => documentPage(c, c.req.param("id")));

investorRoutes.get("/d/:id/view", async (c) => {
  const s = c.get("session")!;
  const file = await fileForInvestor(c.env, investorOf(c).id, c.req.param("id"));
  if (!file || !VIEWABLE_TYPES.has(file.content_type)) return c.text("Not found", 404);
  await logEvent(c, { email: s.email, action: "view", fileId: file.id, fileName: file.name, folderName: file.folder_name });
  return serveFile(c, file, "inline", s.email);
});

investorRoutes.get("/d/:id/download", async (c) => {
  const s = c.get("session")!;
  const file = await fileForInvestor(c.env, investorOf(c).id, c.req.param("id"));
  if (!file || !file.allow_download) return c.text("Not found", 404);
  await logEvent(c, { email: s.email, action: "download", fileId: file.id, fileName: file.name, folderName: file.folder_name });
  return serveFile(c, file, "attachment", s.email);
});
