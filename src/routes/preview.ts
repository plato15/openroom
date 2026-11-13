import { Hono } from "hono";
import type { Context } from "hono";
import { fileForAdmin, fileForInvestor, orientationFor, serveFile, visibleToInvestor, type FileWithFolder } from "../access";
import { requireAdmin } from "../auth";
import type { AppEnv, FileRow, Folder, Investor } from "../env";
import { messagePage, page } from "../layout";
import { VIEWABLE_TYPES } from "../util";
import { roomBody, viewerBody, type RoomLinks } from "../views";

/**
 * Preview: the admin sees the room exactly as investors do, on the same screens, with PDFs stamped.
 *   /admin/preview          everything an investor with every folder would see
 *   /admin/preview/i/:id    exactly what one investor sees
 *   /admin/preview/f/:id    one file on the investor viewer (works for hidden files too)
 * Nothing here is logged as investor activity.
 */
export const previewRoutes = new Hono<AppEnv>();
previewRoutes.use("/admin/preview", requireAdmin);
previewRoutes.use("/admin/preview/*", requireAdmin);

/** What the stamp says when the preview is not for a particular investor. */
const SAMPLE_STAMP = "investor@fund.com";

const allLinks: RoomLinks = { room: "/admin/preview", file: (id) => `/admin/preview/d/${id}` };
const investorLinks = (investorId: string): RoomLinks => ({
  room: `/admin/preview/i/${investorId}`,
  file: (id) => `/admin/preview/i/${investorId}/d/${id}`,
});
const fileLinks = (fileId: string, folderId: string): RoomLinks => ({ room: `/admin#${folderId}`, file: () => `/admin/preview/f/${fileId}` });

async function loadInvestor(c: Context<AppEnv>) {
  return c.env.DB.prepare("SELECT * FROM investors WHERE id = ?").bind(c.req.param("investorId")).first<Investor>();
}

function investorNote(i: Investor) {
  const who = i.name || i.email;
  if (i.revoked_at) return `This is what ${who} would see, but their access is revoked, so they cannot sign in.`;
  if (i.expires_at && i.expires_at <= Date.now()) return `This is what ${who} would see, but their access has ended, so they cannot sign in.`;
  return `This is exactly what ${who} sees. Nothing you open here is logged.`;
}

// ----- Everything visible -----

previewRoutes.get("/admin/preview", async (c) => {
  const [folders, files] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM folders ORDER BY position, name COLLATE NOCASE").all<Folder>(),
    c.env.DB.prepare("SELECT * FROM files WHERE published = 1 AND placeholder = 0 ORDER BY name COLLATE NOCASE").all<FileRow>(),
  ]);
  return c.html(
    page({
      title: "Preview",
      session: c.get("session"),
      preview: { text: "This is the room as an investor with every folder would see it. Each investor sees only their own folders.", back: "/admin" },
      body: roomBody({ investor: { name: "", firm: "", expires_at: null }, folders: folders.results, files: files.results, links: allLinks }),
    }),
  );
});

async function visibleFile(c: Context<AppEnv>): Promise<FileWithFolder | null> {
  const file = await fileForAdmin(c.env, c.req.param("fileId") ?? "");
  return file && visibleToInvestor(file) ? file : null;
}

previewRoutes.get("/admin/preview/d/:fileId", async (c) => {
  const file = await visibleFile(c);
  if (!file) return c.html(messagePage(c.get("session"), "Not found", "Investors cannot see this file.", "/admin/preview"), 404);
  return c.html(
    page({
      title: file.name,
      session: c.get("session"),
      preview: { text: `Documents show the stamp each investor gets (${SAMPLE_STAMP} stands in for their email).`, back: `/admin#${file.folder_id}` },
      body: viewerBody(file, allLinks, await orientationFor(c.env, file)),
    }),
  );
});
previewRoutes.get("/admin/preview/d/:fileId/view", async (c) => {
  const file = await visibleFile(c);
  if (!file || !VIEWABLE_TYPES.has(file.content_type)) return c.text("Not found", 404);
  return serveFile(c, file, "inline", SAMPLE_STAMP);
});
previewRoutes.get("/admin/preview/d/:fileId/download", async (c) => {
  const file = await visibleFile(c);
  if (!file || !file.allow_download) return c.text("Not found", 404);
  return serveFile(c, file, "attachment", SAMPLE_STAMP);
});

// ----- One investor -----

previewRoutes.get("/admin/preview/i/:investorId", async (c) => {
  const investor = await loadInvestor(c);
  if (!investor) return c.html(messagePage(c.get("session"), "Not found", "No such investor.", "/admin/investors"), 404);
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
  return c.html(
    page({
      title: "Preview",
      session: c.get("session"),
      preview: { text: investorNote(investor), back: `/admin/investors/${investor.id}` },
      body: roomBody({ investor, folders: folders.results, files: files.results, links: investorLinks(investor.id) }),
    }),
  );
});

async function investorFile(c: Context<AppEnv>) {
  const investor = await loadInvestor(c);
  if (!investor) return null;
  const file = await fileForInvestor(c.env, investor.id, c.req.param("fileId") ?? "");
  return file ? { investor, file } : null;
}

previewRoutes.get("/admin/preview/i/:investorId/d/:fileId", async (c) => {
  const found = await investorFile(c);
  if (!found) return c.html(messagePage(c.get("session"), "Not found", "This investor cannot see this file.", "/admin/investors"), 404);
  return c.html(
    page({
      title: found.file.name,
      session: c.get("session"),
      preview: { text: investorNote(found.investor), back: `/admin/investors/${found.investor.id}` },
      body: viewerBody(found.file, investorLinks(found.investor.id), await orientationFor(c.env, found.file)),
    }),
  );
});
previewRoutes.get("/admin/preview/i/:investorId/d/:fileId/view", async (c) => {
  const found = await investorFile(c);
  if (!found || !VIEWABLE_TYPES.has(found.file.content_type)) return c.text("Not found", 404);
  return serveFile(c, found.file, "inline", found.investor.email);
});
previewRoutes.get("/admin/preview/i/:investorId/d/:fileId/download", async (c) => {
  const found = await investorFile(c);
  if (!found || !found.file.allow_download) return c.text("Not found", 404);
  return serveFile(c, found.file, "attachment", found.investor.email);
});

// ----- One file, even if hidden -----

previewRoutes.get("/admin/preview/f/:fileId", async (c) => {
  const file = await fileForAdmin(c.env, c.req.param("fileId"));
  if (!file) return c.html(messagePage(c.get("session"), "Not found", "This file no longer exists.", "/admin"), 404);
  const note = !file.published
    ? "This file is Hidden, so investors cannot see it yet. This is how it will look once you make it visible."
    : !visibleToInvestor(file)
      ? "Investors cannot see this file: it cannot open in the browser and downloading is off for it."
      : `This is how investors see this file. Documents show their stamp (${SAMPLE_STAMP} stands in for their email).`;
  return c.html(
    page({
      title: file.name,
      session: c.get("session"),
      preview: { text: note, back: `/admin#${file.folder_id}` },
      body: viewerBody(file, fileLinks(file.id, file.folder_id), await orientationFor(c.env, file)),
    }),
  );
});
previewRoutes.get("/admin/preview/f/:fileId/view", async (c) => {
  const file = await fileForAdmin(c.env, c.req.param("fileId"));
  if (!file || !VIEWABLE_TYPES.has(file.content_type)) return c.text("Not found", 404);
  return serveFile(c, file, "inline", SAMPLE_STAMP);
});
previewRoutes.get("/admin/preview/f/:fileId/download", async (c) => {
  const file = await fileForAdmin(c.env, c.req.param("fileId"));
  if (!file || !file.allow_download) return c.text("Not found", 404);
  return serveFile(c, file, "attachment", SAMPLE_STAMP);
});
