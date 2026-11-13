import { Buffer } from "node:buffer";
import mammoth from "mammoth";
import { brand } from "./brand";
import * as XLSX from "xlsx";

/**
 * Spreadsheets, CSV and Word files are turned into a plain HTML page we serve ourselves, so investors
 * can read them in the browser without downloading. The page is rendered once and cached in R2; the
 * viewer's stamp is added per request. It is served with scripts switched off and no outside requests.
 */

const MAX_ROWS = 3000;
const MAX_COLS = 60;

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function renderSheet(bytes: ArrayBuffer, isCsv: boolean): string {
  const book = isCsv
    ? XLSX.read(new TextDecoder().decode(bytes), { type: "string", raw: true, dense: true })
    : XLSX.read(new Uint8Array(bytes), { type: "array", dense: true, cellHTML: false });
  const names = book.SheetNames;
  const tabs =
    names.length > 1
      ? `<nav class="tabs">${names.map((n, i) => `<a href="#s${i}">${esc(n)}</a>`).join("")}</nav>`
      : "";
  const sheets = names
    .map((name, i) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
      const cut = rows.length > MAX_ROWS;
      const shown = rows.slice(0, MAX_ROWS);
      const width = Math.min(MAX_COLS, shown.reduce<number>((w, r) => Math.max(w, (r as unknown[]).length), 0));
      const cells = (r: unknown[], tag: "th" | "td") =>
        Array.from({ length: width }, (_, c) => `<${tag}>${esc(r[c])}</${tag}>`).join("");
      const [head, ...body] = shown;
      const table = head
        ? `<div class="scroll"><table><thead><tr><th class="n"></th>${cells(head as unknown[], "th")}</tr></thead><tbody>${body
            .map((r, n) => `<tr><td class="n">${n + 2}</td>${cells(r as unknown[], "td")}</tr>`)
            .join("")}</tbody></table></div>`
        : `<p class="empty">This sheet is empty.</p>`;
      return `<section id="s${i}">${names.length > 1 || !isCsv ? `<h2>${esc(name)}</h2>` : ""}${table}${
        cut ? `<p class="empty">Showing the first ${MAX_ROWS.toLocaleString("en")} rows of ${rows.length.toLocaleString("en")}.</p>` : ""
      }</section>`;
    })
    .join("");
  return `<div class="sheet">${tabs}${sheets}</div>`;
}

export async function renderDoc(bytes: ArrayBuffer): Promise<string> {
  // The Worker bundle uses mammoth's browser build (reads arrayBuffer); tests run its Node build
  // (reads buffer). Give both so either build finds its input.
  const input = { arrayBuffer: bytes, buffer: Buffer.from(bytes) } as unknown as { buffer: Buffer };
  const result = await mammoth.convertToHtml(input);
  return `<article class="doc">${result.value}</article>`;
}

const STAMP_SLOT = "<!--STAMP-->";

/** The cached page, with a slot where the viewer's stamp goes. */
export function shell(title: string, body: string): string {
  const dark = brand().dark;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#f4f6fa;color:#0f172a;font:14px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.stamp{position:fixed;inset:0;pointer-events:none;z-index:5;background-repeat:repeat;opacity:.13}
.foot{position:fixed;left:0;right:0;bottom:0;z-index:6;background:${dark};color:#c7d3ea;font-size:11px;padding:5px 12px;text-align:center}
.sheet{padding:12px 12px 40px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}.tabs a{background:#fff;border:1px solid #e3e8f0;border-radius:999px;padding:5px 12px;color:${dark};font-weight:600;text-decoration:none;font-size:13px}
h2{font-size:15px;color:${dark};margin:18px 0 8px}section:first-of-type h2{margin-top:0}
.scroll{overflow:auto;max-height:80vh;background:#fff;border:1px solid #e3e8f0;border-radius:10px}
table{border-collapse:collapse;font-size:13px;min-width:100%}
th,td{border-bottom:1px solid #eef1f6;border-right:1px solid #eef1f6;padding:6px 10px;white-space:nowrap;text-align:left;vertical-align:top}
thead th{position:sticky;top:0;background:${dark};color:#fff;font-weight:600;z-index:1}
td.n,th.n{position:sticky;left:0;background:#f7f9fc;color:#94a3b8;font-size:11px;text-align:right;min-width:36px}thead th.n{background:${dark};z-index:2}
tbody tr:nth-child(even) td:not(.n){background:#fafbfd}
.empty{color:#5b6478;font-size:13px}
.doc{max-width:820px;margin:16px auto 48px;background:#fff;border:1px solid #e3e8f0;border-radius:10px;padding:48px 56px;font-size:15px;line-height:1.6}
.doc img{max-width:100%;height:auto}.doc table{border-collapse:collapse;margin:12px 0}.doc td,.doc th{border:1px solid #d6dce6;white-space:normal}
@media (max-width:640px){.doc{margin:0;border-radius:0;border:0;padding:24px 18px}}
</style></head><body>${STAMP_SLOT}${body}</body></html>`;
}

/** Adds "who and when" to the cached page: a faint repeated stamp plus a footer line. */
export function stampPage(page: string, stampFor: string | null, when: Date): string {
  if (!stampFor) return page.replace(STAMP_SLOT, "");
  const date = when.toISOString().slice(0, 10);
  const text = `${stampFor}  ${date}`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='240'><text x='20' y='150' transform='rotate(-24 210 120)' font-family='Helvetica,Arial' font-size='18' fill='%23475569'>${esc(text).replace(/#/g, "%23")}</text></svg>`;
  const stamp = `<div class="stamp" style="background-image:url(&quot;data:image/svg+xml;utf8,${svg.replace(/"/g, "&quot;")}&quot;)"></div><div class="foot">Confidential. Shared with ${esc(stampFor)} on ${date}${brand().host ? ` via ${esc(brand().host)}` : ""}. Do not forward.</div>`;
  return page.replace(STAMP_SLOT, stamp);
}

/**
 * Headers for a rendered page: no scripts at all, no outside requests, no forms, cannot be framed by
 * other sites. (Not CSP "sandbox": that gives the page an isolated origin and browsers then leave it
 * blank inside our viewer frame.)
 */
export const RENDERED_CSP =
  "default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
