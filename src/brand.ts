import type { Env } from "./env";

/**
 * Everything that makes a room look like one company's. Admins set it on the Branding tab
 * (stored in the `settings` table, logos in the file store). Anything left blank falls back to
 * the BRAND_* variables in wrangler.jsonc, then to Openroom's own defaults. Nothing else in the
 * code names a company.
 */
export type Brand = {
  name: string; // "Acme"
  roomName: string; // "Acme data room"
  legalName: string; // "Acme Inc." (footer and emails)
  /** The legal name as a sentence, without doubling a final full stop: "Acme Inc." or "Acme Ltd." */
  legalSentence: string;
  inviter: string; // who invites, in the invite email: "Ada at Acme"
  host: string; // "dataroom.acme.com", printed on stamps
  color: string; // buttons and links
  colorDark: string; // hover state
  dark: string; // header and table heads
  fontBody: string;
  fontDisplay: string;
  credit: boolean; // "Powered by Openroom" in the footer
  /** Header logo, shown on the dark header bar, or null to show the name as text. */
  logo: string | null;
  /** Path of the email logo (PNG or JPEG), or null to print the name instead. */
  emailLogo: string | null;
  icon: string;
  iconType: string;
};

/** What an admin saved on the Branding tab. Every field is optional: missing means "use the default". */
export type BrandSettings = {
  name?: string;
  legalName?: string;
  inviter?: string;
  color?: string;
  dark?: string;
  fontBody?: string;
  fontDisplay?: string;
  logos?: Partial<Record<LogoSlot, { type: string; v: number }>>;
};

export type LogoSlot = "header" | "email" | "icon";
export const LOGO_SLOTS: LogoSlot[] = ["header", "email", "icon"];
export const logoKey = (slot: LogoSlot) => `brand/${slot}`;

export const HEX = /^#[0-9a-f]{6}$/i;
/** Google Fonts family names: letters, numbers and spaces. Nothing that could break out of CSS or a URL. */
export const FONT = /^[A-Za-z0-9 ]{1,40}$/;
/** Names shown in the header, footer and emails: no control characters, no angle brackets. */
export const TEXT = /^[^\x00-\x1f\x7f<>]{1,80}$/;

const DEFAULT_LOGOS: Record<LogoSlot, string> = {
  header: "/static/logo-white.svg",
  email: "/static/logo-email.png",
  icon: "/static/icon.svg",
};

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * (1 - amount))));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

const pick = (re: RegExp, ...values: (string | undefined)[]) => {
  for (const v of values) {
    const t = v?.trim();
    if (t && re.test(t)) return t;
  }
  return undefined;
};

export function brandFrom(env: Env, saved: BrandSettings = {}): Brand {
  const name = pick(TEXT, saved.name, env.BRAND_NAME) ?? "Openroom";
  const color = pick(HEX, saved.color, env.BRAND_COLOR) ?? "#2563EB";
  const fontBody = pick(FONT, saved.fontBody, env.BRAND_FONT_BODY) ?? "Inter";
  let host = "";
  try {
    host = new URL(env.APP_ORIGIN).host;
  } catch {
    host = "";
  }
  const logos = saved.logos ?? {};
  // Openroom's own logos only stand in while the room still carries the Openroom name; a room
  // renamed without a logo shows its name as text rather than someone else's logo.
  const ownName = name !== "Openroom";
  const logoUrl = (slot: LogoSlot) => (logos[slot] ? `/brand/${slot}?v=${logos[slot]!.v}` : DEFAULT_LOGOS[slot]);
  const emailType = logos.email?.type;
  const legalName = pick(TEXT, saved.legalName, env.BRAND_LEGAL_NAME) ?? name;
  return {
    name,
    roomName: `${name} data room`,
    legalName,
    legalSentence: `${legalName.replace(/\.+$/, "")}.`,
    inviter: pick(TEXT, saved.inviter, env.BRAND_INVITER) ?? `The ${name} team`,
    host,
    color,
    colorDark: shade(color, 0.18),
    dark: pick(HEX, saved.dark, env.BRAND_DARK) ?? "#0F172A",
    fontBody,
    fontDisplay: pick(FONT, saved.fontDisplay, env.BRAND_FONT_DISPLAY) ?? fontBody,
    credit: env.SHOW_CREDIT !== "false",
    logo: logos.header || !ownName ? logoUrl("header") : null,
    // Email clients do not show SVG or WebP, so only a PNG or JPEG upload is used in emails.
    emailLogo: !emailType ? (ownName ? null : DEFAULT_LOGOS.email) : emailType === "image/png" || emailType === "image/jpeg" ? logoUrl("email") : null,
    icon: logoUrl("icon"),
    iconType: logos.icon?.type ?? "image/svg+xml",
  };
}

// ---------- Loading and saving ----------

/**
 * Saved settings are cached for a few seconds per Worker instance (or Node process), so every
 * request does not cost a database read. Saving clears this instance's cache at once; other
 * instances pick the change up within CACHE_MS.
 */
const CACHE_MS = 10_000;
let cache: { at: number; value: BrandSettings } | null = null;

export async function readBrandSettings(env: Env): Promise<BrandSettings> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'brand'").first<{ value: string }>();
    const parsed = row ? JSON.parse(row.value) : {};
    return parsed && typeof parsed === "object" ? (parsed as BrandSettings) : {};
  } catch (err) {
    // Before migration 0005 runs there is no settings table; the deploy defaults still work.
    console.error(`brand settings not read: ${(err as Error).message}`);
    return {};
  }
}

export async function saveBrandSettings(env: Env, value: BrandSettings) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('brand', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2",
  )
    .bind(JSON.stringify(value), Date.now())
    .run();
  cache = null;
}

/**
 * The brand is set at the start of each request and read by the page and email templates.
 * It is the same for every request a deployment serves, so one module-level value is safe.
 */
let current: Brand | null = null;
export const setBrand = async (env: Env) => {
  if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), value: await readBrandSettings(env) };
  current = brandFrom(env, cache.value);
};
export const brand = (): Brand => current ?? brandFrom({ APP_ORIGIN: "" } as Env);

export function googleFontsHref(b: Brand): string {
  const fam = (f: string, weights: boolean) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}${weights ? ":wght@400;500;600;700" : ""}`;
  const families = b.fontDisplay === b.fontBody ? [fam(b.fontBody, true)] : [fam(b.fontDisplay, false), fam(b.fontBody, true)];
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

/** A short fingerprint of the theme, put in the stylesheet URL so a Branding change is never served stale. */
export function themeVersion(b: Brand): string {
  let h = 5381;
  for (const ch of themeCss(b)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export function themeCss(b: Brand): string {
  return `:root{--blue:${b.color};--blue-dark:${b.colorDark};--navy:${b.dark};--navy-2:${shade(b.dark, -0.25)};--font:"${b.fontBody}",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--display:"${b.fontDisplay}","${b.fontBody}",-apple-system,sans-serif}`;
}

// ---------- Logo uploads ----------

export const MAX_LOGO = 512 * 1024;

/** Which image types each slot accepts. Emails need PNG or JPEG; the header and icon can also be SVG. */
export const LOGO_TYPES: Record<LogoSlot, string[]> = {
  header: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  email: ["image/png", "image/jpeg"],
  icon: ["image/png", "image/svg+xml"],
};

/** The image type from the file's first bytes, never from its name or the browser's word for it. */
export function sniffImage(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  const head = new TextDecoder().decode(bytes.slice(0, 1024)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}
