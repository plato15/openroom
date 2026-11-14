import type { Context } from "hono";
import type { AppEnv, Env, FileRow, Folder } from "./env";
import { brand } from "./brand";

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
import { renderDoc, renderSheet, RENDERED_CSP, shell, stampPage } from "./render";
import { contentDisposition, viewKind, VIEWABLE_TYPES } from "./util";
import { orientationOf, watermarkPdf } from "./watermark";

export type FileWithFolder = FileRow & {
  folder_name: string;
  watermark: number;
};

/**
 * The one rule for what an investor can see. A file is visible only when it is published, sits
 * in a folder granted to this investor, and can either open in the browser or be downloaded.
 */
export function visibleToInvestor(file: Pick<FileRow, "published" | "content_type" | "allow_download"> & { placeholder?: number }) {
  return file.published === 1 && file.placeholder !== 1 && (file.allow_download === 1 || VIEWABLE_TYPES.has(file.content_type));
}

/**
 * Looks a file up through the investor's grants. Anything else comes back null, which callers
 * turn into a 404. A file in a subfolder is reached through the grant on its top-level folder.
 */
export async function fileForInvestor(env: Env, investorId: string, fileId: string): Promise<FileWithFolder | null> {
  const row = await env.DB.prepare(
    `SELECT fi.*, f.name AS folder_name, f.watermark
       FROM files fi
       JOIN folders f ON f.id = fi.folder_id
       JOIN grants g ON g.folder_id = COALESCE(f.parent_id, f.id) AND g.investor_id = ?1
      WHERE (fi.id = ?2 OR fi.slug = ?2) AND fi.published = 1 AND fi.placeholder = 0`,
  )
    .bind(investorId, fileId)
    .first<FileWithFolder>();
  if (!row || !visibleToInvestor(row)) return null;
  return row;
}

export async function fileForAdmin(env: Env, fileId: string): Promise<FileWithFolder | null> {
  return env.DB.prepare(
    `SELECT fi.*, f.name AS folder_name, f.watermark
       FROM files fi JOIN folders f ON f.id = fi.folder_id WHERE fi.id = ?1 OR fi.slug = ?1`,
  )
    .bind(fileId)
    .first<FileWithFolder>();
}

/**
 * Streams a file out of the private bucket.
 * - PDFs in stamped folders are stamped per viewer; a PDF that cannot be stamped is not served.
 * - Spreadsheets, CSV and Word files open as a rendered page (cached in R2), stamped the same way,
 *   served with scripts switched off.
 * - Everything else, and every download, goes out as an attachment.
 */
export async function serveFile(
  c: Context<AppEnv>,
  file: FileWithFolder,
  mode: "inline" | "attachment",
  stampFor: string | null,
): Promise<Response> {
  const kind = viewKind(file.content_type);
  const inline = mode === "inline" && kind !== null;
  const stamp = stampFor && file.watermark === 1 ? stampFor : null;

  if (inline && (kind === "sheet" || kind === "doc")) {
    const page = await renderedPage(c.env, file);
    if (!page)
      return new Response(
        shell(file.name, `<p class="empty" style="padding:24px;text-align:center">This document cannot be shown in the browser right now. Please let ${escapeHtml(brand().name)} know.</p>`).replace("<!--STAMP-->", ""),
        { status: 422, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": RENDERED_CSP, "cache-control": "no-store" } },
      );
    return new Response(stampPage(page, stamp, new Date()), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": RENDERED_CSP,
      },
    });
  }

  const obj = await c.env.FILES.get(file.r2_key);
  if (!obj) return c.text("Not found", 404);
  const headers = new Headers({
    // Only PDFs and plain images render natively in the browser; everything else is a download.
    "content-type": inline ? file.content_type : "application/octet-stream",
    "content-disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });

  if (stamp && file.content_type === "application/pdf") {
    try {
      const stamped = await watermarkPdf(await obj.arrayBuffer(), stamp, new Date(), brand().host);
      return new Response(stamped, { headers });
    } catch (err) {
      console.error(`watermark failed for file ${file.id}: ${(err as Error).message}`);
      return c.text(`This document cannot be shown right now. Please let ${brand().name} know.`, 422);
    }
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

const RENDER_VERSION = "v4"; // bump when the look of rendered pages changes: cached pages are rebuilt
export const renderKey = (fileId: string) => `previews/${fileId}.${RENDER_VERSION}.html`;

/** The rendered page for a spreadsheet, CSV or Word file, built once and kept in R2. */
async function renderedPage(env: Env, file: FileWithFolder): Promise<string | null> {
  const cached = await env.FILES.get(renderKey(file.id));
  if (cached) return cached.text();
  const obj = await env.FILES.get(file.r2_key);
  if (!obj) return null;
  try {
    const bytes = await obj.arrayBuffer();
    const body = viewKind(file.content_type) === "doc" ? await renderDoc(bytes) : renderSheet(bytes, file.content_type === "text/csv");
    const page = shell(file.name, body);
    await env.FILES.put(renderKey(file.id), page, { httpMetadata: { contentType: "text/html" } });
    return page;
  } catch (err) {
    console.error(`render failed for file ${file.id}: ${(err as Error).message}`);
    return null;
  }
}

/** Landscape or portrait from the first page, so slides show wide. Saved on the file the first time. */
export async function pdfOrientation(env: Env, file: FileWithFolder): Promise<"portrait" | "landscape"> {
  if (file.orientation) return file.orientation;
  let orientation: "portrait" | "landscape" = "portrait";
  try {
    const obj = await env.FILES.get(file.r2_key);
    if (obj) orientation = await orientationOf(await obj.arrayBuffer());
  } catch {
    // Unreadable PDFs fall back to portrait; serving them fails closed elsewhere.
  }
  await env.DB.prepare("UPDATE files SET orientation = ? WHERE id = ?").bind(orientation, file.id).run();
  return orientation;
}

export const orientationFor = (env: Env, file: FileWithFolder) =>
  file.content_type === "application/pdf" ? pdfOrientation(env, file) : Promise.resolve(null);

/** What goes in a file's address: its custom link if it has one, otherwise its random id. */
export const fileRef = (file: Pick<FileRow, "id" | "slug">) => file.slug || file.id;
