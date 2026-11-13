// The same tests run against the Worker (vitest.config.ts) and the Node build (vitest.node.config.ts);
// each config points "./harness" at its own runtime.
import { env, fetchApp } from "./harness";
import app from "../src/index";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://dataroom.test";
const ADMIN = "admin@example.test";

type Opts = { method?: string; form?: Record<string, string | string[]> | FormData; cookie?: string; origin?: string | null };

async function req(path: string, opts: Opts = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  const method = opts.method ?? (opts.form ? "POST" : "GET");
  if (method !== "GET" && opts.origin !== null) headers.set("origin", opts.origin ?? ORIGIN);
  let body: BodyInit | undefined;
  if (opts.form instanceof FormData) body = opts.form;
  else if (opts.form) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.form)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
    body = p;
  }
  return fetchApp(new Request(ORIGIN + path, { method, headers, body, redirect: "manual" }));
}

async function lastLinkFor(email: string): Promise<string | null> {
  const mails = (await (await req("/__test/outbox")).json()) as { to: string; link?: string }[];
  const mine = mails.filter((m) => m.to === email && m.link);
  return mine.length ? mine[mine.length - 1].link! : null;
}

async function requestLink(email: string) {
  const res = await req("/login", { form: { email } });
  expect(res.status).toBe(200);
  return lastLinkFor(email);
}

async function signIn(email: string): Promise<string> {
  const link = await requestLink(email);
  expect(link, `no sign-in link for ${email}`).toBeTruthy();
  const token = new URL(link!).searchParams.get("t")!;
  const res = await req("/auth", { form: { t: token } });
  expect(res.status).toBe(303);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  return cookie.split(";")[0];
}

let adminCookie: string | null = null;
/** One admin session for the whole file: sign-in links are rate limited per email. */
async function adminSession() {
  adminCookie ??= await signIn(ADMIN);
  return adminCookie;
}

let seq = 0;
const uid = (p: string) => `${p}_${++seq}_${Math.random().toString(36).slice(2, 10)}`;

/** The smallest valid Word file: one paragraph. */
async function makeDocx(text: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

async function makePdf(text = "hello") {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]).drawText(text, { x: 50, y: 700 });
  return pdf.save();
}

/** Test shorthand: `download` on a folder makes its files downloadable unless a file says otherwise. */
const folderDownloads = new Map<string, boolean>();

async function addFolder(opts: { download?: boolean; watermark?: boolean } = {}) {
  const id = uid("folder");
  await env.DB.prepare(
    "INSERT INTO folders (id, name, description, position, watermark, created_at) VALUES (?, ?, '', 0, ?, ?)",
  )
    .bind(id, `Folder ${id}`, opts.watermark === false ? 0 : 1, Date.now())
    .run();
  folderDownloads.set(id, !!opts.download);
  return id;
}

async function addFile(folderId: string, opts: { name?: string; type?: string; published?: boolean; download?: boolean; bytes?: Uint8Array } = {}) {
  const id = uid("file");
  const bytes = opts.bytes ?? (await makePdf());
  await env.FILES.put(`files/${id}`, bytes);
  await env.DB.prepare(
    `INSERT INTO files (id, folder_id, name, r2_key, content_type, size, published, allow_download, uploaded_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, folderId, opts.name ?? `${id}.pdf`, `files/${id}`, opts.type ?? "application/pdf", bytes.byteLength, opts.published === false ? 0 : 1,
      (opts.download ?? folderDownloads.get(folderId)) ? 1 : 0, Date.now(), Date.now())
    .run();
  return id;
}

async function addInvestor(opts: { folders?: string[]; expiresAt?: number; revoked?: boolean } = {}) {
  const id = uid("inv");
  const email = `${id}@fund.test`.toLowerCase();
  await env.DB.prepare("INSERT INTO investors (id, email, name, firm, expires_at, revoked_at, created_at) VALUES (?, ?, 'Ada Okafor', 'Fund', ?, ?, ?)")
    .bind(id, email, opts.expiresAt ?? null, opts.revoked ? Date.now() : null, Date.now())
    .run();
  for (const f of opts.folders ?? []) {
    await env.DB.prepare("INSERT INTO grants (investor_id, folder_id, granted_at) VALUES (?, ?, ?)").bind(id, f, Date.now()).run();
  }
  return { id, email };
}

describe("sign-in", () => {
  it("never sends a link to an email that was not invited, and says the same thing", async () => {
    const res = await req("/login", { form: { email: "stranger@nowhere.test" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("If stranger@nowhere.test has access");
    expect(await lastLinkFor("stranger@nowhere.test")).toBeNull();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ?").bind("stranger@nowhere.test").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("does not send links to revoked or expired investors", async () => {
    const revoked = await addInvestor({ revoked: true });
    const expired = await addInvestor({ expiresAt: Date.now() - 1000 });
    expect(await requestLink(revoked.email)).toBeNull();
    expect(await requestLink(expired.email)).toBeNull();
  });

  it("a link works once, and opening it (GET) does not use it up", async () => {
    const inv = await addInvestor();
    const link = await requestLink(inv.email);
    const t = new URL(link!).searchParams.get("t")!;
    expect((await req(`/auth?t=${encodeURIComponent(t)}`)).status).toBe(200);
    expect((await req(`/auth?t=${encodeURIComponent(t)}`)).status).toBe(200);
    expect((await req("/auth", { form: { t } })).status).toBe(303);
    expect((await req("/auth", { form: { t } })).status).toBe(400);
  });

  it("expired links are refused", async () => {
    const inv = await addInvestor();
    const link = await requestLink(inv.email);
    await env.DB.prepare("UPDATE login_tokens SET expires_at = ? WHERE email = ?").bind(Date.now() - 1, inv.email).run();
    const t = new URL(link!).searchParams.get("t")!;
    expect((await req("/auth", { form: { t } })).status).toBe(400);
  });

  it("stores only hashes of tokens and sessions", async () => {
    const inv = await addInvestor();
    const link = await requestLink(inv.email);
    const t = new URL(link!).searchParams.get("t")!;
    expect(await env.DB.prepare("SELECT 1 FROM login_tokens WHERE token_hash = ?").bind(t).first()).toBeNull();
    const cookie = (await req("/auth", { form: { t } })).headers.get("set-cookie")!.split(";")[0].split("=")[1];
    expect(await env.DB.prepare("SELECT 1 FROM sessions WHERE id_hash = ?").bind(cookie).first()).toBeNull();
  });

  it("limits sign-in emails to 5 per 15 minutes", async () => {
    const inv = await addInvestor();
    for (let i = 0; i < 7; i++) await req("/login", { form: { email: inv.email } });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ?").bind(inv.email).first<{ n: number }>();
    expect(row?.n).toBe(5);
  });

  it("rejects form posts from other sites", async () => {
    expect((await req("/login", { form: { email: ADMIN }, origin: "https://evil.test" })).status).toBe(403);
    expect((await req("/login", { form: { email: ADMIN }, origin: null })).status).toBe(403);
    expect((await req("/login", { form: { email: ADMIN }, origin: "null" })).status).toBe(403);
  });
});

describe("investor access", () => {
  it("shows only granted folders and only visible files", async () => {
    const granted = await addFolder();
    const other = await addFolder();
    const visible = await addFile(granted, { name: "Cap table.pdf" });
    await addFile(granted, { name: "Hidden plan.pdf", published: false });
    await addFile(other, { name: "Other folder secret.pdf" });
    const inv = await addInvestor({ folders: [granted] });
    const cookie = await signIn(inv.email);

    const html = await (await req("/room", { cookie })).text();
    expect(html).toContain("Cap table.pdf");
    expect(html).toContain(`/d/${visible}`);
    expect(html).not.toContain("Hidden plan.pdf");
    expect(html).not.toContain("Other folder secret.pdf");
    expect(html).not.toContain(`Folder ${other}`);
  });

  it("returns 404 for files outside the investor's folders, hidden files and unknown ids", async () => {
    const granted = await addFolder();
    const other = await addFolder();
    const hidden = await addFile(granted, { published: false });
    const elsewhere = await addFile(other);
    const inv = await addInvestor({ folders: [granted] });
    const cookie = await signIn(inv.email);
    for (const id of [hidden, elsewhere, "not-a-real-id"]) {
      expect((await req(`/d/${id}`, { cookie })).status).toBe(404);
      expect((await req(`/d/${id}/view`, { cookie })).status).toBe(404);
      expect((await req(`/d/${id}/download`, { cookie })).status).toBe(404);
    }
  });

  it("needs a session for every file url", async () => {
    const folder = await addFolder({ download: true });
    const file = await addFile(folder);
    for (const p of [`/room`, `/d/${file}`, `/d/${file}/view`, `/d/${file}/download`]) {
      const res = await req(p);
      expect(res.status).toBe(302);
      // A document page remembers where you were going; nothing else does.
      expect(res.headers.get("location")).toBe(p === `/d/${file}` ? `/?next=${encodeURIComponent(p)}` : "/");
    }
  });

  it("download is set file by file: off by default, on only where switched on", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    const fd = new FormData();
    fd.append("files", new File([await makePdf()], "Memo.pdf", { type: "application/pdf" }));
    fd.append("files", new File([await makePdf()], "SAFE.pdf", { type: "application/pdf" }));
    fd.append("publish", "on");
    await req(`/admin/folders/${folder}/upload`, { cookie: admin, form: fd });
    const files = await env.DB.prepare("SELECT id, name, allow_download FROM files WHERE folder_id = ? ORDER BY name").bind(folder).all<{ id: string; name: string; allow_download: number }>();
    expect(files.results.map((f) => f.allow_download)).toEqual([0, 0]);
    const [memo, safe] = files.results;

    const on = await req(`/admin/files/${safe.id}`, { cookie: admin, form: { action: "download_on" } });
    expect(on.status).toBe(303);
    expect(await (await req("/admin", { cookie: admin })).text()).toContain("1 downloadable");

    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    expect((await req(`/d/${safe.id}/download`, { cookie })).status).toBe(200);
    expect((await req(`/d/${memo.id}/download`, { cookie })).status).toBe(404);
    expect(await (await req(`/d/${memo.id}`, { cookie })).text()).not.toContain("/download");

    await req(`/admin/files/${safe.id}`, { cookie: admin, form: { action: "download_off" } });
    expect((await req(`/d/${safe.id}/download`, { cookie })).status).toBe(404);
  });

  it("blocks downloads when the file is view only", async () => {
    const folder = await addFolder({ download: false });
    const file = await addFile(folder);
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    expect((await req(`/d/${file}/view`, { cookie })).status).toBe(200);
    expect((await req(`/d/${file}/download`, { cookie })).status).toBe(404);
    expect(await (await req(`/d/${file}`, { cookie })).text()).not.toContain("/download");
  });

  it("hides PowerPoint files in view-only folders, since they cannot open in the browser", async () => {
    const folder = await addFolder({ download: false });
    const pptx = await addFile(folder, { name: "Deck.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: new Uint8Array([80, 75, 3, 4]) });
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    expect(await (await req("/room", { cookie })).text()).not.toContain("Deck.pptx");
    expect((await req(`/d/${pptx}`, { cookie })).status).toBe(404);
  });

  it("opens Excel and CSV as a stamped table in the browser, even in view-only folders", async () => {
    const folder = await addFolder({ download: false, watermark: true });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Month", "Revenue"], ["Oct 2026", 1234], ["<b>x</b>", 5]]), "Actuals");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Plan"]]), "Plan");
    const xlsxBytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    const xlsx = await addFile(folder, { name: "Model.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: xlsxBytes });
    const csv = await addFile(folder, { name: "Cap table.csv", type: "text/csv", bytes: new TextEncoder().encode("Holder,Shares\nAda,100\n") });
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);

    const room = await (await req("/room", { cookie })).text();
    expect(room).toContain("Model.xlsx");
    expect(room).toContain("Cap table.csv");
    expect(await (await req(`/d/${xlsx}`, { cookie })).text()).toContain(`class="frame page sheet"`);

    const res = await req(`/d/${xlsx}/view`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
    const html = await res.text();
    expect(html).toContain("Oct 2026");
    expect(html).toContain("Actuals");
    expect(html).toContain("Plan");
    expect(html).toContain(`Shared with ${inv.email}`);
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<script");

    const csvHtml = await (await req(`/d/${csv}/view`, { cookie })).text();
    expect(csvHtml).toContain("Ada");
    expect((await req(`/d/${xlsx}/download`, { cookie })).status).toBe(404);
  });

  it("opens Word files as a page in the browser", async () => {
    const folder = await addFolder({ download: false });
    const docx = await addFile(folder, {
      name: "Bylaws.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await makeDocx("Article I. Name of the company"),
    });
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    const html = await (await req(`/d/${docx}/view`, { cookie })).text();
    expect(html).toContain("Article I. Name of the company");
    expect(html).toContain('class="doc"');
  });

  it("shows landscape PDFs (slides) in a wide frame that fits the whole page", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    const slides = await PDFDocument.create();
    slides.addPage([1280, 720]);
    const fd = new FormData();
    fd.append("files", new File([await slides.save()], "Slides.pdf", { type: "application/pdf" }));
    fd.append("files", new File([await makePdf()], "Memo.pdf", { type: "application/pdf" }));
    fd.append("publish", "on");
    await req(`/admin/folders/${folder}/upload`, { cookie: admin, form: fd });
    const rows = await env.DB.prepare("SELECT id, name, orientation FROM files WHERE folder_id = ? ORDER BY name").bind(folder).all<{ id: string; name: string; orientation: string }>();
    expect(rows.results.map((r) => [r.name, r.orientation])).toEqual([["Memo.pdf", "portrait"], ["Slides.pdf", "landscape"]]);
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    const page = await (await req(`/d/${rows.results[1].id}`, { cookie })).text();
    expect(page).toContain(`class="frame pdf landscape"`);
    expect(page).toContain("view=Fit");
  });

  it("stamps PDFs with the investor's email", async () => {
    const folder = await addFolder({ download: true, watermark: true });
    const file = await addFile(folder);
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    for (const p of [`/d/${file}/view`, `/d/${file}/download`]) {
      const res = await req(p, { cookie });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const pdf = await PDFDocument.load(await res.arrayBuffer());
      expect(pdf.getSubject()).toContain(inv.email);
    }
    expect((await req(`/d/${file}/download`, { cookie })).headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("refuses to serve a PDF it cannot stamp", async () => {
    const folder = await addFolder({ watermark: true });
    const broken = new TextEncoder().encode("%PDF-1.7 this is not really a pdf");
    const file = await addFile(folder, { bytes: broken });
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    expect((await req(`/d/${file}/view`, { cookie })).status).toBe(422);
  });

  it("logs views once per minute per file", async () => {
    const folder = await addFolder();
    const file = await addFile(folder);
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    await req(`/d/${file}/view`, { cookie });
    await req(`/d/${file}/view`, { cookie });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE email = ? AND action = 'view'").bind(inv.email).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("revoking or expiring cuts off an existing session at once", async () => {
    const folder = await addFolder();
    const file = await addFile(folder);
    const a = await addInvestor({ folders: [folder] });
    const b = await addInvestor({ folders: [folder] });
    const ca = await signIn(a.email);
    const cb = await signIn(b.email);
    await env.DB.prepare("UPDATE investors SET revoked_at = ? WHERE id = ?").bind(Date.now(), a.id).run();
    await env.DB.prepare("UPDATE investors SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, b.id).run();
    expect((await req(`/d/${file}/view`, { cookie: ca })).status).toBe(302);
    expect((await req(`/d/${file}/view`, { cookie: cb })).status).toBe(302);
  });

  it("removing a folder grant takes effect on the next request", async () => {
    const folder = await addFolder();
    const file = await addFile(folder);
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    expect((await req(`/d/${file}/view`, { cookie })).status).toBe(200);
    await env.DB.prepare("DELETE FROM grants WHERE investor_id = ?").bind(inv.id).run();
    expect((await req(`/d/${file}/view`, { cookie })).status).toBe(404);
  });

  it("investors cannot reach any admin page or action", async () => {
    const folder = await addFolder();
    const file = await addFile(folder);
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    expect((await req("/admin", { cookie })).status).toBe(404);
    expect((await req("/admin/investors", { cookie })).status).toBe(404);
    expect((await req(`/admin/files/${file}/preview`, { cookie })).status).toBe(404);
    expect((await req(`/admin/files/${file}`, { cookie })).status).toBe(404);
    expect((await req(`/admin/files/${file}/delete`, { cookie, form: {} })).status).toBe(404);
    expect((await req("/admin/investors", { cookie, form: { email: "x@y.test" } })).status).toBe(404);
  });
});

describe("admin", () => {
  it("only emails in ADMIN_EMAILS get the admin view", async () => {
    const res = await req("/admin", { cookie: await adminSession() });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("New folder");
  });

  it("creates a folder, uploads, adds an investor with that folder, and the investor sees it", async () => {
    const admin = await adminSession();
    const name = uid("Corporate");
    await req("/admin/folders", { cookie: admin, form: { name, watermark: "on" } });
    const folder = await env.DB.prepare("SELECT id FROM folders WHERE name = ?").bind(name).first<{ id: string }>();
    expect(folder).toBeTruthy();

    const fd = new FormData();
    fd.append("files", new File([await makePdf()], "Certificate of incorporation.pdf", { type: "application/pdf" }));
    fd.append("files", new File([await makePdf()], "Bylaws DRAFT.pdf", { type: "application/pdf" }));
    fd.append("publish", "on");
    const up = await req(`/admin/folders/${folder!.id}/upload`, { cookie: admin, form: fd });
    expect(up.status).toBe(303);
    expect(up.headers.get("location")).toContain("n=2&held=1");

    const files = await env.DB.prepare("SELECT name, published, r2_key FROM files WHERE folder_id = ? ORDER BY name").bind(folder!.id).all<{ name: string; published: number; r2_key: string }>();
    expect(files.results.map((f) => [f.name, f.published])).toEqual([
      ["Bylaws DRAFT.pdf", 0],
      ["Certificate of incorporation.pdf", 1],
    ]);

    const email = `${uid("lp")}@fund.test`.toLowerCase();
    const add = await req("/admin/investors", { cookie: admin, form: { email, name: "Lee", firm: "Plug and Play", folders: [folder!.id], invite: "on" } });
    expect(add.status).toBe(303);
    const mails = (await (await req("/__test/outbox")).json()) as { to: string; subject: string }[];
    expect(mails.some((m) => m.to === email && m.subject.includes("data room"))).toBe(true);

    const cookie = await signIn(email);
    const room = await (await req("/room", { cookie })).text();
    expect(room).toContain("Certificate of incorporation.pdf");
    expect(room).not.toContain("Bylaws DRAFT.pdf");
  });

  it("opens a file on a viewer page inside the room, with the original unstamped", async () => {
    const admin = await adminSession();
    const folder = await addFolder({ watermark: true });
    const file = await addFile(folder, { name: "Bylaws.pdf" });
    const page = await req(`/admin/files/${file}`, { cookie: admin });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`<iframe src="/admin/files/${file}/preview`);
    expect(html).toContain("Who opened it");
    const raw = await req(`/admin/files/${file}/preview`, { cookie: admin });
    expect(raw.headers.get("content-disposition")).toMatch(/^inline/);
    expect((await PDFDocument.load(await raw.arrayBuffer())).getSubject()).toBeUndefined();
    const dl = await req(`/admin/files/${file}/preview?download=1`, { cookie: admin });
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment/);
    const hide = await req(`/admin/files/${file}`, { cookie: admin, form: { action: "hide", back: "file" } });
    expect(hide.headers.get("location")).toBe(`/admin/files/${file}?m=file_saved`);
  });

  it("Preview shows the room on the investor screens, stamped, without logging anything", async () => {
    const admin = await adminSession();
    const granted = await addFolder({ watermark: true });
    const other = await addFolder({ watermark: true });
    const shown = await addFile(granted, { name: "Deck.pdf" });
    const hidden = await addFile(granted, { name: "Hidden notes.pdf", published: false });
    const elsewhere = await addFile(other, { name: "Other.pdf" });
    const inv = await addInvestor({ folders: [granted] });

    // Everything visible
    const all = await (await req("/admin/preview", { cookie: admin })).text();
    expect(all).toContain("Preview.");
    expect(all).toContain(`/admin/preview/d/${shown}`);
    expect(all).toContain(`/admin/preview/d/${elsewhere}`);
    expect(all).not.toContain("Hidden notes.pdf");
    expect(all).not.toContain('aria-label="Admin"');
    expect((await req(`/admin/preview/d/${hidden}`, { cookie: admin })).status).toBe(404);

    // One investor: only their folders, stamped with their email
    const mine = await (await req(`/admin/preview/i/${inv.id}`, { cookie: admin })).text();
    expect(mine).toContain("Deck.pdf");
    expect(mine).not.toContain("Other.pdf");
    expect((await req(`/admin/preview/i/${inv.id}/d/${elsewhere}`, { cookie: admin })).status).toBe(404);
    const pdf = await req(`/admin/preview/i/${inv.id}/d/${shown}/view`, { cookie: admin });
    expect((await PDFDocument.load(await pdf.arrayBuffer())).getSubject()).toContain(inv.email);

    // One file, even hidden
    const one = await req(`/admin/preview/f/${hidden}`, { cookie: admin });
    expect(one.status).toBe(200);
    expect(await one.text()).toContain("This file is Hidden");
    const raw = await req(`/admin/preview/f/${hidden}/view`, { cookie: admin });
    expect((await PDFDocument.load(await raw.arrayBuffer())).getSubject()).toContain("investor@fund.com");

    const logged = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE file_id IN (?, ?, ?)").bind(shown, hidden, elsewhere).first<{ n: number }>();
    expect(logged?.n).toBe(0);
  });

  it("Preview is admin only", async () => {
    const folder = await addFolder();
    const file = await addFile(folder);
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    for (const p of ["/admin/preview", `/admin/preview/d/${file}/view`, `/admin/preview/i/${inv.id}`, `/admin/preview/f/${file}/view`]) {
      expect((await req(p, { cookie })).status).toBe(404);
      expect((await req(p)).status).toBe(302);
    }
  });

  it("a file can have a custom link, which still checks access", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    const other = await addFolder();
    const file = await addFile(folder, { name: "Pitch Deck.pdf" });
    const second = await addFile(other, { name: "Other.pdf" });
    const slug = uid("pitch-deck").toLowerCase().replace(/_/g, "-");

    expect((await req(`/admin/files/${file}`, { cookie: admin, form: { action: "slug", slug: "No Good!" } })).headers.get("location")).toContain("slug_saved");
    expect((await env.DB.prepare("SELECT slug FROM files WHERE id = ?").bind(file).first<{ slug: string }>())?.slug).toBe("no-good");
    expect((await req(`/admin/files/${file}`, { cookie: admin, form: { action: "slug", slug: "x" } })).headers.get("location")).toContain("slug_invalid");
    await req(`/admin/files/${file}`, { cookie: admin, form: { action: "slug", slug } });
    expect((await req(`/admin/files/${second}`, { cookie: admin, form: { action: "slug", slug } })).headers.get("location")).toContain("slug_taken");

    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    expect(await (await req("/room", { cookie })).text()).toContain(`href="/d/${slug}"`);
    expect((await req(`/d/${slug}`, { cookie })).status).toBe(200);
    expect((await req(`/d/${slug}/view`, { cookie })).status).toBe(200);
    expect((await req(`/d/${file}`, { cookie })).status).toBe(200);

    const outsider = await addInvestor({ folders: [other] });
    const oc = await signIn(outsider.email);
    expect((await req(`/d/${slug}`, { cookie: oc })).status).toBe(404);
    expect((await req(`/d/${slug}/view`, { cookie: oc })).status).toBe(404);
  });

  it("replacing a file keeps its id, link, access, settings and history", async () => {
    const admin = await adminSession();
    const folder = await addFolder({ download: true });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Version", "One"]]), "S");
    const file = await addFile(folder, { name: "Model.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })) });
    const slug = uid("model").toLowerCase().replace(/_/g, "-");
    await req(`/admin/files/${file}`, { cookie: admin, form: { action: "slug", slug } });
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    expect(await (await req(`/d/${slug}/view`, { cookie })).text()).toContain("One");

    const book2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book2, XLSX.utils.aoa_to_sheet([["Version", "Two"]]), "S");
    const fd = new FormData();
    fd.append("file", new File([XLSX.write(book2, { type: "array", bookType: "xlsx" })], "Model v2 final.xlsx"));
    const res = await req(`/admin/files/${file}/replace`, { cookie: admin, form: fd });
    expect(res.headers.get("location")).toContain("m=replaced");

    const row = await env.DB.prepare("SELECT id, name, slug, allow_download, published FROM files WHERE id = ?").bind(file).first();
    expect(row).toMatchObject({ id: file, name: "Model.xlsx", slug, allow_download: 1, published: 1 });
    const html = await (await req(`/d/${slug}/view`, { cookie })).text();
    expect(html).toContain("Two");
    expect(html).not.toContain(">One<");

    // Replacing a PowerPoint with its PDF export keeps the name, swaps the extension.
    const pptx = await addFile(folder, { name: "Deck.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: new Uint8Array([80, 75, 3, 4]) });
    const fd2 = new FormData();
    fd2.append("file", new File([await makePdf()], "export.pdf"));
    await req(`/admin/files/${pptx}/replace`, { cookie: admin, form: fd2 });
    const after = await env.DB.prepare("SELECT name, content_type FROM files WHERE id = ?").bind(pptx).first();
    expect(after).toMatchObject({ name: "Deck.pdf", content_type: "application/pdf" });
  });

  it("will not publish a file whose name says draft or internal", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    const file = await addFile(folder, { name: "SAFE Amendment (DRAFT).docx", published: false });
    const res = await req(`/admin/files/${file}`, { cookie: admin, form: { action: "publish" } });
    expect(res.headers.get("location")).toContain("m=file_internal");
    const row = await env.DB.prepare("SELECT published FROM files WHERE id = ?").bind(file).first<{ published: number }>();
    expect(row?.published).toBe(0);
  });

  it("revoke signs the investor out and stops new links", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    await addFile(folder);
    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    await req(`/admin/investors/${inv.id}/revoke`, { cookie: admin, form: {} });
    expect((await req("/room", { cookie })).status).toBe(302);
    expect(await env.DB.prepare("SELECT 1 FROM sessions WHERE email = ?").bind(inv.email).first()).toBeNull();
    const before = await lastLinkFor(inv.email);
    await req("/login", { form: { email: inv.email } });
    expect(await lastLinkFor(inv.email)).toBe(before);
  });

  it("grants can be changed folder by folder", async () => {
    const admin = await adminSession();
    const f1 = await addFolder();
    const f2 = await addFolder();
    const inv = await addInvestor({ folders: [f1] });
    await req(`/admin/investors/${inv.id}`, { cookie: admin, form: { name: "Ada", firm: "", expires: "", folders: [f2, "bogus-folder"] } });
    const rows = await env.DB.prepare("SELECT folder_id FROM grants WHERE investor_id = ?").bind(inv.id).all<{ folder_id: string }>();
    expect(rows.results.map((r) => r.folder_id)).toEqual([f2]);
  });

  it("escapes names so an uploaded file cannot inject HTML", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    await addFile(folder, { name: `<img src=x onerror=alert(1)>.pdf` });
    const html = await (await req("/admin", { cookie: admin })).text();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("never shows sign-in links on the page outside a local address", async () => {
    const res = await req("/login", { form: { email: ADMIN } });
    expect(await res.text()).not.toContain("/auth?t=");
  });

  it("takes its branding from the BRAND_* settings", async () => {
    const page = await (await req("/")).text();
    expect(page).toContain("Openroom data room");
    expect(page).toContain("family=Inter");
    expect(page).toMatch(/href="\/theme\.css\?v=[a-z0-9]+"/);
    expect(page).toContain("Powered by");
    const css = await (await req("/theme.css")).text();
    expect(css).toContain("--blue:#2563EB");
    expect(css).toContain("--navy:#0F172A");
  });

  it("sends strict security headers", async () => {
    const res = await req("/");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(res.headers.get("strict-transport-security")).toBeTruthy();
  });
});

describe("branding tab", () => {
  const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (ch) => ch.charCodeAt(0));
  const SVG = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>`);
  const logo = (bytes: Uint8Array, name: string) => {
    const fd = new FormData();
    fd.append("file", new File([bytes], name));
    return fd;
  };

  it("is for admins only", async () => {
    const inv = await addInvestor();
    const cookie = await signIn(inv.email);
    expect((await req("/admin/branding", { cookie })).status).toBe(404);
    expect((await req("/admin/branding", { cookie, form: { name: "Hacked" } })).status).toBe(404);
    expect((await req("/admin/branding/reset", { cookie, form: {} })).status).toBe(404);
    expect((await req("/admin/branding")).status).toBe(302);
    expect((await req("/admin/branding", { form: { name: "Hacked" } })).status).toBe(302);
  });

  it("changes names, colours and fonts with no redeploy, and checks every value", async () => {
    const admin = await adminSession();
    const before = await (await req("/")).text();
    let res = await req("/admin/branding", { cookie: admin, form: { name: "Acme", legalName: "Acme Inc.", inviter: "Ada at Acme", color: "#ff0000", dark: "#112233", fontBody: "DM Sans", fontDisplay: "" } });
    expect(res.headers.get("location")).toContain("m=saved");
    const page = await (await req("/")).text();
    expect(page).toContain("Acme data room");
    expect(page).toContain("Acme Inc. Confidential.");
    expect(page).not.toContain("Inc..");
    // The stylesheet address changes with the theme, so browsers never keep the old colours.
    expect(page.match(/theme\.css\?v=(\w+)/)?.[1]).not.toBe(before.match(/theme\.css\?v=(\w+)/)?.[1]);
    expect(page).toContain("family=DM+Sans");
    const css = await (await req("/theme.css")).text();
    expect(css).toContain("--blue:#FF0000");
    expect(css).toContain("--navy:#112233");

    for (const [form, code] of [
      [{ color: "red" }, "m=color"],
      [{ color: "#ff00001;}body{display:none" }, "m=color"],
      [{ fontBody: 'Inter";}body{x:y' }, "m=font"],
      [{ name: "<script>" }, "m=text"],
    ] as const) {
      res = await req("/admin/branding", { cookie: admin, form });
      expect(res.headers.get("location")).toContain(code);
    }
    expect(await (await req("/theme.css")).text()).toContain("--blue:#FF0000");
  });

  it("takes PNG and SVG logos, never serves an SVG as a page, and refuses anything else", async () => {
    const admin = await adminSession();
    let res = await req("/admin/branding/logo/header", { cookie: admin, form: logo(PNG, "logo.png") });
    expect(res.headers.get("location")).toContain("m=logo_saved");
    const page = await (await req("/")).text();
    const src = page.match(/src="(\/brand\/header\?v=\d+)"/)?.[1];
    expect(src).toBeTruthy();
    res = await req(src!);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);

    res = await req("/admin/branding/logo/icon", { cookie: admin, form: logo(SVG, "icon.svg") });
    expect(res.headers.get("location")).toContain("m=logo_saved");
    res = await req("/brand/icon");
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");

    // Emails cannot show SVG; an HTML file named .png is not an image; big files are refused.
    res = await req("/admin/branding/logo/email", { cookie: admin, form: logo(SVG, "logo.svg") });
    expect(res.headers.get("location")).toContain("m=logo_type");
    res = await req("/admin/branding/logo/header", { cookie: admin, form: logo(new TextEncoder().encode("<html><script>alert(1)</script>"), "logo.png") });
    expect(res.headers.get("location")).toContain("m=logo_type");
    const big = new Uint8Array(600 * 1024);
    big.set(PNG);
    res = await req("/admin/branding/logo/header", { cookie: admin, form: logo(big, "big.png") });
    expect(res.headers.get("location")).toContain("m=logo_big");
    expect((await req("/brand/nope")).status).toBe(404);
    expect((await req("/brand/email")).status).toBe(404);
  });

  it("uses an uploaded PNG in emails, and resets to the deployment defaults", async () => {
    const admin = await adminSession();
    await req("/admin/branding/logo/email", { cookie: admin, form: logo(PNG, "mail.png") });
    const inv = await addInvestor();
    await requestLink(inv.email);
    const mails = (await (await req("/__test/outbox")).json()) as { to: string; html: string }[];
    expect(mails.filter((m) => m.to === inv.email).pop()!.html).toMatch(/https:\/\/dataroom\.test\/brand\/email\?v=\d+/);

    const res = await req("/admin/branding/reset", { cookie: admin, form: {} });
    expect(res.headers.get("location")).toContain("m=reset");
    const page = await (await req("/")).text();
    expect(page).toContain("Openroom data room");
    expect(page).toContain("/static/logo-white.svg");
    expect((await req("/brand/header")).status).toBe(404);
    expect(await (await req("/theme.css")).text()).toContain("--blue:#2563EB");
  });
});

describe("blank APP_ORIGIN (Cloudflare one-click deploys)", () => {
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const post = (url: string, origin: string) =>
    app.fetch(new Request(url, { method: "POST", headers: { origin }, body: new URLSearchParams({ email: "nobody@nowhere.test" }) }), { ...env, APP_ORIGIN: "" }, ctx);

  it("uses the address the room was opened on, and still blocks other sites", async () => {
    const own = "https://openroom.someone.workers.dev";
    const res = await post(`${own}/login`, own);
    expect(res.status).toBe(200);
    expect(res.headers.get("strict-transport-security")).toBeTruthy();
    expect((await post(`${own}/login`, "https://evil.example")).status).toBe(403);
  });
});

describe("first-time setup", () => {
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  /** The same room with no ADMIN_EMAILS: a brand new deployment from the Deploy button. */
  const fresh = (path: string, opts: Opts = {}) => {
    const headers = new Headers();
    if (opts.cookie) headers.set("cookie", opts.cookie);
    const method = opts.method ?? (opts.form ? "POST" : "GET");
    if (method !== "GET") headers.set("origin", ORIGIN);
    let body: BodyInit | undefined;
    if (opts.form instanceof FormData) body = opts.form;
    else if (opts.form) body = new URLSearchParams(opts.form as Record<string, string>);
    return app.fetch(new Request(ORIGIN + path, { method, headers, body, redirect: "manual" }), { ...env, ADMIN_EMAILS: "" }, ctx);
  };
  const FOUNDER = "founder@startup.test";
  const KEY = "re_test_1234567890abcdef";
  const codeFor = async (email: string) => {
    const mails = (await (await req("/__test/outbox")).json()) as { to: string; subject: string }[];
    return mails.filter((m) => m.to === email && m.subject.startsWith("Your setup code")).pop()?.subject.match(/\d{6}/)?.[0];
  };

  it("never shows on a room deployed with ADMIN_EMAILS", async () => {
    expect((await req("/setup")).headers.get("location")).toBe("/");
    const res = await req("/setup/start", { form: { email: "attacker@evil.test", resendApiKey: KEY } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(await codeFor("attacker@evil.test")).toBeUndefined();
  });

  it("sends a brand new room to setup, and checks the email and key", async () => {
    expect((await fresh("/")).headers.get("location")).toBe("/setup");
    expect((await fresh("/admin")).headers.get("location")).toBe("/setup");
    expect((await fresh("/login", { form: { email: FOUNDER } })).status).toBe(404);
    expect((await fresh("/theme.css")).status).toBe(200);
    expect(await (await fresh("/setup")).text()).toContain("Set up your data room");
    // Step 1 checks the email, remembers it, and moves on to the Resend step; Back returns with it filled in.
    expect((await fresh("/setup/email", { form: { email: "nope" } })).status).toBe(400);
    expect((await fresh("/setup/key")).headers.get("location")).toBe("/setup");
    const step1 = await fresh("/setup/email", { form: { email: FOUNDER } });
    expect(step1.headers.get("location")).toBe("/setup/key");
    const draft = step1.headers.get("set-cookie")!.split(";")[0];
    const step2 = await (await fresh("/setup/key", { cookie: draft })).text();
    expect(step2).toContain("Connect email sending");
    expect(step2).toContain(FOUNDER);
    expect(step2).toContain('href="/setup">← Back');
    expect(await (await fresh("/setup", { cookie: draft })).text()).toContain(`value="${FOUNDER}"`);
    expect((await fresh("/setup/code")).headers.get("location")).toBe("/setup?m=expired");
    expect((await fresh("/setup/start", { form: { email: "nope", resendApiKey: KEY } })).status).toBe(400);
    expect((await fresh("/setup/start", { form: { email: FOUNDER, resendApiKey: "not-a-resend-key" } })).status).toBe(400);
    expect((await fresh("/setup/start", { form: { email: FOUNDER, resendApiKey: KEY, mailFrom: "x\r\nBcc: a@b.c" } })).status).toBe(400);
    expect((await fresh("/setup/brand")).headers.get("location")).toBe("/"); // and "/" leads to /setup
  });

  it("throws a code away after five wrong tries", async () => {
    const start = await fresh("/setup/start", { form: { email: FOUNDER, resendApiKey: KEY } });
    expect(start.headers.get("location")).toBe("/setup/code");
    expect(await (await fresh("/setup/code")).text()).toContain('href="/setup/key">← Back');
    const code = await codeFor(FOUNDER);
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i <= 4; i++) {
      const res = await fresh("/setup/verify", { form: { code: wrong } });
      expect(res.headers.get("location")).toBe(`/setup/code?m=wrong&left=${5 - i}`);
    }
    expect(await (await fresh("/setup/code?m=wrong&left=2")).text()).toContain("2 tries left");
    expect((await fresh("/setup/verify", { form: { code: wrong } })).headers.get("location")).toBe("/setup?m=toomany");
    expect((await fresh("/setup/resend", { form: {} })).headers.get("location")).toBe("/setup?m=expired"); // nothing pending any more
    const late = await fresh("/setup/verify", { form: { code: code! } });
    expect(late.headers.get("location")).toBe("/setup?m=expired");
    expect(late.headers.get("set-cookie")).toBeNull();
  });

  it("makes the first verified visitor the owner, exactly once", async () => {
    await fresh("/setup/start", { form: { email: FOUNDER, resendApiKey: KEY } });
    const first = await codeFor(FOUNDER);
    // "Send a new code": the newest code works, the previous one does not.
    expect((await fresh("/setup/resend", { form: {} })).headers.get("location")).toBe("/setup/code?m=new");
    expect(await (await fresh("/setup/code?m=new")).text()).toContain("A new code is on its way");
    const second = await codeFor(FOUNDER);
    if (first !== second) expect((await fresh("/setup/verify", { form: { code: first! } })).headers.get("location")).toContain("m=wrong");
    const res = await fresh("/setup/verify", { form: { code: second! } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/setup/room");
    const cookie = res.headers.get("set-cookie")!.split(";")[0];

    // Step 4: the template choice. This shared test room already has folders, so nothing is added twice.
    expect(await (await fresh("/setup/room", { cookie })).text()).toContain("Investor data room");
    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM folders").first<{ n: number }>())!.n;
    expect((await fresh("/setup/room", { cookie, form: { template: "investor" } })).headers.get("location")).toBe("/setup/brand");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM folders").first<{ n: number }>())!.n).toBe(before);

    // Step 2 and 3.
    expect((await fresh("/setup/brand", { cookie })).status).toBe(200);
    expect((await fresh("/setup/brand", { cookie, form: { name: "<b>x</b>" } })).status).toBe(400);
    const fd = new FormData();
    fd.append("name", "Founder Co");
    fd.append("color", "#0e9f6e");
    fd.append("dark", "#1b2a41");
    expect((await fresh("/setup/brand", { cookie, form: fd })).headers.get("location")).toBe("/setup/done");
    expect(await (await fresh("/setup/done", { cookie })).text()).toContain("The Founder Co data room is ready");
    expect((await fresh("/admin", { cookie })).status).toBe(200);
    expect(await (await fresh("/")).text()).toContain("Founder Co data room");

    // The key is saved for sign-in emails; nobody else can claim the room now.
    const mail = await env.DB.prepare("SELECT value FROM settings WHERE key = 'mail'").first<{ value: string }>();
    expect(JSON.parse(mail!.value).resendApiKey).toBe(KEY);
    expect((await fresh("/setup")).headers.get("location")).toBe("/");
    const again = await fresh("/setup/start", { form: { email: "late@evil.test", resendApiKey: KEY } });
    expect(again.headers.get("location")).toBe("/");
    expect(await codeFor("late@evil.test")).toBeUndefined();

    // The owner signs in later like any admin.
    await fresh("/login", { form: { email: FOUNDER } });
    const mails = (await (await req("/__test/outbox")).json()) as { to: string; link?: string }[];
    expect(mails.some((m) => m.to === FOUNDER && m.link)).toBe(true);

    // Leave the shared room's branding as the other tests expect it.
    await env.DB.prepare("DELETE FROM settings WHERE key = 'brand'").run();
  });
});

describe("subfolders, templates and placeholders", () => {
  async function addSubfolder(parent: string) {
    const id = uid("sub");
    await env.DB.prepare("INSERT INTO folders (id, name, description, position, watermark, created_at, parent_id) VALUES (?, ?, '', 0, 1, ?, ?)")
      .bind(id, `Sub ${id}`, Date.now(), parent)
      .run();
    return id;
  }

  it("shows a subfolder's files only through the grant on its top folder", async () => {
    const top = await addFolder();
    const sub = await addSubfolder(top);
    const other = await addSubfolder(await addFolder());
    const inSub = await addFile(sub, { name: "In sub.pdf" });
    const elsewhere = await addFile(other, { name: "Elsewhere.pdf" });
    const inv = await addInvestor({ folders: [top] });
    const cookie = await signIn(inv.email);
    const room = await (await req("/room", { cookie })).text();
    expect(room).toContain("In sub.pdf");
    expect(room).not.toContain("Elsewhere.pdf");
    expect((await req(`/d/${inSub}`, { cookie })).status).toBe(200);
    expect((await req(`/d/${elsewhere}`, { cookie })).status).toBe(404);
    expect((await req(`/d/${elsewhere}/view`, { cookie })).status).toBe(404);
  });

  it("never lets access be granted on a subfolder directly", async () => {
    const admin = await adminSession();
    const sub = await addSubfolder(await addFolder());
    const email = `${uid("direct")}@fund.test`.toLowerCase();
    await req("/admin/investors", { cookie: admin, form: { email, name: "Direct", folders: [sub] } });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM grants g JOIN investors i ON i.id = g.investor_id WHERE i.email = ?").bind(email).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it("keeps placeholders hidden until replaced, then shows the real document", async () => {
    const admin = await adminSession();
    const top = await addFolder();
    const sub = await addSubfolder(top);
    const ph = await addFile(sub, { name: "Pitch deck.pdf", published: false });
    await env.DB.prepare("UPDATE files SET placeholder = 1 WHERE id = ?").bind(ph).run();
    const inv = await addInvestor({ folders: [top] });
    const cookie = await signIn(inv.email);

    // Cannot be made visible as it is; even if a row were marked published, it is not served.
    const pub = await req(`/admin/files/${ph}`, { cookie: admin, form: { action: "publish" } });
    expect(pub.headers.get("location")).toContain("m=placeholder_publish");
    await env.DB.prepare("UPDATE files SET published = 1 WHERE id = ?").bind(ph).run();
    expect((await req(`/d/${ph}`, { cookie })).status).toBe(404);
    expect(await (await req("/room", { cookie })).text()).not.toContain("Pitch deck.pdf");
    await env.DB.prepare("UPDATE files SET published = 0 WHERE id = ?").bind(ph).run();

    // Upload your version: same place and name, now real and visible.
    const fd = new FormData();
    fd.append("file", new File([await makePdf("our real deck")], "deck-final.pdf"));
    const res = await req(`/admin/files/${ph}/replace`, { cookie: admin, form: fd });
    expect(res.headers.get("location")).toContain("m=replaced_placeholder");
    const row = await env.DB.prepare("SELECT name, published, placeholder FROM files WHERE id = ?").bind(ph).first();
    expect(row).toEqual({ name: "Pitch deck.pdf", published: 1, placeholder: 0 });
    expect((await req(`/d/${ph}`, { cookie })).status).toBe(200);
  });

  it("asks before deleting a folder, then deletes it with everything in it", async () => {
    const admin = await adminSession();
    const top = await addFolder();
    const sub = await addSubfolder(top);
    const inTop = await addFile(top, { name: "Top.pdf" });
    const inSub = await addFile(sub, { name: "Sub.pdf", published: false });
    const inv = await addInvestor({ folders: [top] });

    // Without the confirmation step nothing happens: it goes to the "Are you sure?" page.
    const blind = await req(`/admin/folders/${top}/delete`, { cookie: admin, form: {} });
    expect(blind.headers.get("location")).toBe(`/admin/folders/${top}/delete`);
    const ask = await (await req(`/admin/folders/${top}/delete`, { cookie: admin })).text();
    expect(ask).toContain("1 subfolder");
    expect(ask).toContain("2 documents (1 visible to investors)");
    expect(ask).toContain("access for 1 investor");
    expect(ask).toContain("This cannot be undone");
    expect(await env.DB.prepare("SELECT 1 FROM folders WHERE id = ?").bind(top).first()).toBeTruthy();

    // Investors can do neither.
    const invCookie = await signIn(inv.email);
    expect((await req(`/admin/folders/${top}/delete`, { cookie: invCookie, form: { confirm: "delete" } })).status).toBe(404);

    const res = await req(`/admin/folders/${top}/delete`, { cookie: admin, form: { confirm: "delete" } });
    expect(res.headers.get("location")).toContain("m=folder_deleted");
    const left = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM folders WHERE id IN (?1, ?2)) + (SELECT COUNT(*) FROM files WHERE id IN (?3, ?4))
            + (SELECT COUNT(*) FROM grants WHERE folder_id = ?1) AS n`,
    )
      .bind(top, sub, inTop, inSub)
      .first<{ n: number }>();
    expect(left!.n).toBe(0);
    expect(await env.FILES.get(`files/${inTop}`)).toBeNull();
    expect(await env.FILES.get(`files/${inSub}`)).toBeNull();
    expect((await req(`/d/${inTop}`, { cookie: invCookie })).status).toBe(404);
  });

  it("adds a template's folders, subfolders and valid hidden placeholders", async () => {
    const admin = await adminSession();
    const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;
    const [folders, placeholders] = [await count("SELECT COUNT(*) AS n FROM folders"), await count("SELECT COUNT(*) AS n FROM files WHERE placeholder = 1")];
    expect((await req("/admin/templates", { cookie: admin })).status).toBe(200);
    const res = await req("/admin/templates", { cookie: admin, form: { template: "board" } });
    expect(res.headers.get("location")).toContain("m=template_added");
    // Board portal: 5 sections with 10 items between them.
    expect(await count("SELECT COUNT(*) AS n FROM folders")).toBe(folders + 15);
    expect(await count("SELECT COUNT(*) AS n FROM files WHERE placeholder = 1")).toBe(placeholders + 10);
    expect(await count("SELECT COUNT(*) AS n FROM files WHERE placeholder = 1 AND published = 1")).toBe(0);
    const top = await env.DB.prepare("SELECT id FROM folders WHERE name = '1. Board meetings' AND parent_id IS NULL ORDER BY created_at DESC").first<{ id: string }>();
    expect(top).toBeTruthy();
    const sub = await env.DB.prepare("SELECT id FROM folders WHERE parent_id = ? AND name = 'Next meeting pack'").bind(top!.id).first<{ id: string }>();
    const ph = await env.DB.prepare("SELECT r2_key FROM files WHERE folder_id = ?").bind(sub!.id).first<{ r2_key: string }>();
    const pdf = await PDFDocument.load(await (await env.FILES.get(ph!.r2_key))!.arrayBuffer());
    expect(pdf.getPageCount()).toBe(1);

    // An investor given the new folder sees nothing yet: every page is a placeholder.
    const inv = await addInvestor({ folders: [top!.id] });
    const room = await (await req("/room", { cookie: await signIn(inv.email) })).text();
    expect(room).not.toContain("Next meeting pack");
    expect(room).toContain("No documents here yet");

    // Admins only: an investor is sent away and nothing is added.
    const total = await count("SELECT COUNT(*) AS n FROM folders");
    const denied = await req("/admin/templates", { cookie: await signIn(inv.email), form: { template: "board" } });
    expect(denied.headers.get("location")).toBe("/");
    expect(await count("SELECT COUNT(*) AS n FROM folders")).toBe(total);
  });

  it("lays the investor template out like the due diligence checklist, with short links that survive the upload", async () => {
    const admin = await adminSession();
    await req("/admin/templates", { cookie: admin, form: { template: "investor" } });
    const tops = await env.DB.prepare("SELECT name FROM folders WHERE parent_id IS NULL AND slug IS NOT NULL ORDER BY position").all<{ name: string }>();
    expect(tops.results.map((r) => r.name.replace(/^\d+\.\s*/, ""))).toEqual(
      expect.arrayContaining(["Corporate", "Capitalization", "Financials", "Team", "Business plan", "Financing", "IP"]),
    );
    const cap = await env.DB.prepare("SELECT id FROM files WHERE slug = 'cap-table'").first<{ id: string }>();
    expect(cap).toBeTruthy();
    const section = await env.DB.prepare("SELECT id FROM folders WHERE slug = 'capitalization'").first<{ id: string }>();
    expect(section).toBeTruthy();
    expect(await (await req("/admin", { cookie: admin })).text()).toContain("Its link will be /cap-table.");

    // A second copy adds folders but never fights over a link: each name still points at one thing.
    await req("/admin/templates", { cookie: admin, form: { template: "investor" } });
    const capLinks = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE slug = 'cap-table'").first<{ n: number }>();
    expect(capLinks!.n).toBe(1);

    // Uploading over the placeholder keeps the link, and the link opens it for an investor with the folder.
    const fd = new FormData();
    fd.append("file", new File([await makePdf("our cap table")], "Cap table.pdf"));
    await req(`/admin/files/${cap!.id}/replace`, { cookie: admin, form: fd });
    const row = await env.DB.prepare("SELECT slug, placeholder FROM files WHERE id = ?").bind(cap!.id).first();
    expect(row).toEqual({ slug: "cap-table", placeholder: 0 });
    const inv = await addInvestor({ folders: [section!.id] });
    const opened = await req("/cap-table", { cookie: await signIn(inv.email) });
    expect(opened.status).toBe(200);
    expect((await req("/cap-table")).status).not.toBe(200);
  });
});

describe("short links", () => {
  async function setLink(cookie: string, kind: "file" | "folder", id: string, slug: string) {
    return kind === "file"
      ? req(`/admin/files/${id}`, { cookie, form: { action: "slug", slug } })
      : req(`/admin/folders/${id}/link`, { cookie, form: { slug } });
  }

  it("opens a file at /name and a folder at /name, only for investors with access", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    const file = await addFile(folder, { name: "Deck.pdf" });
    const other = await addFolder();
    const deck = uid("deck").toLowerCase().replace(/_/g, "-");
    const legal = uid("legal").toLowerCase().replace(/_/g, "-");
    const elsewhere = uid("elsewhere").toLowerCase().replace(/_/g, "-");
    expect((await setLink(admin, "file", file, deck)).headers.get("location")).toContain("m=slug_saved");
    expect((await setLink(admin, "folder", folder, legal)).headers.get("location")).toContain("m=slug_saved");
    expect((await setLink(admin, "folder", other, elsewhere)).headers.get("location")).toContain("m=slug_saved");

    const inv = await addInvestor({ folders: [folder] });
    const cookie = await signIn(inv.email);
    const page = await req(`/${deck}`, { cookie });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Deck.pdf");
    expect((await req(`/d/${deck}`, { cookie })).status).toBe(200); // old style still works
    expect((await req(`/${legal}`, { cookie })).headers.get("location")).toBe(`/room#${folder}`);

    // No access and no such link look exactly the same.
    const denied = await req(`/${elsewhere}`, { cookie });
    const unknown = await req("/no-such-link-here", { cookie });
    expect(denied.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await denied.text()).toBe(await unknown.text());

    // Admins land on their own view of it.
    expect((await req(`/${deck}`, { cookie: admin })).headers.get("location")).toBe(`/admin/preview/f/${file}`);
  });

  it("brings people back to the link after signing in, and nowhere else", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    const file = await addFile(folder);
    const slug = uid("cap").toLowerCase().replace(/_/g, "-");
    await setLink(admin, "file", file, slug);
    const inv = await addInvestor({ folders: [folder] });

    const out = await req(`/${slug}`);
    expect(out.headers.get("location")).toBe(`/?next=%2F${slug}`);
    expect(await (await req(`/?next=%2F${slug}`)).text()).toContain(`name="next" value="/${slug}"`);
    await req("/login", { form: { email: inv.email, next: `/${slug}` } });
    const link = (await lastLinkFor(inv.email))!;
    expect(link).toContain(`next=%2F${slug}`);
    const t = new URL(link).searchParams.get("t")!;
    const res = await req("/auth", { form: { t, next: `/${slug}` } });
    expect(res.headers.get("location")).toBe(`/${slug}`);

    // A crafted destination is ignored.
    for (const bad of ["//evil.example", "https://evil.example", "/admin", "/d/../admin", "/\\evil.example"]) {
      const page = await (await req(`/?next=${encodeURIComponent(bad)}`)).text();
      expect(page).not.toContain('name="next"');
    }
  });

  it("refuses room words and names already taken by a file or folder", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    const a = await addFile(folder);
    const b = await addFile(folder);
    for (const word of ["admin", "room", "setup", "login", "static", "settings"]) {
      expect((await setLink(admin, "file", a, word)).headers.get("location")).toContain("m=slug_reserved");
    }
    expect((await setLink(admin, "file", a, "d")).headers.get("location")).toContain("m=slug_invalid");
    const name = uid("shared").toLowerCase().replace(/_/g, "-");
    await setLink(admin, "folder", folder, name);
    expect((await setLink(admin, "file", b, name)).headers.get("location")).toContain("m=slug_taken");
    // The room's own pages always win over links.
    expect((await req("/admin", { cookie: admin })).status).toBe(200);
  });
});

describe("update notice", () => {
  const keep = (latest: string) =>
    env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('update_check', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2",
    )
      .bind(JSON.stringify({ latest, url: `https://github.com/plato15/openroom/releases/tag/v${latest}`, checkedAt: Date.now() }), Date.now())
      .run();

  it("tells admins about a newer release, and nobody else", async () => {
    const admin = await adminSession();
    await keep("9.9.9");
    const docs = await (await req("/admin", { cookie: admin })).text();
    expect(docs).toContain("Openroom 9.9.9 is available");
    expect(docs).toContain("https://github.com/plato15/openroom#updating");
    expect(await (await req("/admin/branding", { cookie: admin })).text()).toContain("Openroom 9.9.9 is available");
    const inv = await addInvestor({ folders: [await addFolder()] });
    expect(await (await req("/room", { cookie: await signIn(inv.email) })).text()).not.toContain("is available");

    // Same version: no notice; the Settings page says which version this is.
    const { VERSION } = await import("../src/version");
    await keep(VERSION);
    expect(await (await req("/admin", { cookie: admin })).text()).not.toContain("is available");
    expect(await (await req("/admin/branding", { cookie: admin })).text()).toContain(`Openroom ${VERSION}`);
    await env.DB.prepare("DELETE FROM settings WHERE key = 'update_check'").run();
  });
});

describe("request access", () => {
  const ask = (form: Record<string, string>) => req("/request", { form });
  const pendingFor = (email: string) =>
    env.DB.prepare("SELECT * FROM access_requests WHERE email = ? AND status = 'pending'").bind(email).first<{ id: string; note: string }>();

  it("thanks everyone the same way, and tells the admins about real requests", async () => {
    expect(await (await req("/")).text()).toContain('href="/request"');
    expect((await req("/request")).status).toBe(200);
    const email = `${uid("asker")}@fund.test`.toLowerCase();
    const thanks = await (await ask({ name: "Grace Hopper", email, firm: "Navy Ventures", note: "Met at <b>demo day</b>" })).text();
    expect(thanks).toContain("Thank you");
    const row = await pendingFor(email);
    expect(row?.note).toBe("Met at <b>demo day</b>");
    const mails = (await (await req("/__test/outbox")).json()) as { to: string; subject: string; html: string }[];
    const toAdmin = mails.filter((m) => m.to === ADMIN && m.subject === "Access request from Grace Hopper").pop();
    expect(toAdmin?.html).toContain("Navy Ventures");
    expect(toAdmin?.html).not.toContain("<b>demo day</b>"); // escaped

    // Someone already invited, a spam bot, and a person over the daily limit: same page, nothing stored.
    const inv = await addInvestor();
    expect(await (await ask({ name: "Ada", email: inv.email })).text()).toBe(thanks);
    expect(await pendingFor(inv.email)).toBeNull();
    const bot = `${uid("bot")}@spam.test`.toLowerCase();
    expect(await (await ask({ name: "Bot", email: bot, website: "http://spam.example" })).text()).toBe(thanks);
    expect(await pendingFor(bot)).toBeNull();
    expect((await ask({ name: "", email: "nope" })).status).toBe(400);
  });

  it("keeps one open request per person and limits repeats", async () => {
    const email = `${uid("again")}@fund.test`.toLowerCase();
    for (let i = 0; i < 5; i++) await ask({ name: "Again", email, note: `try ${i}` });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE email = ?").bind(email).first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it("approves with chosen folders and an invite, or declines quietly; admins only", async () => {
    const admin = await adminSession();
    const folder = await addFolder();
    const other = await addFolder();
    const email = `${uid("approve")}@fund.test`.toLowerCase();
    await ask({ name: "Approve Me", email, firm: "Fund" });
    const r = (await pendingFor(email))!;
    expect(await (await req("/admin/investors", { cookie: admin })).text()).toContain("Approve Me");

    // Not for investors.
    const someone = await addInvestor({ folders: [other] });
    expect((await req(`/admin/requests/${r.id}/approve`, { cookie: await signIn(someone.email), form: { folders: [folder] } })).status).toBe(404);

    const res = await req(`/admin/requests/${r.id}/approve`, { cookie: admin, form: { folders: [folder], invite: "on" } });
    expect(res.headers.get("location")).toContain("m=request_approved");
    const inv = await env.DB.prepare("SELECT id, name, firm FROM investors WHERE email = ?").bind(email).first<{ id: string; name: string; firm: string }>();
    expect(inv).toMatchObject({ name: "Approve Me", firm: "Fund" });
    const grants = await env.DB.prepare("SELECT folder_id FROM grants WHERE investor_id = ?").bind(inv!.id).all<{ folder_id: string }>();
    expect(grants.results.map((g) => g.folder_id)).toEqual([folder]);
    expect(await pendingFor(email)).toBeNull();
    const mails = (await (await req("/__test/outbox")).json()) as { to: string; subject: string }[];
    expect(mails.some((m) => m.to === email && /shared its data room/.test(m.subject))).toBe(true);
    expect(await (await req("/room", { cookie: await signIn(email) })).text()).toContain(`Folder ${folder}`);

    // Approving someone already invited adds folders and keeps theirs.
    const existing = await addInvestor({ folders: [other] });
    await env.DB.prepare("INSERT INTO access_requests (id, email, name, created_at) VALUES (?, ?, 'Existing', ?)").bind(uid("req"), existing.email, Date.now()).run();
    const r2 = (await pendingFor(existing.email))!;
    await req(`/admin/requests/${r2.id}/approve`, { cookie: admin, form: { folders: [folder] } });
    const kept = await env.DB.prepare("SELECT COUNT(*) AS n FROM grants WHERE investor_id = ?").bind(existing.id).first<{ n: number }>();
    expect(kept!.n).toBe(2);

    // Decline: no investor, no email.
    const no = `${uid("decline")}@fund.test`.toLowerCase();
    await ask({ name: "Decline Me", email: no });
    const r3 = (await pendingFor(no))!;
    expect((await req(`/admin/requests/${r3.id}/decline`, { cookie: admin, form: {} })).headers.get("location")).toContain("m=request_declined");
    expect(await env.DB.prepare("SELECT 1 FROM investors WHERE email = ?").bind(no).first()).toBeNull();
    const after = (await (await req("/__test/outbox")).json()) as { to: string }[];
    expect(after.filter((m) => m.to === no)).toHaveLength(0);
  });
});
