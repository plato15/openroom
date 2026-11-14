import { html } from "hono/html";
import type { FileWithFolder } from "./access";
import { fileRef, visibleToInvestor } from "./access";
import { brand } from "./brand";
import type { FileRow, Folder, Investor } from "./env";
import { fileKind, formatDate, formatSize, viewKind } from "./util";

/**
 * The investor screens, shared by the real room and the admin Preview so both always look the same.
 * `links` says where the room and each file live (/room and /d/... for investors, /admin/preview/... for Preview).
 */
export type RoomLinks = { room: string; file: (id: string) => string };

export function roomBody(opts: {
  investor: Pick<Investor, "name" | "firm" | "expires_at"> | null;
  folders: Folder[];
  files: FileRow[];
  links: RoomLinks;
}) {
  const { investor, folders, files, links } = opts;
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const byFolder = new Map<string, FileRow[]>(folders.map((f) => [f.id, []]));
  for (const file of files) {
    const folder = folderById.get(file.folder_id);
    if (folder && visibleToInvestor(file)) byFolder.get(folder.id)!.push(file);
  }
  // Top-level folders, each with its subfolders. A subfolder whose parent is not shared is not shown.
  const top = folders.filter((f) => !f.parent_id);
  const subsOf = (id: string) => folders.filter((f) => f.parent_id === id);
  const countIn = (f: Folder) => (byFolder.get(f.id)?.length ?? 0) + subsOf(f.id).reduce((n, s) => n + (byFolder.get(s.id)?.length ?? 0), 0);
  const total = top.reduce((n, f) => n + countIn(f), 0);
  const greeting = investor?.name ? `Welcome, ${investor.name.split(" ")[0]}` : "Welcome";

  return html`<section class="hero">
      <p class="eyebrow">${investor?.firm || brand().roomName}</p>
      <h1 class="display">${greeting}</h1>
      <p class="lead">${top.length
        ? `${total} ${total === 1 ? "document" : "documents"} in ${top.length} ${top.length === 1 ? "folder" : "folders"}, shared with you for due diligence.`
        : "Nothing has been shared with you yet. You will get an email when documents are ready."}</p>
      ${investor?.expires_at ? html`<p class="small muted">Your access is open until ${formatDate(investor.expires_at)}.</p>` : ""}
    </section>
    ${top.length > 1
      ? html`<nav class="chips" aria-label="Folders">
          ${top.map((f) => html`<a href="#${f.id}" class="chip">${f.name}</a>`)}
        </nav>`
      : ""}
    ${top.map((folder) => folderCard(folder, byFolder.get(folder.id) ?? [], countIn(folder), subsOf(folder.id), byFolder, links))}`;
}

function fileList(files: FileRow[], links: RoomLinks) {
  return html`<ul class="files">
    ${files.map(
      (file) => html`<li>
        <a class="file" href="${links.file(fileRef(file))}">
          <span class="kind kind-${fileKind(file.content_type, file.name).toLowerCase()}">${fileKind(file.content_type, file.name)}</span>
          <span class="file-main">
            <span class="file-name">${file.name}</span>
            <span class="file-meta">${formatSize(file.size)} · Updated ${formatDate(file.updated_at)}</span>
          </span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>`,
    )}
  </ul>`;
}

function folderCard(folder: Folder, files: FileRow[], count: number, subfolders: Folder[], byFolder: Map<string, FileRow[]>, links: RoomLinks) {
  // Subfolders with nothing to show stay out of the way (templates create many until they are filled).
  const shown = subfolders.filter((s) => (byFolder.get(s.id)?.length ?? 0) > 0);
  return html`<section class="card folder" id="${folder.id}">
    <div class="folder-head">
      <div class="folder-icon" aria-hidden="true"></div>
      <div class="folder-title">
        <h2 class="h3">${folder.name}</h2>
        ${folder.description ? html`<p class="muted small">${folder.description}</p>` : ""}
      </div>
      <span class="count">${count} ${count === 1 ? "document" : "documents"}</span>
    </div>
    <div class="folder-body">
    ${files.length ? fileList(files, links) : ""}
    ${shown.map(
      (s) => html`<div class="subfolder" id="${s.id}">
        <h3 class="subfolder-title">${s.name}</h3>
        ${fileList(byFolder.get(s.id) ?? [], links)}
      </div>`,
    )}
    ${!count ? html`<p class="muted small empty">No documents here yet.</p>` : ""}
    </div>
  </section>`;
}

/** The document area, shaped to the file: wide for slides, tall for documents, a page for sheets and Word files. */
export function documentFrame(file: FileWithFolder, src: string, orientation: "portrait" | "landscape" | null) {
  const kind = viewKind(file.content_type);
  if (kind === "pdf") {
    const landscape = orientation === "landscape";
    return html`<div class="frame pdf ${landscape ? "landscape" : "portrait"}"><iframe src="${src}#navpanes=0&view=${landscape ? "Fit" : "FitH"}" title="${file.name}"></iframe></div>
      <p class="mobile-only"><a class="btn wide" href="${src}">Open document</a></p>`;
  }
  if (kind === "video") {
    return html`<div class="frame video"><video controls controlsList="nodownload noremoteplayback" disablepictureinpicture playsinline preload="metadata" src="${src}">Your browser cannot play this video.</video></div>`;
  }
  if (kind === "image") return html`<div class="frame image"><img src="${src}" alt="${file.name}"></div>`;
  if (kind === "sheet" || kind === "doc")
    return html`<div class="frame page ${kind}"><iframe src="${src}" title="${file.name}"></iframe></div>`;
  return html`<section class="card center"><p class="muted">This file type opens on your device. Use Download above.</p></section>`;
}

export function viewerBody(file: FileWithFolder, links: RoomLinks, orientation: "portrait" | "landscape" | null = null) {
  const kind = viewKind(file.content_type);
  const base = links.file(fileRef(file));
  return html`<p class="crumbs"><a href="${links.room}#${file.folder_id}">‹ ${file.folder_name}</a></p>
    <section class="viewer-head">
      <div>
        <h1 class="h2 break">${file.name}</h1>
        <p class="muted small">${fileKind(file.content_type, file.name)} · ${formatSize(file.size)} · Updated ${formatDate(file.updated_at)}</p>
      </div>
      <div class="actions">
        ${kind && kind !== "video" ? html`<a class="btn ghost" href="${base}/view" target="_blank" rel="noopener">Open full screen</a>` : ""}
        ${file.allow_download ? html`<a class="btn" href="${base}/download">Download</a>` : ""}
      </div>
    </section>
    ${documentFrame(file, `${base}/view`, orientation)}
    ${file.watermark && kind && kind !== "image" && kind !== "video" ? html`<p class="small muted center">Pages are marked with your email address.</p>` : ""}`;
}
