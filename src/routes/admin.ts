import { Hono, type MiddlewareHandler } from "hono";
import { html } from "hono/html";
import { fileForAdmin, fileRef, orientationFor, renderKey, serveFile, visibleToInvestor } from "../access";
import { documentFrame } from "../views";
import { brandingRoutes } from "./branding";
import { isAdmin } from "../auth";
import { inviteMail, sendMail } from "../email";
import type { AppEnv, FileRow, Folder, Investor } from "../env";
import { messagePage, notice, page, updateNotice } from "../layout";
import {
  dateInputValue,
  fileKind,
  formatDate,
  formatDateTime,
  formatSize,
  looksInternal,
  normalizeEmail,
  now,
  parseDateInput,
  randomId,
  detectContentType,
  VIEWABLE_TYPES,
  viewKind,
  slugify,
  isSlug,
} from "../util";
import { canWatermark, orientationOf } from "../watermark";
import { checkLink } from "../links";
import { availableUpdate } from "../updates";
import { VERSION } from "../version";

export const adminRoutes = new Hono<AppEnv>();
const MAX_UPLOAD = 50 * 1024 * 1024;

const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.get("session");
  if (!s) return c.redirect("/");
  if (s.role !== "admin") return c.text("Not found", 404);
  await next();
};
adminRoutes.use("/admin", adminOnly);
adminRoutes.use("/admin/*", adminOnly);
adminRoutes.route("/", brandingRoutes);

/** Flash messages are fixed strings picked by code, so nothing from the URL is echoed back. */
const MESSAGES: Record<string, [kind: "ok" | "error", text: string]> = {
  folder_created: ["ok", "Folder created."],
  folder_saved: ["ok", "Folder saved."],
  folder_deleted: ["ok", "Deleted."],
  heading_removed: ["ok", "Heading removed. Its files are now directly in the folder."],
  folder_not_empty: ["error", "Move or delete the files and subfolders in this folder first."],
  subfolder_created: ["ok", "Subfolder added."],
  template_added: ["ok", "Folders added. Upload your own version over each placeholder marked To replace."],
  placeholder_publish: ["error", "This is a placeholder. Upload your own version first; it becomes visible then."],
  replaced_placeholder: ["ok", "Uploaded. Investors with access to this folder can see it now."],
  folder_name: ["error", "Give the folder a name."],
  uploaded: ["ok", "Upload finished."],
  upload_none: ["error", "Choose at least one file."],
  file_saved: ["ok", "File saved."],
  file_deleted: ["ok", "File deleted."],
  slug_saved: ["ok", "Link saved. Use the copy icon next to the name to share it."],
  slug_cleared: ["ok", "Link removed."],
  slug_invalid: ["error", "Links use 3 to 60 lowercase letters, numbers and hyphens, like pitch-deck."],
  slug_taken: ["error", "Another file or folder already uses that link. Pick a different one."],
  slug_reserved: ["error", "That name is used by the room itself. Pick a different one."],
  replaced: ["ok", "New version uploaded. Same link, same access, same history."],
  replace_none: ["error", "Choose the new version of the file first."],
  replace_bad: ["error", "That file could not be used: it is over 50 MB, or a PDF that cannot be stamped (for example password protected)."],
  file_internal: ["error", "This file name says it is a draft or internal, so it stays hidden. Rename it first if it is ready for investors."],
  investor_added: ["ok", "Investor added."],
  investor_added_invited: ["ok", "Investor added and invite sent."],
  investor_saved: ["ok", "Changes saved."],
  investor_exists: ["error", "That email is already in the list."],
  investor_email: ["error", "Enter a valid email address."],
  investor_is_admin: ["error", "That email is an admin email."],
  invite_sent: ["ok", "Invite sent."],
  invite_failed: ["error", "The invite email could not be sent. Check the email settings (see README, Email)."],
  revoked: ["ok", "Access revoked. They are signed out everywhere."],
  restored: ["ok", "Access restored."],
  investor_deleted: ["ok", "Investor removed."],
  request_approved: ["ok", "Request approved and invite sent."],
  request_approved_quiet: ["ok", "Request approved. No invite was sent; send one from their page when ready."],
  request_declined: ["ok", "Request declined. Nothing was sent to them."],
  request_is_admin: ["error", "That email is an admin email."],
};
function flash(c: { req: { query: (k: string) => string | undefined } }) {
  const code = c.req.query("m");
  const m = code ? MESSAGES[code] : undefined;
  const extra =
    code === "uploaded"
      ? ` ${Number(c.req.query("n") ?? 0)} added${Number(c.req.query("held") ?? 0) ? `, ${Number(c.req.query("held"))} kept hidden (draft or internal name)` : ""}${Number(c.req.query("bad") ?? 0) ? `, ${Number(c.req.query("bad"))} refused (over 50 MB, or a PDF that cannot be watermarked, such as password protected)` : ""}.`
      : "";
  return m ? notice(m[0], m[1] + extra) : "";
}

const checked = (on: unknown) => (on ? "checked" : "");
const on = (v: unknown) => v === "on" || v === "1" || v === "true";
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function investorStatus(i: Investor): [label: string, cls: string] {
  if (i.revoked_at) return ["Revoked", "red"];
  if (i.expires_at && i.expires_at <= now()) return ["Expired", "grey"];
  if (!i.last_seen_at) return ["Invited", "blue"];
  return ["Active", "green"];
}

/** Optional short link for a file (/deck). Access is still checked on every open, so a readable link gives nothing away. */
function slugForm(file: FileRow, back?: "file") {
  return html`<form method="post" action="/admin/files/${file.id}" class="stack tight">
    <input type="hidden" name="action" value="slug">
    ${back ? html`<input type="hidden" name="back" value="file">` : ""}
    <label class="small">Short link
      <span class="slug-input"><span class="prefix">/</span><input name="slug" value="${file.slug ?? ""}" maxlength="60" placeholder="${slugify(file.name.replace(/\.[a-z0-9]+$/i, "")) || "pitch-deck"}" autocapitalize="off" spellcheck="false"></span>
    </label>
    <button class="btn small ghost" type="submit">Save link</button>
  </form>`;
}

/** Short link for a folder (/legal): opens the room at that folder. Empty removes it. */
function folderLinkForm(folder: Folder) {
  return html`<form method="post" action="/admin/folders/${folder.id}/link" class="stack tight">
    <label class="small">Short link
      <span class="slug-input"><span class="prefix">/</span><input name="slug" value="${folder.slug ?? ""}" maxlength="60" placeholder="${slugify(folder.name.replace(/^\d+\.\s*/, "")) || "legal"}" autocapitalize="off" spellcheck="false"></span>
    </label>
    <button class="btn small ghost" type="submit">Save link</button>
  </form>`;
}

/** A small copy icon, shown before a name. It copies the full short link; hovering shows the path. */
function linkChip(slug: string | null, label = "this") {
  if (!slug) return "";
  return html`<button type="button" class="copy-icon" data-copy="/${slug}" title="Copy link: /${slug}" aria-label="Copy the link to ${label}"><svg class="i-copy" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><svg class="i-check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>`;
}

/** Upload a new version in place: same id, link, folder, visibility, download setting and history. */
function replaceForm(file: FileRow, back?: "file") {
  return html`<form method="post" action="/admin/files/${file.id}/replace" enctype="multipart/form-data" class="stack tight">
    ${back ? html`<input type="hidden" name="back" value="file">` : ""}
    <label class="small">Replace with a new version
      <input type="file" name="file" required>
    </label>
    <button class="btn small" type="submit">Upload new version</button>
  </form>`;
}

/** One-click Download switch for a file. Off by default: investors only view in the browser. */
function downloadSwitch(file: FileRow, back?: "file") {
  const isOn = file.allow_download === 1;
  return html`<form method="post" action="/admin/files/${file.id}" class="switch-form">
    <input type="hidden" name="action" value="${isOn ? "download_off" : "download_on"}">
    ${back ? html`<input type="hidden" name="back" value="file">` : ""}
    <button type="submit" class="switch ${isOn ? "on" : ""}" role="switch" aria-checked="${isOn ? "true" : "false"}"
      title="${isOn ? "Investors can download this file. Click to make it view only." : "View only. Click to let investors download this file."}">
      <span class="knob" aria-hidden="true"></span>Download
    </button>
  </form>`;
}

// ---------- Documents ----------

adminRoutes.get("/admin", async (c) => {
  const db = c.env.DB;
  const update = await availableUpdate(c.env, (p) => c.executionCtx.waitUntil(p));
  const [folders, files, grants, stats] = await Promise.all([
    db.prepare("SELECT * FROM folders ORDER BY position, name COLLATE NOCASE").all<Folder>(),
    db.prepare("SELECT * FROM files ORDER BY name COLLATE NOCASE").all<FileRow>(),
    db
      .prepare(
        `SELECT g.folder_id, i.id, i.name, i.email FROM grants g JOIN investors i ON i.id = g.investor_id
          WHERE i.revoked_at IS NULL ORDER BY i.name COLLATE NOCASE`,
      )
      .all<{ folder_id: string; id: string; name: string; email: string }>(),
    db
      .prepare(
        `SELECT file_id, COUNT(*) AS opens, COUNT(DISTINCT email) AS people FROM events
          WHERE action IN ('view', 'download') AND file_id IS NOT NULL GROUP BY file_id`,
      )
      .all<{ file_id: string; opens: number; people: number }>(),
  ]);
  const statsById = new Map(stats.results.map((s) => [s.file_id, s]));
  const allFolders = folders.results;
  const topFolders = allFolders.filter((f) => !f.parent_id);

  return c.html(
    page({
      title: "Documents",
      session: c.get("session"),
      nav: "documents",
      body: html`${updateNotice(update, VERSION)}${flash(c)}
        <section class="row-between">
          <div>
            <h1 class="h2">Documents</h1>
            <p class="muted small">Investors see a folder only when you give them access to it, and only files marked Visible.</p>
          </div>
          <span class="actions">
            ${topFolders.length > 1
              ? html`<span class="fold-all" hidden>
                  <button type="button" class="link-btn small" data-fold-all="close">Collapse all</button>
                  <button type="button" class="link-btn small" data-fold-all="open">Expand all</button>
                </span>`
              : ""}
            <a class="btn ghost" href="/admin/preview">Preview</a>
          </span>
        </section>
        <details class="card add">
          <summary class="btn">New folder</summary>
          <form method="post" action="/admin/folders" class="stack">
            <label>Name <input name="name" required maxlength="80" placeholder="Corporate documents"></label>
            <label>Short description (investors see this) <input name="description" maxlength="200" placeholder="Certificate of incorporation, bylaws, subsidiaries"></label>
            <label class="check"><input type="checkbox" name="watermark" checked> Stamp PDFs with the investor's email</label>
            <button class="btn" type="submit">Create folder</button>
          </form>
        </details>
        ${allFolders.length === 0
          ? html`<section class="card center">
              <p class="muted">No folders yet. Start from a ready-made set of folders, or create your own.</p>
              <p><a class="btn" href="/admin/templates">Start from a template</a></p>
            </section>`
          : ""}
        ${topFolders.map((folder) => {
          const subs = allFolders.filter((f) => f.parent_id === folder.id);
          const inFolder = (id: string) => files.results.filter((f) => f.folder_id === id);
          const everyFile = [folder, ...subs].flatMap((f) => inFolder(f.id));
          const real = everyFile.filter((f) => !f.placeholder);
          const toReplace = everyFile.length - real.length;
          const people = grants.results.filter((g) => g.folder_id === folder.id);
          const downloadable = real.filter((f) => f.allow_download === 1).length;
          const shared = !people.length
            ? "Not shared"
            : people.length <= 2
              ? `Shared with ${people.map((p) => p.name || p.email).join(", ")}`
              : `Shared with ${people.length} investors`;
          const rows = (list: FileRow[], where: Folder) => fileRows(list, where, allFolders, statsById);
          // A folder folds up to its header line; the browser remembers which (see app.js).
          return html`<details class="card folder fold" id="${folder.id}" open data-fold>
            <summary class="folder-head" title="Fold or unfold this folder">
              <span class="fold-arrow" aria-hidden="true"></span>
              <div class="folder-icon" aria-hidden="true"></div>
              <div class="folder-title">
                <h2 class="h3">${linkChip(folder.slug, folder.name)}${folder.name} <span class="count">${real.length} ${real.length === 1 ? "file" : "files"}</span></h2>
                ${folder.description ? html`<p class="small muted">${folder.description}</p>` : ""}
              </div>
              <div class="folder-tags">
                ${toReplace ? html`<span class="tag amber">${toReplace} to replace</span>` : ""}
                <span class="tag ${downloadable ? "blue" : "grey"}">${downloadable ? `${downloadable} downloadable` : "View only"}</span>
                <span class="tag ${folder.watermark ? "navy" : "grey"}">${folder.watermark ? "PDFs stamped" : "No stamp"}</span>
                <span class="tag ${people.length ? "green" : "grey"}" title="${people.map((p) => p.name || p.email).join(", ")}">${shared}</span>
              </div>
            </summary>
            <div class="folder-body">
              ${inFolder(folder.id).length
                ? rows(inFolder(folder.id), folder)
                : subs.length
                  ? ""
                  : html`<p class="muted small empty">No files yet. Upload the first one below.</p>`}
              ${subs.map(
                (sub) => html`<div class="subfolder admin" id="${sub.id}">
                  <div class="subfolder-head">
                    <h3 class="subfolder-title">${linkChip(sub.slug, sub.name)}${sub.name}</h3>
                    <span class="subfolder-actions">
                    <details class="menu">
                      <summary class="link-btn small">Add files</summary>
                      <div class="menu-body">
                        <form method="post" action="/admin/folders/${sub.id}/upload" enctype="multipart/form-data" class="stack tight">
                          <input type="file" name="files" multiple required aria-label="Files to upload to ${sub.name}">
                          <label class="check small"><input type="checkbox" name="publish" checked> Visible now</label>
                          <button class="btn small" type="submit">Upload</button>
                        </form>
                      </div>
                    </details>
                    <details class="menu">
                      <summary class="link-btn small">Subfolder</summary>
                      <div class="menu-body stack">
                        <form method="post" action="/admin/folders/${sub.id}" class="inline-form">
                          <input name="name" value="${sub.name}" required maxlength="80" aria-label="Subfolder name">
                          <input type="hidden" name="position" value="${sub.position}">
                          <input type="hidden" name="description" value="${sub.description}">
                          ${sub.watermark ? html`<input type="hidden" name="watermark" value="on">` : ""}
                          <button class="btn small ghost" type="submit">Rename</button>
                        </form>
                        ${folderLinkForm(sub)}
                        <form method="post" action="/admin/folders/${sub.id}/ungroup" data-confirm="Remove the heading ${sub.name}? Its files stay in ${folder.name}.">
                          <button class="btn small ghost wide" type="submit">Remove heading, keep files</button>
                        </form>
                        <a class="btn small danger wide" href="/admin/folders/${sub.id}/delete">Delete subfolder and its files</a>
                      </div>
                    </details>
                    </span>
                  </div>
                  ${inFolder(sub.id).length ? rows(inFolder(sub.id), sub) : html`<p class="muted small empty">Empty.</p>`}
                </div>`,
              )}
              <div class="folder-foot">
                <form method="post" action="/admin/folders/${folder.id}/upload" enctype="multipart/form-data" class="upload">
                  <input type="file" name="files" multiple required aria-label="Files to upload to ${folder.name}">
                  <label class="check small"><input type="checkbox" name="publish" checked> Visible now</label>
                  <label class="check small"><input type="checkbox" name="allow_download"> Downloadable</label>
                  <button class="btn small" type="submit">Upload</button>
                </form>
                <details class="settings">
                  <summary class="link-btn">New subfolder</summary>
                  <div class="settings-body">
                    <form method="post" action="/admin/folders" class="inline-form">
                      <input type="hidden" name="parent_id" value="${folder.id}">
                      <input name="name" required maxlength="80" placeholder="Board minutes" aria-label="Subfolder name">
                      <button class="btn small" type="submit">Add subfolder</button>
                    </form>
                  </div>
                </details>
                <details class="settings">
                  <summary class="link-btn">Folder settings</summary>
                  <div class="settings-body">
                    <form method="post" action="/admin/folders/${folder.id}" class="stack">
                      <div class="two">
                        <label>Name <input name="name" value="${folder.name}" required maxlength="80"></label>
                        <label>Order (lower shows first) <input name="position" type="number" value="${folder.position}" min="0" max="999"></label>
                      </div>
                      <label>Short description <input name="description" value="${folder.description}" maxlength="200"></label>
                      <label class="check"><input type="checkbox" name="watermark" ${checked(folder.watermark)}> Stamp PDFs with the investor's email</label>
                      <div class="actions">
                        <button class="btn small" type="submit">Save folder</button>
                      </div>
                    </form>
                    ${folderLinkForm(folder)}
                    <p class="settings-delete"><a class="link-btn danger-text" href="/admin/folders/${folder.id}/delete">Delete folder…</a></p>
                  </div>
                </details>
              </div>
            </div>
          </details>`;
        })}`,
    }),
  );
});

/** Where a folder sits, for menus: "Legal / Cap table". */
const folderLabel = (f: Folder, all: Folder[]) => {
  const parent = f.parent_id ? all.find((p) => p.id === f.parent_id) : null;
  return parent ? `${parent.name} / ${f.name}` : f.name;
};

function fileRows(list: FileRow[], folder: Folder, allFolders: Folder[], statsById: Map<string, { opens: number; people: number }>) {
  return html`<ul class="files admin">
    ${list.map((file) => {
      const s = statsById.get(file.id);
      if (file.placeholder) {
        // A template placeholder: the one thing to do is upload the real document over it.
        return html`<li class="file-row placeholder-row">
          <span class="kind kind-${fileKind(file.content_type, file.name).toLowerCase()}">${fileKind(file.content_type, file.name)}</span>
          <span class="file-main">
            <span class="file-name">${file.name}</span>
            <span class="file-meta">Placeholder. Upload your own version; investors never see this one.${file.slug ? ` Its link will be /${file.slug}.` : ""}</span>
          </span>
          <span class="row-actions">
            <span class="badge amber">To replace</span>
            <form method="post" action="/admin/files/${file.id}/replace" enctype="multipart/form-data" class="replace-inline">
              <label class="btn small">Upload your version<input type="file" name="file" required data-autosubmit aria-label="Your version of ${file.name}"></label>
            </form>
            <form method="post" action="/admin/files/${file.id}/delete" data-confirm="Remove the placeholder ${file.name}?">
              <button class="link-btn small" type="submit">Remove</button>
            </form>
          </span>
        </li>`;
      }
      const hiddenByType = file.published === 1 && !visibleToInvestor(file);
      return html`<li class="file-row">
        <span class="kind kind-${fileKind(file.content_type, file.name).toLowerCase()}">${fileKind(file.content_type, file.name)}</span>
        <span class="file-main">
          <span class="file-title">${linkChip(file.slug, file.name)}<a class="file-name" href="/admin/preview/f/${file.id}">${file.name}</a></span>
          <span class="file-meta">
            ${formatSize(file.size)} · ${formatDate(file.updated_at)} ·
            <a href="/admin/files/${file.id}">${s ? `${s.opens} ${s.opens === 1 ? "open" : "opens"} by ${s.people} ${s.people === 1 ? "person" : "people"}` : "Not opened yet"}</a>
          </span>
          ${hiddenByType
            ? html`<span class="file-warn">Investors cannot see this: ${fileKind(file.content_type, file.name)} files cannot open in the browser and Download is off. Upload a PDF export, or turn Download on.</span>`
            : !viewKind(file.content_type)
              ? html`<span class="file-hint">Opens only as a download. Upload a PDF export if investors should read it in the browser.</span>`
              : ""}
        </span>
        <span class="row-actions">
          ${downloadSwitch(file)}
          <span class="badge ${file.published ? "green" : "grey"}">${file.published ? "Visible" : "Hidden"}</span>
          <a class="link-btn" href="/admin/preview/f/${file.id}">Preview</a>
          <details class="menu">
            <summary class="link-btn">Edit</summary>
            <div class="menu-body stack">
              <form method="post" action="/admin/files/${file.id}">
                <input type="hidden" name="action" value="${file.published ? "hide" : "publish"}">
                <button class="btn small wide ${file.published ? "ghost" : ""}" type="submit">${file.published ? "Hide from investors" : "Make visible"}</button>
              </form>
              <form method="post" action="/admin/files/${file.id}" class="inline-form">
                <input type="hidden" name="action" value="rename">
                <input name="name" value="${file.name}" maxlength="160" aria-label="File name">
                <button class="btn small ghost" type="submit">Rename</button>
              </form>
              ${slugForm(file)}
              ${replaceForm(file)}
              ${allFolders.length > 1
                ? html`<form method="post" action="/admin/files/${file.id}" class="inline-form">
                    <input type="hidden" name="action" value="move">
                    <select name="folder_id" aria-label="Move to folder">
                      ${allFolders.map((f) => html`<option value="${f.id}" ${f.id === folder.id ? "selected" : ""}>${folderLabel(f, allFolders)}</option>`)}
                    </select>
                    <button class="btn small ghost" type="submit">Move</button>
                  </form>`
                : ""}
              <form method="post" action="/admin/files/${file.id}/delete" data-confirm="Delete ${file.name}? This cannot be undone.">
                <button class="btn small danger wide" type="submit">Delete file</button>
              </form>
            </div>
          </details>
        </span>
      </li>`;
    })}
  </ul>`;
}

adminRoutes.post("/admin/folders", async (c) => {
  const form = await c.req.parseBody();
  const name = str(form.name, 80);
  if (!name) return c.redirect("/admin?m=folder_name", 303);
  // A subfolder goes inside a top-level folder only (one level deep) and takes its stamp setting.
  const parentId = str(form.parent_id, 64);
  const parent = parentId
    ? await c.env.DB.prepare("SELECT * FROM folders WHERE id = ? AND parent_id IS NULL").bind(parentId).first<Folder>()
    : null;
  if (parentId && !parent) return c.text("Not found", 404);
  const max = await c.env.DB.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM folders").first<{ p: number }>();
  const id = randomId();
  await c.env.DB.prepare(
    "INSERT INTO folders (id, name, description, position, watermark, created_at, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, name, str(form.description), (max?.p ?? 0) + 10, parent ? parent.watermark : on(form.watermark) ? 1 : 0, now(), parent?.id ?? null)
    .run();
  return c.redirect(parent ? `/admin?m=subfolder_created#${id}` : "/admin?m=folder_created", 303);
});

adminRoutes.post("/admin/folders/:id", async (c) => {
  const form = await c.req.parseBody();
  const name = str(form.name, 80);
  if (!name) return c.redirect("/admin?m=folder_name", 303);
  const position = Math.max(0, Math.min(999, Number(form.position) || 0));
  await c.env.DB.prepare(
    "UPDATE folders SET name = ?, description = ?, position = ?, watermark = ? WHERE id = ?",
  )
    .bind(name, str(form.description), position, on(form.watermark) ? 1 : 0, c.req.param("id"))
    .run();
  return c.redirect(`/admin?m=folder_saved#${c.req.param("id")}`, 303);
});

adminRoutes.post("/admin/folders/:id/link", async (c) => {
  const id = c.req.param("id");
  const folder = await c.env.DB.prepare("SELECT id FROM folders WHERE id = ?").bind(id).first();
  if (!folder) return c.text("Not found", 404);
  const raw = str((await c.req.parseBody()).slug, 80);
  if (!raw) {
    await c.env.DB.prepare("UPDATE folders SET slug = NULL WHERE id = ?").bind(id).run();
    return c.redirect(`/admin?m=slug_cleared#${id}`, 303);
  }
  const slug = slugify(raw);
  const check = await checkLink(c.env, slug, { folder: id });
  if (check !== "ok") return c.redirect(`/admin?m=slug_${check}#${id}`, 303);
  await c.env.DB.prepare("UPDATE folders SET slug = ? WHERE id = ?").bind(slug, id).run();
  return c.redirect(`/admin?m=slug_saved#${id}`, 303);
});

/** A folder with everything in it: its subfolders, and the files in both. */
async function folderContents(c: Parameters<MiddlewareHandler<AppEnv>>[0], id: string) {
  const folder = await c.env.DB.prepare("SELECT * FROM folders WHERE id = ?").bind(id).first<Folder>();
  if (!folder) return null;
  const subs = (await c.env.DB.prepare("SELECT * FROM folders WHERE parent_id = ?").bind(id).all<Folder>()).results;
  const ids = [id, ...subs.map((s) => s.id)];
  const files = (
    await c.env.DB.prepare(`SELECT id, r2_key, published, placeholder FROM files WHERE folder_id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ id: string; r2_key: string; published: number; placeholder: number }>()
  ).results;
  const people = folder.parent_id
    ? 0
    : ((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM grants WHERE folder_id = ?").bind(id).first<{ n: number }>())?.n ?? 0);
  return { folder, subs, ids, files, people };
}

/** "Are you sure?": says exactly what goes, works without JavaScript. */
adminRoutes.get("/admin/folders/:id/delete", async (c) => {
  const found = await folderContents(c, c.req.param("id"));
  if (!found) return c.redirect("/admin", 303);
  const { folder, subs, files, people } = found;
  const real = files.filter((f) => !f.placeholder);
  const visible = real.filter((f) => f.published).length;
  const placeholders = files.length - real.length;
  const kind = folder.parent_id ? "subfolder" : "folder";
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines = [
    subs.length ? plural(subs.length, "subfolder", "subfolders") : "",
    real.length ? `${plural(real.length, "document", "documents")}${visible ? ` (${visible} visible to investors)` : ""}` : "",
    placeholders ? plural(placeholders, "placeholder", "placeholders") : "",
    people ? `access for ${plural(people, "investor", "investors")} to this folder` : "",
  ].filter(Boolean);
  return c.html(
    page({
      title: `Delete ${folder.name}`,
      session: c.get("session"),
      nav: "documents",
      narrow: true,
      body: html`<section class="card setup-card">
          <h1 class="h2">Delete the ${kind} “${folder.name}”?</h1>
          ${lines.length
            ? html`<p>This also deletes everything in it:</p>
                <ul class="delete-list">${lines.map((l) => html`<li>${l}</li>`)}</ul>`
            : html`<p class="muted">It is empty.</p>`}
          <p class="notice error">This cannot be undone. Deleted documents cannot be recovered. Past views and downloads stay in Activity.</p>
          <form method="post" action="/admin/folders/${folder.id}/delete" class="row-between">
            <input type="hidden" name="confirm" value="delete">
            <a class="btn ghost" href="/admin#${folder.id}">Cancel</a>
            <button class="btn danger" type="submit">Delete ${kind}${lines.length ? " and everything in it" : ""}</button>
          </form>
        </section>`,
    }),
  );
});

adminRoutes.post("/admin/folders/:id/delete", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  // Only from the confirmation page above.
  if (form.confirm !== "delete") return c.redirect(`/admin/folders/${id}/delete`, 303);
  const found = await folderContents(c, id);
  if (!found) return c.redirect("/admin", 303);
  const { folder, ids, files } = found;
  const keys = files.flatMap((f) => [f.r2_key, renderKey(f.id)]);
  if (keys.length) await c.env.FILES.delete(keys);
  const marks = ids.map(() => "?").join(",");
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM files WHERE folder_id IN (${marks})`).bind(...ids),
    c.env.DB.prepare(`DELETE FROM grants WHERE folder_id IN (${marks})`).bind(...ids),
    c.env.DB.prepare("DELETE FROM folders WHERE parent_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM folders WHERE id = ?").bind(id),
  ]);
  return c.redirect(folder.parent_id ? `/admin?m=folder_deleted#${folder.parent_id}` : "/admin?m=folder_deleted", 303);
});

/**
 * Takes a heading away without losing what is under it: the files move up into the folder, and the
 * subfolder (with its link and any unreplaced placeholders) goes. Only for subfolders.
 */
adminRoutes.post("/admin/folders/:id/ungroup", async (c) => {
  const sub = await c.env.DB.prepare("SELECT * FROM folders WHERE id = ?").bind(c.req.param("id")).first<Folder>();
  if (!sub || !sub.parent_id) return c.redirect("/admin", 303);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM files WHERE folder_id = ? AND placeholder = 1").bind(sub.id),
    c.env.DB.prepare("UPDATE files SET folder_id = ?, updated_at = ? WHERE folder_id = ?").bind(sub.parent_id, now(), sub.id),
    c.env.DB.prepare("DELETE FROM grants WHERE folder_id = ?").bind(sub.id),
    c.env.DB.prepare("DELETE FROM folders WHERE id = ?").bind(sub.id),
  ]);
  return c.redirect(`/admin?m=heading_removed#${sub.parent_id}`, 303);
});

adminRoutes.post("/admin/folders/:id/upload", async (c) => {
  const folder = await c.env.DB.prepare("SELECT * FROM folders WHERE id = ?").bind(c.req.param("id")).first<Folder>();
  if (!folder) return c.text("Not found", 404);
  const form = await c.req.parseBody({ all: true });
  const raw = form.files;
  const uploads = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File && f.size > 0);
  if (!uploads.length) return c.redirect(`/admin?m=upload_none#${folder.id}`, 303);
  const publish = on(form.publish);
  const downloadable = on(form.allow_download) ? 1 : 0;

  let added = 0;
  let held = 0;
  let bad = 0;
  for (const upload of uploads) {
    const name = (upload.name || "Untitled").replace(/[\\/\x00-\x1f]/g, "_").slice(0, 160);
    if (upload.size > MAX_UPLOAD) {
      bad++;
      continue;
    }
    const bytes = await upload.arrayBuffer();
    const type = detectContentType(name, new Uint8Array(bytes.slice(0, 16)));
    if (type === "application/pdf" && folder.watermark && !(await canWatermark(bytes))) {
      bad++;
      continue;
    }
    let orientation: "portrait" | "landscape" | null = null;
    if (type === "application/pdf") orientation = await orientationOf(bytes).catch(() => "portrait" as const);
    const id = randomId();
    const key = `files/${id}`;
    await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
    const internal = looksInternal(name);
    if (internal) held++;
    const t = now();
    await c.env.DB.prepare(
      `INSERT INTO files (id, folder_id, name, r2_key, content_type, size, published, allow_download, orientation, uploaded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, folder.id, name, key, type, upload.size, publish && !internal ? 1 : 0, downloadable, orientation, t, t)
      .run();
    added++;
  }
  return c.redirect(`/admin?m=uploaded&n=${added}&held=${held}&bad=${bad}#${folder.id}`, 303);
});

adminRoutes.post("/admin/files/:id", async (c) => {
  const file = await c.env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(c.req.param("id")).first<FileRow>();
  if (!file) return c.text("Not found", 404);
  const form = await c.req.parseBody();
  const t = now();
  switch (form.action) {
    case "publish":
      if (file.placeholder)
        return c.redirect(form.back === "file" ? `/admin/files/${file.id}?m=placeholder_publish` : `/admin?m=placeholder_publish#${file.folder_id}`, 303);
      if (looksInternal(file.name))
        return c.redirect(form.back === "file" ? `/admin/files/${file.id}?m=file_internal` : `/admin?m=file_internal#${file.folder_id}`, 303);
      await c.env.DB.prepare("UPDATE files SET published = 1, updated_at = ? WHERE id = ?").bind(t, file.id).run();
      break;
    case "slug": {
      const raw = str(form.slug, 80);
      const back = form.back === "file" ? `/admin/files/${file.id}` : `/admin`;
      const anchor = form.back === "file" ? "" : `#${file.folder_id}`;
      if (!raw) {
        await c.env.DB.prepare("UPDATE files SET slug = NULL WHERE id = ?").bind(file.id).run();
        return c.redirect(`${back}?m=slug_cleared${anchor}`, 303);
      }
      const slug = slugify(raw);
      const check = await checkLink(c.env, slug, { file: file.id });
      if (check !== "ok") return c.redirect(`${back}?m=slug_${check}${anchor}`, 303);
      await c.env.DB.prepare("UPDATE files SET slug = ? WHERE id = ?").bind(slug, file.id).run();
      return c.redirect(`${back}?m=slug_saved${anchor}`, 303);
    }
    case "download_on":
    case "download_off":
      await c.env.DB.prepare("UPDATE files SET allow_download = ? WHERE id = ?").bind(form.action === "download_on" ? 1 : 0, file.id).run();
      break;
    case "hide":
      await c.env.DB.prepare("UPDATE files SET published = 0 WHERE id = ?").bind(file.id).run();
      break;
    case "rename": {
      const name = str(form.name, 160).replace(/[\\/\x00-\x1f]/g, "_");
      if (!name) break;
      // Renaming to a draft-looking name hides the file again.
      const publishedSql = looksInternal(name) ? ", published = 0" : "";
      await c.env.DB.prepare(`UPDATE files SET name = ?${publishedSql} WHERE id = ?`).bind(name, file.id).run();
      await c.env.FILES.delete(renderKey(file.id)); // the rendered page carries the name as its title
      // A heading over a single file follows that file's name: rename "More Stuff" to "More Stuffs" and the
      // heading above it becomes "More Stuffs". With two or more files under it, the heading stays as it is.
      // (To keep your own wording, rename the heading after the file.)
      const sub = await c.env.DB.prepare("SELECT id FROM folders WHERE id = ? AND parent_id IS NOT NULL").bind(file.folder_id).first<{ id: string }>();
      if (sub) {
        const others = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE folder_id = ? AND id != ? AND placeholder = 0").bind(sub.id, file.id).first<{ n: number }>();
        const heading = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim().slice(0, 80);
        if (!others?.n && heading) await c.env.DB.prepare("UPDATE folders SET name = ? WHERE id = ?").bind(heading, sub.id).run();
      }
      break;
    }
    case "move": {
      const target = await c.env.DB.prepare("SELECT id FROM folders WHERE id = ?").bind(str(form.folder_id)).first();
      if (target) await c.env.DB.prepare("UPDATE files SET folder_id = ? WHERE id = ?").bind(target.id, file.id).run();
      return c.redirect(`/admin?m=file_saved#${target?.id ?? file.folder_id}`, 303);
    }
  }
  if (form.back === "file") return c.redirect(`/admin/files/${file.id}?m=file_saved`, 303);
  return c.redirect(`/admin?m=file_saved#${file.folder_id}`, 303);
});

adminRoutes.post("/admin/files/:id/replace", async (c) => {
  const file = await fileForAdmin(c.env, c.req.param("id"));
  if (!file) return c.text("Not found", 404);
  const form = await c.req.parseBody();
  const back = form.back === "file" ? `/admin/files/${file.id}` : "/admin";
  const anchor = form.back === "file" ? "" : `#${file.folder_id}`;
  const upload = form.file;
  if (!(upload instanceof File) || upload.size === 0) return c.redirect(`${back}?m=replace_none${anchor}`, 303);
  if (upload.size > MAX_UPLOAD) return c.redirect(`${back}?m=replace_bad${anchor}`, 303);

  const bytes = await upload.arrayBuffer();
  const type = detectContentType(upload.name || file.name, new Uint8Array(bytes.slice(0, 16)));
  if (type === "application/pdf" && file.watermark && !(await canWatermark(bytes))) return c.redirect(`${back}?m=replace_bad${anchor}`, 303);
  const orientation = type === "application/pdf" ? await orientationOf(bytes).catch(() => "portrait" as const) : null;

  // Keep the name investors know; only the extension follows the new file (Deck.pptx -> Deck.pdf).
  const newExt = (upload.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
  const name = newExt ? file.name.replace(/\.[a-z0-9]{1,5}$/i, "") + "." + newExt : file.name;

  await c.env.FILES.put(file.r2_key, bytes, { httpMetadata: { contentType: type } });
  await c.env.FILES.delete(renderKey(file.id));
  // A template placeholder becomes a real document: visible straight away, unless its name says draft.
  const wasPlaceholder = file.placeholder === 1;
  const publish = wasPlaceholder && !looksInternal(name) ? 1 : file.published;
  await c.env.DB.prepare(
    "UPDATE files SET name = ?, content_type = ?, size = ?, orientation = ?, updated_at = ?, placeholder = 0, published = ? WHERE id = ?",
  )
    .bind(name, type, upload.size, orientation, now(), publish, file.id)
    .run();
  return c.redirect(`${back}?m=${wasPlaceholder && publish ? "replaced_placeholder" : "replaced"}${anchor}`, 303);
});

adminRoutes.post("/admin/files/:id/delete", async (c) => {
  const file = await c.env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(c.req.param("id")).first<FileRow>();
  if (!file) return c.text("Not found", 404);
  await c.env.DB.prepare("DELETE FROM files WHERE id = ?").bind(file.id).run();
  await c.env.FILES.delete([file.r2_key, renderKey(file.id)]);
  return c.redirect(`/admin?m=file_deleted#${file.folder_id}`, 303);
});

/** Admin viewer: the file on a page inside the room, as investors see it, plus its status and who opened it. */
adminRoutes.get("/admin/files/:id", async (c) => {
  const file = await fileForAdmin(c.env, c.req.param("id"));
  if (!file) return c.html(messagePage(c.get("session"), "Not found", "This file no longer exists.", "/admin"), 404);
  const [opens, people] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM events WHERE file_id = ? AND action IN ('view', 'download') ORDER BY at DESC LIMIT 50")
      .bind(file.id)
      .all<EventRow>(),
    c.env.DB.prepare("SELECT email, name FROM investors").all<{ email: string; name: string }>(),
  ]);
  const names = new Map(people.results.map((i) => [i.email.toLowerCase(), i.name]));
  const viewable = VIEWABLE_TYPES.has(file.content_type);
  const isPdf = file.content_type === "application/pdf";
  const hiddenByType = file.published === 1 && !visibleToInvestor(file);

  return c.html(
    page({
      title: file.name,
      session: c.get("session"),
      nav: "documents",
      body: html`${flash(c)}
        <p class="crumbs"><a href="/admin#${file.folder_id}">‹ ${file.folder_name}</a></p>
        <section class="viewer-head">
          <div>
            <h1 class="h2 break">${file.name} <span class="badge ${file.published ? "green" : "grey"}">${file.published ? "Visible" : "Hidden"}</span></h1>
            <p class="muted small">${fileKind(file.content_type, file.name)} · ${formatSize(file.size)} · Uploaded ${formatDate(file.uploaded_at)}</p>
            ${hiddenByType ? html`<p class="file-warn">Investors cannot see this: this file type cannot open in the browser and Download is off.</p>` : ""}
          </div>
          <div class="actions">
            <form method="post" action="/admin/files/${file.id}">
              <input type="hidden" name="action" value="${file.published ? "hide" : "publish"}">
              <input type="hidden" name="back" value="file">
              <button class="btn small ${file.published ? "ghost" : ""}" type="submit">${file.published ? "Hide from investors" : "Make visible"}</button>
            </form>
            ${downloadSwitch(file, "file")}
            <a class="btn small" href="/admin/preview/f/${file.id}">Preview</a>
            <a class="btn small ghost" href="/admin/files/${file.id}/preview?download=1">Download original</a>
          </div>
        </section>
        ${viewable
          ? documentFrame(file, `/admin/files/${file.id}/preview`, await orientationFor(c.env, file))
          : html`<section class="card center"><p class="muted">This file type cannot be shown in the browser. Use Download original to check it.</p></section>`}
        ${isPdf && file.watermark ? html`<p class="small muted center">You are seeing the original. Investors see every page stamped with their email and the date.</p>` : ""}
        <section class="card two-col">
          <div>
            <h2 class="h3">Link</h2>
            <p class="small muted">Investors with access open it at <strong>${c.env.APP_ORIGIN.replace(/^https?:\/\//, "")}${file.slug ? `/${file.slug}` : `/d/${file.id}`}</strong>. Nobody else can open it.</p>
            ${slugForm(file, "file")}
          </div>
          <div>
            <h2 class="h3">New version</h2>
            <p class="small muted">Replaces the file and keeps its link, access, settings and history. Investors see the new date.</p>
            ${replaceForm(file, "file")}
          </div>
        </section>
        <section class="card">
          <h2 class="h3">Who opened it</h2>
          ${activityList(opens.results, true, names)}
        </section>`,
    }),
  );
});

/** The original file for the admin: no stamp, never logged as an investor view. */
adminRoutes.get("/admin/files/:id/preview", async (c) => {
  const file = await fileForAdmin(c.env, c.req.param("id"));
  if (!file) return c.text("Not found", 404);
  const download = c.req.query("download") === "1" || !VIEWABLE_TYPES.has(file.content_type);
  return serveFile(c, file, download ? "attachment" : "inline", null);
});

// ---------- Investors ----------

function folderChecks(all: Folder[], granted: Set<string>) {
  const folders = all.filter((f) => !f.parent_id);
  if (!folders.length) return html`<p class="muted small">Create a folder first on the Documents tab.</p>`;
  return html`<fieldset class="checks">
    <legend>Folders they can see</legend>
    ${folders.map(
      (f) => {
        const subs = all.filter((s) => s.parent_id === f.id).length;
        return html`<label class="check"><input type="checkbox" name="folders" value="${f.id}" ${checked(granted.has(f.id))}> ${f.name}${subs ? html` <span class="muted small">(and its ${subs} ${subs === 1 ? "subfolder" : "subfolders"})</span>` : ""}</label>`;
      },
    )}
  </fieldset>`;
}

adminRoutes.get("/admin/investors", async (c) => {
  const db = c.env.DB;
  const [investors, folders, counts] = await Promise.all([
    db.prepare("SELECT * FROM investors ORDER BY revoked_at IS NOT NULL, name COLLATE NOCASE, email").all<Investor>(),
    db.prepare("SELECT * FROM folders ORDER BY position, name COLLATE NOCASE").all<Folder>(),
    db
      .prepare(
        `SELECT i.id,
           (SELECT COUNT(*) FROM grants g WHERE g.investor_id = i.id) AS folders,
           (SELECT COUNT(*) FROM events e WHERE e.email = i.email AND e.action IN ('view', 'download')) AS opens
         FROM investors i`,
      )
      .all<{ id: string; folders: number; opens: number }>(),
  ]);
  const countById = new Map(counts.results.map((r) => [r.id, r]));
  const requests = (
    await db.prepare("SELECT * FROM access_requests WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50").all<AccessRequest>()
  ).results;

  return c.html(
    page({
      title: "Investors",
      session: c.get("session"),
      nav: "investors",
      body: html`${flash(c)}
        <section class="row-between">
          <div>
            <h1 class="h2">Investors</h1>
            <p class="muted small">Each investor signs in with their email and sees only the folders you tick.</p>
          </div>
        </section>
        ${requests.length ? requestsCard(requests, folders.results) : ""}
        <details class="card add" ${investors.results.length ? "" : "open"}>
          <summary class="btn">Add investor</summary>
          <form method="post" action="/admin/investors" class="stack">
            <label>Email <input name="email" type="email" required maxlength="254" placeholder="partner@fund.com"></label>
            <div class="two">
              <label>Name <input name="name" maxlength="100" placeholder="Ada Okafor"></label>
              <label>Firm <input name="firm" maxlength="100" placeholder="Plug and Play"></label>
            </div>
            <label>Access ends (optional) <input name="expires" type="date"></label>
            ${folderChecks(folders.results, new Set())}
            <label class="check"><input type="checkbox" name="invite" checked> Email them an invite now</label>
            <button class="btn" type="submit">Add investor</button>
          </form>
        </details>
        ${investors.results.length
          ? html`<section class="card flush">
              <ul class="people">
                ${investors.results.map((i) => {
                  const [label, cls] = investorStatus(i);
                  const n = countById.get(i.id);
                  return html`<li>
                    <a href="/admin/investors/${i.id}" class="person">
                      <span class="avatar" aria-hidden="true">${(i.name || i.email).slice(0, 1).toUpperCase()}</span>
                      <span class="file-main">
                        <span class="file-name">${i.name || i.email}${i.firm ? html` <span class="muted">· ${i.firm}</span>` : ""}</span>
                        <span class="file-meta">${i.email} · ${n?.folders ?? 0} ${n?.folders === 1 ? "folder" : "folders"} · ${n?.opens ?? 0} ${n?.opens === 1 ? "open" : "opens"}${i.last_seen_at ? ` · Last seen ${formatDate(i.last_seen_at)}` : ""}${i.expires_at ? ` · Ends ${formatDate(i.expires_at)}` : ""}</span>
                      </span>
                      <span class="badge ${cls}">${label}</span>
                    </a>
                  </li>`;
                })}
              </ul>
            </section>`
          : ""}`,
    }),
  );
});

async function sendInvite(c: Parameters<MiddlewareHandler<AppEnv>>[0], investor: Pick<Investor, "email" | "name">) {
  return sendMail(c.env, inviteMail(c.env.APP_ORIGIN, investor.email, investor.name));
}

function grantStatements(c: Parameters<MiddlewareHandler<AppEnv>>[0], investorId: string, folderIds: string[], validIds: Set<string>) {
  const t = now();
  return [
    c.env.DB.prepare("DELETE FROM grants WHERE investor_id = ?").bind(investorId),
    ...[...new Set(folderIds)]
      .filter((id) => validIds.has(id))
      .map((id) => c.env.DB.prepare("INSERT INTO grants (investor_id, folder_id, granted_at) VALUES (?, ?, ?)").bind(investorId, id, t)),
  ];
}

const formList = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");

async function folderIdSet(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  // Access is granted on top-level folders only; their subfolders come with them.
  const rows = await c.env.DB.prepare("SELECT id FROM folders WHERE parent_id IS NULL").all<{ id: string }>();
  return new Set(rows.results.map((r) => r.id));
}

adminRoutes.post("/admin/investors", async (c) => {
  const form = await c.req.parseBody({ all: true });
  const email = normalizeEmail(form.email);
  if (!email) return c.redirect("/admin/investors?m=investor_email", 303);
  if (await isAdmin(c.env, email)) return c.redirect("/admin/investors?m=investor_is_admin", 303);
  const exists = await c.env.DB.prepare("SELECT id FROM investors WHERE email = ?").bind(email).first();
  if (exists) return c.redirect("/admin/investors?m=investor_exists", 303);

  const id = randomId();
  const name = str(form.name, 100);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO investors (id, email, name, firm, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      id,
      email,
      name,
      str(form.firm, 100),
      parseDateInput(form.expires),
      now(),
    ),
    ...grantStatements(c, id, formList(form.folders), await folderIdSet(c)),
  ]);
  if (on(form.invite)) {
    const ok = await sendInvite(c, { email, name });
    return c.redirect(`/admin/investors/${id}?m=${ok ? "investor_added_invited" : "invite_failed"}`, 303);
  }
  return c.redirect(`/admin/investors/${id}?m=investor_added`, 303);
});

adminRoutes.get("/admin/investors/:id", async (c) => {
  const db = c.env.DB;
  const investor = await db.prepare("SELECT * FROM investors WHERE id = ?").bind(c.req.param("id")).first<Investor>();
  if (!investor) return c.text("Not found", 404);
  const [folders, grants, events] = await Promise.all([
    db.prepare("SELECT * FROM folders ORDER BY position, name COLLATE NOCASE").all<Folder>(),
    db.prepare("SELECT folder_id FROM grants WHERE investor_id = ?").bind(investor.id).all<{ folder_id: string }>(),
    db.prepare("SELECT * FROM events WHERE email = ? ORDER BY at DESC LIMIT 200").bind(investor.email).all<EventRow>(),
  ]);
  const [label, cls] = investorStatus(investor);

  return c.html(
    page({
      title: investor.name || investor.email,
      session: c.get("session"),
      nav: "investors",
      body: html`${flash(c)}
        <p class="crumbs"><a href="/admin/investors">‹ Investors</a></p>
        <section class="row-between">
          <div>
            <h1 class="h2 break">${investor.name || investor.email} <span class="badge ${cls}">${label}</span></h1>
            <p class="muted small">${investor.email}${investor.firm ? ` · ${investor.firm}` : ""} · Added ${formatDate(investor.created_at)}${investor.last_seen_at ? ` · Last seen ${formatDateTime(investor.last_seen_at)}` : " · Not signed in yet"}</p>
          </div>
          <div class="actions">
            <a class="btn small" href="/admin/preview/i/${investor.id}">Preview as ${investor.name ? investor.name.split(" ")[0] : "them"}</a>
            <form method="post" action="/admin/investors/${investor.id}/invite"><button class="btn ghost small" type="submit">Send invite email</button></form>
            ${investor.revoked_at
              ? html`<form method="post" action="/admin/investors/${investor.id}/restore"><button class="btn small" type="submit">Restore access</button></form>`
              : html`<form method="post" action="/admin/investors/${investor.id}/revoke" data-confirm="Revoke all access for ${investor.email}? They are signed out at once.">
                  <button class="btn danger small" type="submit">Revoke access</button>
                </form>`}
          </div>
        </section>
        <section class="card">
          <form method="post" action="/admin/investors/${investor.id}" class="stack">
            <div class="two">
              <label>Name <input name="name" value="${investor.name}" maxlength="100"></label>
              <label>Firm <input name="firm" value="${investor.firm}" maxlength="100"></label>
            </div>
            <label>Access ends (optional) <input name="expires" type="date" value="${dateInputValue(investor.expires_at)}"></label>
            ${folderChecks(folders.results, new Set(grants.results.map((g) => g.folder_id)))}
            <button class="btn" type="submit">Save changes</button>
          </form>
        </section>
        <section class="card">
          <h2 class="h3">What they opened</h2>
          ${activityList(events.results, false)}
        </section>
        <form method="post" action="/admin/investors/${investor.id}/delete" data-confirm="Remove ${investor.email} from the list? Their activity history is kept." class="center">
          <button class="link-btn danger-text" type="submit">Remove investor</button>
        </form>`,
    }),
  );
});

adminRoutes.post("/admin/investors/:id", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody({ all: true });
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE investors SET name = ?, firm = ?, expires_at = ? WHERE id = ?").bind(
      str(form.name, 100),
      str(form.firm, 100),
      parseDateInput(form.expires),
      id,
    ),
    ...grantStatements(c, id, formList(form.folders), await folderIdSet(c)),
  ]);
  return c.redirect(`/admin/investors/${id}?m=investor_saved`, 303);
});

adminRoutes.post("/admin/investors/:id/invite", async (c) => {
  const investor = await c.env.DB.prepare("SELECT * FROM investors WHERE id = ?").bind(c.req.param("id")).first<Investor>();
  if (!investor) return c.text("Not found", 404);
  const ok = await sendInvite(c, investor);
  return c.redirect(`/admin/investors/${investor.id}?m=${ok ? "invite_sent" : "invite_failed"}`, 303);
});

adminRoutes.post("/admin/investors/:id/revoke", async (c) => {
  const investor = await c.env.DB.prepare("SELECT * FROM investors WHERE id = ?").bind(c.req.param("id")).first<Investor>();
  if (!investor) return c.text("Not found", 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE investors SET revoked_at = ? WHERE id = ?").bind(now(), investor.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE email = ? AND role = 'investor'").bind(investor.email),
    c.env.DB.prepare("UPDATE login_tokens SET used_at = ? WHERE email = ? AND used_at IS NULL").bind(now(), investor.email),
  ]);
  return c.redirect(`/admin/investors/${investor.id}?m=revoked`, 303);
});

adminRoutes.post("/admin/investors/:id/restore", async (c) => {
  await c.env.DB.prepare("UPDATE investors SET revoked_at = NULL WHERE id = ?").bind(c.req.param("id")).run();
  return c.redirect(`/admin/investors/${c.req.param("id")}?m=restored`, 303);
});

adminRoutes.post("/admin/investors/:id/delete", async (c) => {
  const investor = await c.env.DB.prepare("SELECT * FROM investors WHERE id = ?").bind(c.req.param("id")).first<Investor>();
  if (!investor) return c.text("Not found", 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM grants WHERE investor_id = ?").bind(investor.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE email = ? AND role = 'investor'").bind(investor.email),
    c.env.DB.prepare("UPDATE login_tokens SET used_at = ? WHERE email = ? AND used_at IS NULL").bind(now(), investor.email),
    c.env.DB.prepare("DELETE FROM investors WHERE id = ?").bind(investor.id),
  ]);
  return c.redirect("/admin/investors?m=investor_deleted", 303);
});

// ---------- Activity ----------

type EventRow = {
  id: number;
  at: number;
  email: string;
  action: string;
  file_id: string | null;
  file_name: string | null;
  folder_name: string | null;
  country: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  sign_in: "Signed in",
  view: "Viewed",
  download: "Downloaded",
  email_failed: "Sign-in email failed",
};

function activityList(events: EventRow[], showWho: boolean, names?: Map<string, string>) {
  if (!events.length) return html`<p class="muted small">Nothing yet.</p>`;
  return html`<ul class="activity">
    ${events.map(
      (e) => html`<li>
        <span class="act act-${e.action}">${ACTION_LABEL[e.action] ?? e.action}</span>
        <span class="file-main">
          <span>${showWho ? html`<strong>${names?.get(e.email.toLowerCase()) || e.email}</strong> ` : ""}${e.file_name ?? ""}${e.folder_name ? html` <span class="muted">in ${e.folder_name}</span>` : ""}</span>
          <span class="file-meta">${formatDateTime(e.at)}${e.country ? ` · ${e.country}` : ""}</span>
        </span>
      </li>`,
    )}
  </ul>`;
}

adminRoutes.get("/admin/activity", async (c) => {
  const [events, investors] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM events ORDER BY at DESC LIMIT 300").all<EventRow>(),
    c.env.DB.prepare("SELECT email, name FROM investors").all<{ email: string; name: string }>(),
  ]);
  const names = new Map(investors.results.map((i) => [i.email.toLowerCase(), i.name]));
  return c.html(
    page({
      title: "Activity",
      session: c.get("session"),
      nav: "activity",
      body: html`<h1 class="h2">Activity</h1>
        <p class="muted small">The latest 300 sign-ins, views and downloads. Times are UTC.</p>
        <section class="card">${activityList(events.results, true, names)}</section>`,
    }),
  );
});

// ---------- Access requests ----------

type AccessRequest = { id: string; email: string; name: string; firm: string; note: string; created_at: number };

/** Waiting requests from the sign-in page: approve with folders (and an invite), or decline. */
function requestsCard(requests: AccessRequest[], folders: Folder[]) {
  return html`<section class="card requests" id="requests">
    <h2 class="h3">Access requests <span class="badge blue">${requests.length}</span></h2>
    ${requests.map(
      (r) => html`<div class="request">
        <p><strong>${r.name}</strong>${r.firm ? html` · ${r.firm}` : ""} · <span class="muted">${r.email}</span> · <span class="small muted">${formatDateTime(r.created_at)}</span></p>
        ${r.note ? html`<p class="request-note">${r.note}</p>` : ""}
        <details class="settings">
          <summary class="btn small">Approve…</summary>
          <form method="post" action="/admin/requests/${r.id}/approve" class="stack settings-body">
            ${folderChecks(folders, new Set())}
            <label class="small">Access ends (optional) <input type="date" name="expires"></label>
            <label class="check small"><input type="checkbox" name="invite" checked> Email them an invite now</label>
            <button class="btn small" type="submit">Approve</button>
          </form>
        </details>
        <form method="post" action="/admin/requests/${r.id}/decline" class="inline-form">
          <button class="link-btn small" type="submit">Decline</button>
        </form>
      </div>`,
    )}
  </section>`;
}

adminRoutes.post("/admin/requests/:id/approve", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM access_requests WHERE id = ? AND status = 'pending'").bind(c.req.param("id")).first<AccessRequest>();
  if (!r) return c.redirect("/admin/investors", 303);
  if (await isAdmin(c.env, r.email)) return c.redirect("/admin/investors?m=request_is_admin#requests", 303);
  const form = await c.req.parseBody({ all: true });
  const valid = await folderIdSet(c);
  const chosen = [...new Set(formList(form.folders))].filter((f) => valid.has(f));
  const t = now();
  const decided = c.env.DB.prepare("UPDATE access_requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?").bind(
    t,
    c.get("session")!.email,
    r.id,
  );
  // Someone invited in the meantime keeps what they had and gains the chosen folders.
  const existing = await c.env.DB.prepare("SELECT id FROM investors WHERE email = ?").bind(r.email).first<{ id: string }>();
  const id = existing?.id ?? randomId();
  await c.env.DB.batch([
    ...(existing
      ? []
      : [
          c.env.DB.prepare("INSERT INTO investors (id, email, name, firm, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
            id,
            r.email,
            r.name.slice(0, 100),
            r.firm.slice(0, 100),
            parseDateInput(form.expires),
            t,
          ),
        ]),
    ...chosen.map((f) => c.env.DB.prepare("INSERT OR IGNORE INTO grants (investor_id, folder_id, granted_at) VALUES (?, ?, ?)").bind(id, f, t)),
    decided,
  ]);
  if (on(form.invite)) {
    const ok = await sendInvite(c, { email: r.email, name: r.name });
    return c.redirect(`/admin/investors/${id}?m=${ok ? "request_approved" : "invite_failed"}`, 303);
  }
  return c.redirect(`/admin/investors/${id}?m=request_approved_quiet`, 303);
});

adminRoutes.post("/admin/requests/:id/decline", async (c) => {
  await c.env.DB.prepare("UPDATE access_requests SET status = 'declined', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'")
    .bind(now(), c.get("session")!.email, c.req.param("id"))
    .run();
  return c.redirect("/admin/investors?m=request_declined", 303);
});
