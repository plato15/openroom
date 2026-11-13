import type { Env } from "./env";

/**
 * Everything that makes a room look like one company's: set with BRAND_* variables in wrangler.jsonc,
 * plus the logo files in public/static/. Nothing else in the code names a company.
 */
export type Brand = {
  name: string; // "Acme"
  roomName: string; // "Acme data room"
  legalName: string; // "Acme Inc." (footer and emails)
  inviter: string; // who invites, in the invite email: "Ada at Acme"
  host: string; // "dataroom.acme.com", printed on stamps
  color: string; // buttons and links
  colorDark: string; // hover state
  dark: string; // header and table heads
  fontBody: string;
  fontDisplay: string;
  credit: boolean; // "Powered by Openroom" in the footer
};

const HEX = /^#[0-9a-f]{6}$/i;
const FONT = /^[A-Za-z0-9 ]{1,40}$/;

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * (1 - amount))));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

export function brandFrom(env: Env): Brand {
  const name = (env.BRAND_NAME || "Openroom").trim();
  const color = HEX.test(env.BRAND_COLOR ?? "") ? env.BRAND_COLOR! : "#2563EB";
  const fontBody = FONT.test(env.BRAND_FONT_BODY ?? "") ? env.BRAND_FONT_BODY! : "Inter";
  let host = "";
  try {
    host = new URL(env.APP_ORIGIN).host;
  } catch {
    host = "";
  }
  return {
    name,
    roomName: `${name} data room`,
    legalName: (env.BRAND_LEGAL_NAME || name).trim(),
    inviter: (env.BRAND_INVITER || `The ${name} team`).trim(),
    host,
    color,
    colorDark: shade(color, 0.18),
    dark: HEX.test(env.BRAND_DARK ?? "") ? env.BRAND_DARK! : "#0F172A",
    fontBody,
    fontDisplay: FONT.test(env.BRAND_FONT_DISPLAY ?? "") ? env.BRAND_FONT_DISPLAY! : fontBody,
    credit: env.SHOW_CREDIT !== "false",
  };
}

/**
 * The brand comes only from deployment settings, so it is the same for every request a Worker serves.
 * It is set at the start of each request and read by the page and email templates.
 */
let current: Brand | null = null;
export const setBrand = (env: Env) => {
  current = brandFrom(env);
};
export const brand = (): Brand => current ?? brandFrom({ APP_ORIGIN: "" } as Env);

export function googleFontsHref(b: Brand): string {
  const fam = (f: string, weights: boolean) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}${weights ? ":wght@400;500;600;700" : ""}`;
  const families = b.fontDisplay === b.fontBody ? [fam(b.fontBody, true)] : [fam(b.fontDisplay, false), fam(b.fontBody, true)];
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

export function themeCss(b: Brand): string {
  return `:root{--blue:${b.color};--blue-dark:${b.colorDark};--navy:${b.dark};--navy-2:${shade(b.dark, -0.25)};--font:"${b.fontBody}",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--display:"${b.fontDisplay}","${b.fontBody}",-apple-system,sans-serif}`;
}
