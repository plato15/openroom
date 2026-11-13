import { Hono } from "hono";
import { html } from "hono/html";
import {
  brand,
  brandFrom,
  FONT,
  HEX,
  LOGO_SLOTS,
  LOGO_TYPES,
  logoKey,
  MAX_LOGO,
  readBrandSettings,
  saveBrandSettings,
  setBrand,
  sniffImage,
  TEXT,
  type BrandSettings,
  type LogoSlot,
} from "../brand";
import type { AppEnv } from "../env";
import { DEFAULT_MAIL_FROM } from "../email";
import { notice, page, updateNotice } from "../layout";
import { availableUpdate, updateCheckOn } from "../updates";
import { VERSION } from "../version";
import { getMailSettings, putSetting } from "../settings";

/** The Branding tab. Mounted inside adminRoutes, so only admins reach it. */
export const brandingRoutes = new Hono<AppEnv>();

const MESSAGES: Record<string, [kind: "ok" | "error", text: string]> = {
  saved: ["ok", "Branding saved. Everyone sees it on their next page."],
  text: ["error", "Names can be up to 80 characters, without < or >."],
  color: ["error", "Colours must look like #2563EB."],
  font: ["error", "Font names use letters, numbers and spaces, like Inter or Playfair Display."],
  logo_saved: ["ok", "Logo uploaded."],
  logo_removed: ["ok", "Logo removed. The default is back."],
  logo_none: ["error", "Choose an image first."],
  logo_big: ["error", "That image is over 512 KB. Export a smaller one."],
  logo_type: ["error", "That file type is not accepted here. See the formats listed under each logo."],
  reset: ["ok", "Branding reset to the defaults."],
  email_saved: ["ok", "Email settings saved."],
  email_key: ["error", "That does not look like a Resend API key. It starts with re_."],
  email_from: ["error", "The sender should look like Data Room <rooms@yourdomain.com>."],
};

const SLOT_INFO: Record<LogoSlot, { title: string; hint: string; formats: string; bg: string }> = {
  header: {
    title: "Header logo",
    hint: "Shown on the header bar, so use a light or white version.",
    formats: "PNG, JPEG, WebP or SVG",
    bg: "dark",
  },
  email: {
    title: "Email logo",
    hint: "Shown at the top of sign-in and invite emails, on white.",
    formats: "PNG or JPEG (email apps do not show SVG)",
    bg: "light",
  },
  icon: {
    title: "Browser tab icon",
    hint: "A square image, at least 64 by 64.",
    formats: "PNG or SVG",
    bg: "light",
  },
};

const FONTS = ["Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Source Sans 3", "Work Sans", "DM Sans", "Manrope", "IBM Plex Sans", "Playfair Display", "Merriweather", "Lora", "Space Grotesk"];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isSlot = (s: string): s is LogoSlot => (LOGO_SLOTS as string[]).includes(s);
const back = (code: string, anchor = "") => `/admin/branding?m=${code}${anchor}`;

brandingRoutes.get("/admin/branding", async (c) => {
  const [saved, mail, update] = await Promise.all([
    readBrandSettings(c.env),
    getMailSettings(c.env),
    availableUpdate(c.env, (p) => c.executionCtx.waitUntil(p)),
  ]);
  const b = brand();
  const defaults = brandFrom({ ...c.env }, {});
  const code = c.req.query("m");
  const m = code ? MESSAGES[code] : undefined;
  return c.html(
    page({
      title: "Settings",
      session: c.get("session"),
      nav: "branding",
      body: html`<h1 class="h2">Settings</h1>
        <p class="muted small">How the room looks to investors, and how it sends email. Changes show straight away, with no redeploy.</p>
        ${m ? notice(m[0], m[1]) : ""}

        <section class="card brand-preview" aria-label="Preview">
          <div class="bp-bar">
            ${b.logo ? html`<img src="${b.logo}" alt="${b.name}" height="22">` : html`<span class="brand-name">${b.name}</span>`}
            <span class="brand-tag">Data room</span>
          </div>
          <div class="bp-body">
            <p class="h3">${b.roomName}</p>
            <p class="muted small">${b.legalSentence} Confidential. Shared for due diligence only.</p>
            <span class="btn small">A button</span> <a href="/admin/branding">A link</a>
          </div>
        </section>

        <form method="post" action="/admin/branding" class="card stack" id="names">
          <h2 class="h3">Names and colours</h2>
          <div class="two">
            <label>Company name
              <input name="name" value="${saved.name ?? ""}" maxlength="80" placeholder="${defaults.name}">
            </label>
            <label><span>Legal name <span class="muted small hint">(footer and emails)</span></span>
              <input name="legalName" value="${saved.legalName ?? ""}" maxlength="80" placeholder="${defaults.legalName}">
            </label>
          </div>
          <label><span>Who sends invites <span class="muted small hint">(for example, Ada at Acme)</span></span>
            <input name="inviter" value="${saved.inviter ?? ""}" maxlength="80" placeholder="${defaults.inviter}">
          </label>
          <div class="two">
            <label><span>Main colour <span class="muted small hint">(buttons and links)</span></span>
              <span class="color-field"><input type="color" name="color" value="${b.color.toLowerCase()}" aria-label="Main colour"><code>${b.color.toUpperCase()}</code></span>
            </label>
            <label>Header colour
              <span class="color-field"><input type="color" name="dark" value="${b.dark.toLowerCase()}" aria-label="Header colour"><code>${b.dark.toUpperCase()}</code></span>
            </label>
          </div>
          <div class="two">
            <label>Body font
              <input name="fontBody" value="${saved.fontBody ?? ""}" maxlength="40" placeholder="${defaults.fontBody}" list="fonts" autocapitalize="words" spellcheck="false">
            </label>
            <label>Heading font
              <input name="fontDisplay" value="${saved.fontDisplay ?? ""}" maxlength="40" placeholder="${defaults.fontDisplay}" list="fonts" autocapitalize="words" spellcheck="false">
            </label>
          </div>
          <datalist id="fonts">${FONTS.map((f) => html`<option value="${f}"></option>`)}</datalist>
          <p class="muted small">Any font from <a href="https://fonts.google.com" rel="noopener" target="_blank">Google Fonts</a>, typed exactly as it is named there. Leave a box empty to use the default shown in grey.</p>
          <div><button class="btn" type="submit">Save</button></div>
        </form>

        <section class="card stack" id="logos">
          <h2 class="h3">Logos</h2>
          <div class="logo-grid">
            ${LOGO_SLOTS.map((slot) => {
              const info = SLOT_INFO[slot];
              const custom = !!saved.logos?.[slot];
              const src = (slot === "header" ? b.logo : slot === "icon" ? b.icon : b.emailLogo) ?? "";
              return html`<div class="logo-slot">
                <p class="small"><strong>${info.title}</strong> ${custom ? html`<span class="badge blue">Custom</span>` : html`<span class="badge grey">Default</span>`}</p>
                <div class="logo-view ${info.bg}">${src ? html`<img src="${src}" alt="${info.title}" class="${slot === "icon" ? "icon" : ""}">` : html`<span class="muted small">Name shown as text</span>`}</div>
                <p class="muted small">${info.hint} ${info.formats}, up to 512 KB.</p>
                <form method="post" action="/admin/branding/logo/${slot}" enctype="multipart/form-data" class="stack tight">
                  <input type="file" name="file" accept="${LOGO_TYPES[slot].join(",")}" required aria-label="${info.title} file">
                  <button class="btn small" type="submit">Upload</button>
                </form>
                ${custom
                  ? html`<form method="post" action="/admin/branding/logo/${slot}/remove"><button class="link-btn small" type="submit">Use the default</button></form>`
                  : ""}
              </div>`;
            })}
          </div>
        </section>

        ${emailCard(c.env, mail)}

        <section class="card stack" id="version">
          <h2 class="h3">Version</h2>
          ${update
            ? updateNotice(update, VERSION)
            : html`<p class="small">Openroom ${VERSION}${updateCheckOn(c.env) ? html` <span class="badge green">Up to date</span>` : html` <span class="muted">(the update check is off)</span>`}</p>`}
          <p class="small muted">To update, see <a href="https://github.com/plato15/openroom#updating" target="_blank" rel="noopener">How to update</a>. Updates keep your documents, investors and settings.</p>
        </section>

        <form method="post" action="/admin/branding/reset" class="card row-between" data-confirm="Reset all branding to the defaults?">
          <span class="small muted">Go back to the deployment defaults: names, colours, fonts and logos.</span>
          <button class="btn small ghost danger-text" type="submit">Reset all</button>
        </form>`,
    }),
  );
});

brandingRoutes.post("/admin/branding", async (c) => {
  const form = await c.req.parseBody();
  const saved = await readBrandSettings(c.env);
  const next: BrandSettings = { logos: saved.logos };
  for (const key of ["name", "legalName", "inviter"] as const) {
    const v = str(form[key]);
    if (!v) continue;
    if (!TEXT.test(v)) return c.redirect(back("text", "#names"), 303);
    next[key] = v;
  }
  for (const key of ["color", "dark"] as const) {
    const v = str(form[key]);
    if (!v) continue;
    if (!HEX.test(v)) return c.redirect(back("color", "#names"), 303);
    next[key] = v.toUpperCase();
  }
  for (const key of ["fontBody", "fontDisplay"] as const) {
    const v = str(form[key]).replace(/\s+/g, " ");
    if (!v) continue;
    if (!FONT.test(v)) return c.redirect(back("font", "#names"), 303);
    next[key] = v;
  }
  // Keep only colours that differ from the deployment default, so a later change to the
  // BRAND_* variables still shows for anything the admin never touched.
  const defaults = brandFrom(c.env, {});
  if (next.color?.toUpperCase() === defaults.color.toUpperCase() && !saved.color) delete next.color;
  if (next.dark?.toUpperCase() === defaults.dark.toUpperCase() && !saved.dark) delete next.dark;
  await saveBrandSettings(c.env, next);
  await setBrand(c.env);
  return c.redirect(back("saved"), 303);
});

brandingRoutes.post("/admin/branding/logo/:slot", async (c) => {
  const slot = c.req.param("slot");
  if (!isSlot(slot)) return c.notFound();
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File) || file.size === 0) return c.redirect(back("logo_none", "#logos"), 303);
  if (file.size > MAX_LOGO) return c.redirect(back("logo_big", "#logos"), 303);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type || !LOGO_TYPES[slot].includes(type)) return c.redirect(back("logo_type", "#logos"), 303);
  await c.env.FILES.put(logoKey(slot), bytes, { httpMetadata: { contentType: type } });
  const saved = await readBrandSettings(c.env);
  await saveBrandSettings(c.env, { ...saved, logos: { ...saved.logos, [slot]: { type, v: Date.now() } } });
  return c.redirect(back("logo_saved", "#logos"), 303);
});

brandingRoutes.post("/admin/branding/logo/:slot/remove", async (c) => {
  const slot = c.req.param("slot");
  if (!isSlot(slot)) return c.notFound();
  const saved = await readBrandSettings(c.env);
  const logos = { ...saved.logos };
  delete logos[slot];
  await saveBrandSettings(c.env, { ...saved, logos });
  await c.env.FILES.delete(logoKey(slot));
  return c.redirect(back("logo_removed", "#logos"), 303);
});

brandingRoutes.post("/admin/branding/reset", async (c) => {
  await saveBrandSettings(c.env, {});
  await c.env.FILES.delete(LOGO_SLOTS.map(logoKey));
  return c.redirect(back("reset"), 303);
});

// ---------- Email ----------

const RESEND_KEY = /^re_[A-Za-z0-9_]{8,120}$/;
const SENDER = /^([^\x00-\x1f<>"]{1,60} )?<?[^\s<>@"]+@[^\s<>@"]+\.[A-Za-z]{2,}>?$/;

/** Who sign-in emails come from, and the Resend key. The key is never shown again, only whether one is saved. */
function emailCard(env: AppEnv["Bindings"], mail: { resendApiKey?: string; mailFrom?: string } | null) {
  const fromDeploy = !!(env.RESEND_API_KEY || env.MAIL_FROM || env.SMTP_URL || env.AWS_ACCESS_KEY_ID);
  return html`<form method="post" action="/admin/branding/email" class="card stack" id="email">
    <h2 class="h3">Email</h2>
    ${fromDeploy ? notice("info", "Email is also set in the deployment settings, which take priority over what is saved here.") : ""}
    <label><span>Sender <span class="muted small hint">(who sign-in emails and invites come from)</span></span>
      <input name="mailFrom" value="${mail?.mailFrom ?? ""}" placeholder="${DEFAULT_MAIL_FROM}" spellcheck="false">
    </label>
    <p class="small muted">Resend's test sender (onboarding@resend.dev) only reaches the email your Resend account uses. To email investors, add your domain in Resend under <strong>Domains</strong>, then put an address on it here, like Data Room &lt;rooms@yourdomain.com&gt;.</p>
    <label>Resend API key
      <input name="resendApiKey" type="password" autocomplete="off" spellcheck="false" placeholder="${mail?.resendApiKey ? "Saved. Paste a new key to replace it." : "re_..."}">
    </label>
    <div><button class="btn" type="submit">Save email settings</button></div>
  </form>`;
}

brandingRoutes.post("/admin/branding/email", async (c) => {
  const form = await c.req.parseBody();
  const mailFrom = typeof form.mailFrom === "string" ? form.mailFrom.trim() : "";
  const key = typeof form.resendApiKey === "string" ? form.resendApiKey.trim() : "";
  if (mailFrom && !SENDER.test(mailFrom)) return c.redirect(back("email_from", "#email"), 303);
  if (key && !RESEND_KEY.test(key)) return c.redirect(back("email_key", "#email"), 303);
  const saved = (await getMailSettings(c.env)) ?? {};
  await putSetting(c.env, "mail", { ...saved, mailFrom: mailFrom || DEFAULT_MAIL_FROM, ...(key ? { resendApiKey: key } : {}) });
  return c.redirect(back("email_saved", "#email"), 303);
});
