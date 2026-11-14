import { unzipSync } from "fflate";
import * as XLSX from "xlsx";

/**
 * Reads an .xlsx file the way Excel shows it: column widths, merged cells, fonts, fills, borders,
 * alignment and number formats. It returns a small HTML table, or null when the file cannot be
 * read this way (old .xls, broken zip, anything unexpected), so the caller can fall back to the
 * plain table.
 *
 * Safety: every piece of text is escaped, and style values only ever come from numbers and
 * validated hex colours, so a hostile file cannot inject markup or CSS.
 */

const MAX_ROWS = 3000;
const MAX_COLS = 60;
const MAX_UNZIPPED = 40 * 1024 * 1024; // refuse zip bombs
const PX_PER_CHAR = 7;
const BASE_PX = 14; // the table text size on a wide screen; narrower screens scale everything down

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ---------- a tiny XML reader (Workers have no DOMParser) ----------

interface Node {
  tag: string;
  attrs: Record<string, string>;
  kids: Node[];
  text: string;
}

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_m, e: string) => {
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "amp") return "&";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
}

function parseXml(xml: string): Node {
  const root: Node = { tag: "#root", attrs: {}, kids: [], text: "" };
  const stack: Node[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[3]) {
      if (m[2]) {
        if (stack.length > 1) stack.pop();
      } else {
        const attrs: Record<string, string> = {};
        const are = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let a: RegExpExecArray | null;
        while ((a = are.exec(m[4]))) attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? "");
        const node: Node = { tag: m[3].replace(/^.*:/, ""), attrs, kids: [], text: "" };
        top.kids.push(node);
        if (!m[5]) stack.push(node);
      }
    } else if (m[6] !== undefined) top.text += unescapeXml(m[6]);
  }
  return root;
}

const kid = (n: Node | undefined, tag: string) => n?.kids.find((k) => k.tag === tag);
const kids = (n: Node | undefined, tag: string) => n?.kids.filter((k) => k.tag === tag) ?? [];
const deepText = (n: Node): string => n.text + n.kids.map(deepText).join("");

// ---------- colours ----------

const THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];
const INDEXED = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF"];

function tint(hex: string, t: number): string {
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t));
  return out.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function colour(n: Node | undefined, theme: string[]): string | null {
  if (!n) return null;
  const a = n.attrs;
  let hex: string | null = null;
  if (a.rgb && /^[0-9A-Fa-f]{8}$/.test(a.rgb)) hex = a.rgb.slice(2).toUpperCase();
  else if (a.rgb && /^[0-9A-Fa-f]{6}$/.test(a.rgb)) hex = a.rgb.toUpperCase();
  else if (a.theme !== undefined && /^\d+$/.test(a.theme)) hex = theme[Number(a.theme)] ?? null;
  else if (a.indexed !== undefined && /^\d+$/.test(a.indexed)) hex = INDEXED[Number(a.indexed)] ?? null;
  if (!hex) return null;
  const t = Number(a.tint);
  if (Number.isFinite(t) && t !== 0) hex = tint(hex, t);
  return "#" + hex;
}

// ---------- styles ----------

interface Style {
  css: string;
  h: string; // horizontal alignment
  wrap: boolean;
  size: number;
  fmt: string | number | null;
  fill: boolean;
}

function readStyles(stylesXml: string, theme: string[]): Style[] {
  const root = kid(parseXml(stylesXml), "styleSheet");
  const custom: Record<string, string> = {};
  for (const f of kids(kid(root, "numFmts"), "numFmt")) custom[f.attrs.numFmtId] = f.attrs.formatCode;

  const fonts = kids(kid(root, "fonts"), "font").map((f) => {
    const css: string[] = [];
    if (kid(f, "b")) css.push("font-weight:700");
    if (kid(f, "i")) css.push("font-style:italic");
    if (kid(f, "u")) css.push("text-decoration:underline");
    const sz = Number(kid(f, "sz")?.attrs.val);
    if (Number.isFinite(sz) && sz > 0 && sz < 100) css.push(`font-size:${(sz / 11).toFixed(3)}em`);
    const c = colour(kid(f, "color"), theme);
    if (c) css.push(`color:${c}`);
    return { css: css.join(";"), size: Number.isFinite(sz) && sz > 0 ? sz : 11 };
  });

  const fills = kids(kid(root, "fills"), "fill").map((f) => {
    const p = kid(f, "patternFill");
    if (p?.attrs.patternType !== "solid") return null;
    return colour(kid(p, "fgColor"), theme);
  });

  const side = (b: Node | undefined, name: string, cssName: string) => {
    const s = kid(b, name);
    if (!s?.attrs.style) return "";
    const heavy = /medium|thick|double/.test(s.attrs.style);
    return `border-${cssName}:${heavy ? 2 : 1}px solid ${colour(kid(s, "color"), theme) ?? "#666666"};`;
  };
  const borders = kids(kid(root, "borders"), "border").map(
    (b) => side(b, "left", "left") + side(b, "right", "right") + side(b, "top", "top") + side(b, "bottom", "bottom"),
  );

  return kids(kid(root, "cellXfs"), "xf").map((xf) => {
    const font = fonts[Number(xf.attrs.fontId)] ?? { css: "", size: 11 };
    const fill = fills[Number(xf.attrs.fillId)] ?? null;
    const al = kid(xf, "alignment");
    const h = al?.attrs.horizontal ?? "general";
    const v = al?.attrs.vertical;
    const wrap = al?.attrs.wrapText === "1" || al?.attrs.wrapText === "true";
    const indent = Number(al?.attrs.indent);
    const css: string[] = [];
    if (font.css) css.push(font.css);
    if (fill) css.push(`background:${fill}`);
    const b = borders[Number(xf.attrs.borderId)];
    if (b) css.push(b);
    if (h === "center" || h === "centerContinuous") css.push("text-align:center");
    else if (h === "right") css.push("text-align:right");
    else if (h === "left") css.push("text-align:left");
    if (v === "center") css.push("vertical-align:middle");
    else if (v === "top") css.push("vertical-align:top");
    else css.push("vertical-align:bottom");
    if (Number.isFinite(indent) && indent > 0 && indent < 20) css.push(`padding-left:${(0.45 + indent * 0.65).toFixed(2)}em`);
    const id = xf.attrs.numFmtId;
    const fmt = id === undefined || id === "0" ? null : custom[id] ?? Number(id);
    return { css: css.join(";"), h, wrap, size: font.size, fmt, fill: !!fill };
  });
}

// ---------- cell addresses ----------

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref);
  return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null;
}

// ---------- the sheet ----------

interface Cell {
  text: string;
  num: boolean;
  s: number;
}

function cellText(c: Node, shared: string[], styles: Style[]): { text: string; num: boolean } {
  const t = c.attrs.t;
  const v = kid(c, "v")?.text ?? "";
  if (t === "s") return { text: shared[Number(v)] ?? "", num: false };
  if (t === "inlineStr") return { text: deepText(kid(c, "is") ?? c), num: false };
  if (t === "str" || t === "e") return { text: v, num: false };
  if (t === "b") return { text: v === "1" ? "TRUE" : "FALSE", num: false };
  if (v === "") return { text: "", num: false };
  const n = Number(v);
  if (!Number.isFinite(n)) return { text: v, num: false };
  const fmt = styles[Number(c.attrs.s)]?.fmt;
  if (fmt !== null && fmt !== undefined) {
    try {
      return { text: XLSX.SSF.format(fmt as string, n), num: true };
    } catch {
      /* fall through to the raw number */
    }
  }
  return { text: String(n), num: true };
}

function renderOne(sheetXml: string, shared: string[], styles: Style[]): string {
  const ws = kid(parseXml(sheetXml), "worksheet");
  const gridlines = kid(kid(ws, "sheetViews"), "sheetView")?.attrs.showGridLines !== "0";

  const widths: number[] = [];
  for (const col of kids(kid(ws, "cols"), "col")) {
    const min = Number(col.attrs.min) - 1;
    const max = Math.min(Number(col.attrs.max) - 1, MAX_COLS - 1);
    const w = col.attrs.hidden === "1" ? 0 : Number(col.attrs.width) * PX_PER_CHAR;
    if (!Number.isFinite(min) || !Number.isFinite(w)) continue;
    for (let i = min; i <= max; i++) widths[i] = Math.max(0, Math.round(w));
  }

  const cells = new Map<string, Cell>();
  const heights: Record<number, number> = {};
  const hiddenRows = new Set<number>();
  let maxR = -1;
  let maxC = -1;
  for (const row of kids(kid(ws, "sheetData"), "row")) {
    const rIdx = Number(row.attrs.r) - 1;
    if (!Number.isFinite(rIdx) || rIdx >= MAX_ROWS) continue;
    if (row.attrs.hidden === "1") hiddenRows.add(rIdx);
    const ht = Number(row.attrs.ht);
    if (Number.isFinite(ht) && ht > 0 && ht < 500) heights[rIdx] = Math.round(((ht * 4) / 3 / BASE_PX) * 1000) / 1000;
    let next = 0;
    for (const c of kids(row, "c")) {
      const ref = c.attrs.r ? parseRef(c.attrs.r) : { r: rIdx, c: next };
      if (!ref || ref.c >= MAX_COLS) continue;
      next = ref.c + 1;
      const { text, num } = cellText(c, shared, styles);
      const s = Number(c.attrs.s) || 0;
      const st = styles[s];
      if (text === "" && !st?.fill && !/border/.test(st?.css ?? "")) continue;
      cells.set(`${ref.r},${ref.c}`, { text, num, s });
      maxR = Math.max(maxR, ref.r);
      maxC = Math.max(maxC, ref.c);
    }
  }
  if (maxR < 0) return `<p class="empty">This sheet is empty.</p>`;

  // merged ranges: the top-left cell takes the span, the others are skipped
  const span = new Map<string, { cs: number; rs: number }>();
  const covered = new Set<string>();
  for (const m of kids(kid(ws, "mergeCells"), "mergeCell")) {
    const [a, b] = (m.attrs.ref ?? "").split(":");
    const from = a && parseRef(a);
    const to = b && parseRef(b);
    if (!from || !to) continue;
    const lastC = Math.min(to.c, MAX_COLS - 1);
    span.set(`${from.r},${from.c}`, { cs: lastC - from.c + 1, rs: to.r - from.r + 1 });
    maxC = Math.max(maxC, lastC);
    maxR = Math.max(maxR, Math.min(to.r, MAX_ROWS - 1));
    for (let r = from.r; r <= to.r; r++) for (let c = from.c; c <= lastC; c++) if (r !== from.r || c !== from.c) covered.add(`${r},${c}`);
  }

  const widthAt = (c: number) => widths[c] ?? 64; // Excel's default is about 8.43 characters

  let body = "";
  for (let r = 0; r <= maxR; r++) {
    if (hiddenRows.has(r)) continue;
    let tds = "";
    for (let c = 0; c <= maxC; c++) {
      const key = `${r},${c}`;
      if (covered.has(key) || widthAt(c) === 0) continue;
      const cell = cells.get(key);
      const st = cell ? styles[cell.s] : undefined;
      let sp = span.get(key);
      let wrapSpill = false;
      // Excel lets plain text spill over empty cells on its right; do the same with a column span
      if (cell && st && !sp && !st.wrap && !cell.num && (st.h === "general" || st.h === "left")) {
        const need = cell.text.length * PX_PER_CHAR * (st.size / 11) + 16;
        let have = widthAt(c);
        let n = 1;
        while (have < need && c + n <= maxC && !cells.get(`${r},${c + n}`)?.text && !covered.has(`${r},${c + n}`)) {
          have += widthAt(c + n);
          n++;
        }
        if (have < need && c + n > maxC) wrapSpill = true; // runs out of columns: wrap inside the table instead of widening it
        if (n > 1) {
          sp = { cs: n, rs: 1 };
          for (let k = 1; k < n && c + k <= maxC; k++) covered.add(`${r},${c + k}`);
        }
      }
      const attrs = (sp && sp.cs > 1 ? ` colspan="${sp.cs}"` : "") + (sp && sp.rs > 1 ? ` rowspan="${sp.rs}"` : "");
      const style = [st?.css ?? "", cell?.num && st?.h === "general" ? "text-align:right" : ""].filter(Boolean).join(";");
      const cls = st?.wrap || wrapSpill ? ' class="w"' : "";
      tds += `<td${attrs}${cls}${style ? ` style="${style}"` : ""}>${cell ? esc(cell.text) : ""}</td>`;
    }
    const h = heights[r];
    body += `<tr${h ? ` style="height:${h}em"` : ""}>${tds}</tr>`;
  }
  const colCount = maxC + 1;
  const px = (c: number) => widthAt(c);
  const total = Array.from({ length: colCount }, (_, c) => px(c)).reduce((a, b) => a + b, 0) || 1;
  const cols = Array.from({ length: colCount }, (_, c) => `<col style="width:${((px(c) / total) * 100).toFixed(2)}%">`).join("");
  // Wide screens: the table fills the width at normal size. Narrow screens (phones): the same table,
  // scaled down to fit, so nothing scrolls sideways. No scripts: the size follows the screen width.
  const fit = `font-size:min(${BASE_PX}px,calc((100vw - 24px) * ${(BASE_PX / total).toFixed(5)}))`;
  return `<div class="scroll fit"><table class="xs${gridlines ? " grid" : ""}" style="width:100%;${fit}"><colgroup>${cols}</colgroup><tbody>${body}</tbody></table></div>`;
}

/** Each visible sheet as styled HTML, or null if this is not a file we can read this way. */
export function renderStyledSheets(bytes: ArrayBuffer): { name: string; html: string }[] | null {
  try {
    const wanted = /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|sharedStrings\.xml|theme\/theme1\.xml|worksheets\/[^/]+\.xml)$/;
    let size = 0;
    const files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => {
        size += f.originalSize;
        if (size > MAX_UNZIPPED) throw new Error("too large");
        return wanted.test(f.name);
      },
    });
    const text = (name: string) => (files[name] ? new TextDecoder().decode(files[name]) : null);

    const wbXml = text("xl/workbook.xml");
    const relsXml = text("xl/_rels/workbook.xml.rels");
    const stylesXml = text("xl/styles.xml");
    if (!wbXml || !relsXml || !stylesXml) return null;

    const targets: Record<string, string> = {};
    for (const rel of kids(kid(parseXml(relsXml), "Relationships"), "Relationship")) {
      targets[rel.attrs.Id] = rel.attrs.Target.replace(/^\/?(xl\/)?/, "xl/");
    }

    // theme colours, with the Office defaults when the file has none
    const theme = [...THEME];
    const themeXml = text("xl/theme/theme1.xml");
    if (themeXml) {
      const names = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
      names.forEach((n, i) => {
        const m = new RegExp(`<a:${n}>[\\s\\S]*?(?:val|lastClr)="([0-9A-Fa-f]{6})"[\\s\\S]*?</a:${n}>`).exec(themeXml);
        if (m) theme[i] = m[1].toUpperCase();
      });
    }

    const styles = readStyles(stylesXml, theme);
    const shared: string[] = [];
    const ssXml = text("xl/sharedStrings.xml");
    if (ssXml) for (const si of kids(kid(parseXml(ssXml), "sst"), "si")) shared.push(deepText(si));

    const out: { name: string; html: string }[] = [];
    for (const s of kids(kid(kid(parseXml(wbXml), "workbook"), "sheets"), "sheet")) {
      if (s.attrs.state === "hidden" || s.attrs.state === "veryHidden") continue;
      const xml = text(targets[s.attrs.id ?? s.attrs["r:id"] ?? ""] ?? "");
      if (!xml) return null;
      out.push({ name: s.attrs.name ?? "Sheet", html: renderOne(xml, shared, styles) });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}
