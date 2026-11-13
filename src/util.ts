/** 128 bits of randomness, base64url. Used for every id and token so nothing is guessable. */
export function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const now = () => Date.now();

/**
 * Dev shortcuts (sign-in link shown on the page, captured mail) only ever work on a local address,
 * so a deployment that is misconfigured as "local" still cannot hand out sign-in links.
 */
export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost") || host.endsWith(".test");
  } catch {
    return false;
  }
}

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/.test(email)) return null;
  return email;
}

export function adminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => normalizeEmail(e))
      .filter((e): e is string => !!e),
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(ms)}, ${hh}:${mm} UTC`;
}

/** yyyy-mm-dd for <input type=date>. */
export function dateInputValue(ms: number | null): string {
  return ms ? new Date(ms).toISOString().slice(0, 10) : "";
}
/** Access lasts through the whole chosen day (UTC). */
export function parseDateInput(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T23:59:59.999Z`);
  return Number.isFinite(ms) ? ms : null;
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** How a file opens in the browser. null = it can only be downloaded (PowerPoint, old .doc, zip...). */
export type ViewKind = "pdf" | "image" | "sheet" | "doc";
export function viewKind(contentType: string): ViewKind | null {
  if (contentType === "application/pdf") return "pdf";
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(contentType)) return "image";
  if ([XLSX_TYPE, "application/vnd.ms-excel", "text/csv"].includes(contentType)) return "sheet";
  if (contentType === DOCX_TYPE) return "doc";
  return null;
}

/** Everything investors can read in the browser without downloading. */
export const VIEWABLE_TYPES = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif",
  XLSX_TYPE, "application/vnd.ms-excel", "text/csv", DOCX_TYPE,
]);

const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  xlsx: XLSX_TYPE,
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  docx: DOCX_TYPE,
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  txt: "text/plain",
};

/**
 * Content type from the extension, confirmed against the first bytes for the types we show
 * inline. A mismatch becomes a plain download, so nothing pretends to be a PDF or image.
 */
export function detectContentType(name: string, head: Uint8Array): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const type = BY_EXTENSION[ext] ?? "application/octet-stream";
  const starts = (...sig: number[]) => sig.every((b, i) => head[i] === b);
  const ok: Record<string, boolean> = {
    "application/pdf": starts(0x25, 0x50, 0x44, 0x46, 0x2d),
    "image/png": starts(0x89, 0x50, 0x4e, 0x47),
    "image/jpeg": starts(0xff, 0xd8, 0xff),
    "image/gif": starts(0x47, 0x49, 0x46, 0x38),
    "image/webp": starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45,
    // Office files: the new formats are zip files, the old ones OLE containers.
    [XLSX_TYPE]: starts(0x50, 0x4b, 0x03, 0x04),
    [DOCX_TYPE]: starts(0x50, 0x4b, 0x03, 0x04),
    "application/vnd.ms-excel": starts(0xd0, 0xcf, 0x11, 0xe0),
    "text/csv": !head.includes(0),
  };
  if (type in ok && !ok[type]) return "application/octet-stream";
  return type;
}

export function fileKind(contentType: string, name: string): string {
  if (contentType === "application/pdf") return "PDF";
  if (contentType.startsWith("image/")) return "Image";
  if (contentType === "text/csv") return "CSV";
  const ext = name.split(".").pop()?.toUpperCase() ?? "";
  return ext && ext.length <= 5 ? ext : "File";
}

/** Names that look like internal working files are never published. */
export function looksInternal(name: string): boolean {
  return /\b(draft|internal|do not share|not for distribution)\b/i.test(name.replace(/[_-]+/g, " "));
}

/** Custom links: lowercase letters, numbers and single hyphens, 3 to 60 characters. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}
export const isSlug = (s: string) => s.length >= 3 && s.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);

export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
