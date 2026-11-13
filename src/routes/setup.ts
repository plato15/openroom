import { Hono, type MiddlewareHandler } from "hono";
import { html } from "hono/html";
import { startSession } from "../auth";
import {
  brand,
  HEX,
  LOGO_TYPES,
  logoKey,
  MAX_LOGO,
  readBrandSettings,
  saveBrandSettings,
  sniffImage,
  TEXT,
} from "../brand";
import { DEFAULT_MAIL_FROM, sendMail, setupCodeMail } from "../email";
import type { AppEnv, Env } from "../env";
import { notice, page } from "../layout";
import { deleteSetting, getSetting, needsSetup, putSetting, putSettingIfAbsent, roomOwner } from "../settings";
import { isLocalOrigin, normalizeEmail, sha256 } from "../util";

/**
 * First-time setup. A brand new room has no admin, so the first person to open it claims it:
 * they give their email and a Resend key, we send a 6-digit code to that email with that key
 * (proving both work), and typing the code makes them the owner. Then name, colours and logo.
 *
 * Claiming works once: the owner row is written only if absent. Rooms deployed with
 * ADMIN_EMAILS never show this screen.
 */
export const setupRoutes = new Hono<AppEnv>();

const CODE_TTL = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5; // wrong codes before the code is thrown away
const MAX_SENDS_PER_HOUR = 5; // codes sent, whoever asks
const RESEND_KEY = /^re_[A-Za-z0-9_]{8,120}$/;
const SENDER = /^([^\x00-\x1f<>"]{1,60} )?<?[^\s<>@"]+@[^\s<>@"]+\.[A-Za-z]{2,}>?$/;

type Pending = { email: string; codeHash: string; expiresAt: number; attempts: number; resendApiKey: string; mailFrom: string };

const codeHash = (email: string, code: string) => sha256(`setup:${email}:${code}`);

function newCode(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, "0");
}

/** Only while the room has no admin. Afterwards these pages send people to the sign-in page. */
const onlyWhileUnclaimed: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await needsSetup(c.env))) return c.redirect("/", c.req.method === "GET" ? 302 : 303);
  await next();
};
/** The later steps are for the owner, signed in by the code step. */
const ownerOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("session")?.role !== "admin") return c.redirect("/", c.req.method === "GET" ? 302 : 303);
  await next();
};

function steps(n: 1 | 2 | 3) {
  return html`<div class="steps" aria-label="Step ${n} of 3">${[1, 2, 3].map((i) => html`<span class="${i <= n ? "on" : ""}"></span>`)}</div>`;
}

function claimPage(env: Env, error?: string, values: { email?: string; mailFrom?: string } = {}) {
  return page({
    title: "Set up your data room",
    narrow: true,
    body: html`<section class="hero">
        <p class="eyebrow">Welcome</p>
        <h1 class="display">Set up your data room</h1>
        <p class="lead">Three short steps and you are ready to share documents with investors.</p>
      </section>
      <section class="card">
        ${steps(1)}
        <h2 class="h3">Who you are</h2>
        ${notice("error", error)}
        <form method="post" action="/setup/start" class="stack">
          <label><span>Your email <span class="muted small hint">(you sign in with it, no password)</span></span>
            <input name="email" type="email" required autocomplete="email" inputmode="email" value="${values.email ?? ""}" placeholder="you@company.com">
          </label>
          <label><span>Resend API key <span class="muted small hint">(sends the sign-in emails)</span></span>
            <input name="resendApiKey" type="password" required autocomplete="off" spellcheck="false" placeholder="re_...">
          </label>
          <p class="small muted">Free at <a href="https://resend.com/signup" target="_blank" rel="noopener">resend.com</a>: sign up with the same email as above, open <strong>API Keys</strong>, create a key and paste it here.</p>
          <details>
            <summary class="small">Send from my own domain (optional)</summary>
            <label class="small">Sender
              <input name="mailFrom" value="${values.mailFrom ?? ""}" placeholder="${DEFAULT_MAIL_FROM}" spellcheck="false">
            </label>
            <p class="small muted">Leave empty for now. Resend's test sender only reaches your own email, which is enough to set up. To email investors, verify your domain in Resend and set the sender later in <strong>Settings</strong>.</p>
          </details>
          <button class="btn wide" type="submit">Send me a code</button>
        </form>
      </section>
      <p class="small muted center">Not your room? If you did not just deploy this data room, close this page.</p>`,
  });
}

function codePage(env: Env, email: string, error?: string, devCode?: string) {
  return page({
    title: "Check your email",
    narrow: true,
    body: html`<section class="card">
        ${steps(1)}
        <h1 class="h2">Check your email</h1>
        <p class="muted">We sent a 6-digit code to <strong>${email}</strong>. It works for 15 minutes.</p>
        ${notice("error", error)}
        <form method="post" action="/setup/verify" class="stack">
          <label>Code
            <input name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
          </label>
          <button class="btn wide" type="submit">Continue</button>
        </form>
        ${devCode ? html`<p class="dev">Local mode: your code is ${devCode}</p>` : ""}
        <p class="small muted">No email? Check spam. With Resend's test sender, the email must be the one you signed up to Resend with. <a href="/setup">Start again</a></p>
      </section>`,
  });
}

setupRoutes.get("/setup", onlyWhileUnclaimed, (c) => c.html(claimPage(c.env)));

setupRoutes.post("/setup/start", onlyWhileUnclaimed, async (c) => {
  const form = await c.req.parseBody();
  const email = normalizeEmail(form.email);
  const resendApiKey = typeof form.resendApiKey === "string" ? form.resendApiKey.trim() : "";
  const mailFrom = typeof form.mailFrom === "string" ? form.mailFrom.trim() : "";
  const keep = { email: typeof form.email === "string" ? form.email.slice(0, 254) : "", mailFrom: mailFrom.slice(0, 120) };
  if (!email) return c.html(claimPage(c.env, "Enter a valid email address.", keep), 400);
  if (!RESEND_KEY.test(resendApiKey)) return c.html(claimPage(c.env, "That does not look like a Resend API key. It starts with re_.", keep), 400);
  if (mailFrom && !SENDER.test(mailFrom)) return c.html(claimPage(c.env, "The sender should look like Data Room <rooms@yourdomain.com>.", keep), 400);

  // A limit on codes sent, whoever asks, so the page cannot be used to send a flood of email.
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const sends = ((await getSetting<number[]>(c.env, "setup_sends")) ?? []).filter((t) => t > hourAgo);
  if (sends.length >= MAX_SENDS_PER_HOUR) return c.html(claimPage(c.env, "Too many codes were sent in the last hour. Try again later.", keep), 429);
  await putSetting(c.env, "setup_sends", [...sends, Date.now()]);

  const code = newCode();
  const ok = await sendMail(c.env, setupCodeMail(c.env.APP_ORIGIN, email, code), { resendApiKey, mailFrom: mailFrom || DEFAULT_MAIL_FROM });
  if (!ok) {
    return c.html(
      claimPage(c.env, "Resend did not accept that email. Check the key, and that this is the email you signed up to Resend with (Resend's test sender only reaches that one).", keep),
      400,
    );
  }
  const pending: Pending = { email, codeHash: await codeHash(email, code), expiresAt: Date.now() + CODE_TTL, attempts: 0, resendApiKey, mailFrom };
  await putSetting(c.env, "setup_pending", pending);
  const dev = c.env.ENVIRONMENT === "local" && isLocalOrigin(c.env.APP_ORIGIN) ? code : undefined;
  return c.html(codePage(c.env, email, undefined, dev));
});

setupRoutes.post("/setup/verify", onlyWhileUnclaimed, async (c) => {
  const form = await c.req.parseBody();
  const code = typeof form.code === "string" ? form.code.replace(/\s/g, "") : "";
  const pending = await getSetting<Pending>(c.env, "setup_pending");
  if (!pending || pending.expiresAt < Date.now()) {
    await deleteSetting(c.env, "setup_pending");
    return c.html(claimPage(c.env, "That code has expired. Enter your details again for a new one."), 400);
  }
  if (!/^\d{6}$/.test(code) || (await codeHash(pending.email, code)) !== pending.codeHash) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await deleteSetting(c.env, "setup_pending");
      return c.html(claimPage(c.env, "Too many wrong codes. Enter your details again for a new one.", { email: pending.email }), 400);
    }
    await putSetting(c.env, "setup_pending", { ...pending, attempts });
    return c.html(codePage(c.env, pending.email, `That code is not right. ${MAX_ATTEMPTS - attempts} tries left.`), 400);
  }

  // The claim: written only if nobody claimed the room in the meantime.
  const claimed = await putSettingIfAbsent(c.env, "owner", { email: pending.email, claimedAt: Date.now() });
  await deleteSetting(c.env, "setup_pending");
  if (!claimed) return c.redirect("/", 303);
  await putSetting(c.env, "mail", { resendApiKey: pending.resendApiKey, mailFrom: pending.mailFrom || DEFAULT_MAIL_FROM });
  await deleteSetting(c.env, "setup_sends");
  await startSession(c, pending.email, "admin");
  return c.redirect("/setup/brand", 303);
});

// ---------- Step 2: make it yours ----------

function brandPage(error?: string) {
  const b = brand();
  return page({
    title: "Make it yours",
    narrow: true,
    session: null,
    body: html`<section class="card">
        ${steps(2)}
        <h1 class="h2">Make it yours</h1>
        <p class="muted">This is what investors see. You can change all of it later in Settings.</p>
        ${notice("error", error)}
        <form method="post" action="/setup/brand" enctype="multipart/form-data" class="stack">
          <label>Company name
            <input name="name" required maxlength="80" value="${b.name === "Openroom" ? "" : b.name}" placeholder="Acme" autofocus>
          </label>
          <div class="two">
            <label><span>Main colour <span class="muted small hint">(buttons)</span></span>
              <span class="color-field"><input type="color" name="color" value="${b.color.toLowerCase()}" aria-label="Main colour"></span>
            </label>
            <label>Header colour
              <span class="color-field"><input type="color" name="dark" value="${b.dark.toLowerCase()}" aria-label="Header colour"></span>
            </label>
          </div>
          <label><span>Logo <span class="muted small hint">(optional; shown on the header colour, so a light version works best)</span></span>
            <input type="file" name="logo" accept="${LOGO_TYPES.header.join(",")}">
          </label>
          <p class="small muted">PNG, JPEG, WebP or SVG, up to 512 KB. No logo? Your company name is shown instead.</p>
          <button class="btn wide" type="submit">Continue</button>
        </form>
        <p class="small center"><a href="/setup/done">Skip for now</a></p>
      </section>`,
  });
}

setupRoutes.get("/setup/brand", ownerOnly, (c) => c.html(brandPage()));

setupRoutes.post("/setup/brand", ownerOnly, async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === "string" ? form.name.trim() : "";
  const color = typeof form.color === "string" ? form.color.trim() : "";
  const dark = typeof form.dark === "string" ? form.dark.trim() : "";
  if (!TEXT.test(name)) return c.html(brandPage("Enter your company name (up to 80 characters, without < or >)."), 400);
  if ((color && !HEX.test(color)) || (dark && !HEX.test(dark))) return c.html(brandPage("Pick the colours with the colour boxes."), 400);

  const saved = await readBrandSettings(c.env);
  const next = { ...saved, name, color: color ? color.toUpperCase() : saved.color, dark: dark ? dark.toUpperCase() : saved.dark };
  const logo = form.logo;
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > MAX_LOGO) return c.html(brandPage("That logo is over 512 KB. Export a smaller one, or skip it for now."), 400);
    const bytes = new Uint8Array(await logo.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type || !LOGO_TYPES.header.includes(type)) return c.html(brandPage("That file is not a PNG, JPEG, WebP or SVG image."), 400);
    await c.env.FILES.put(logoKey("header"), bytes, { httpMetadata: { contentType: type } });
    next.logos = { ...saved.logos, header: { type, v: Date.now() } };
  }
  await saveBrandSettings(c.env, next);
  return c.redirect("/setup/done", 303);
});

// ---------- Step 3: ready ----------

setupRoutes.get("/setup/done", ownerOnly, async (c) => {
  await putSetting(c.env, "setup", { doneAt: Date.now() });
  const mail = await getSetting<{ mailFrom?: string }>(c.env, "mail");
  const testSender = !c.env.MAIL_FROM && (!mail?.mailFrom || mail.mailFrom.includes("resend.dev"));
  const owner = await roomOwner(c.env);
  return c.html(
    page({
      title: "You are ready",
      narrow: true,
      session: c.get("session"),
      body: html`<section class="card">
          ${steps(3)}
          <h1 class="h2">Your data room is ready</h1>
          <p class="muted">Next:</p>
          <ol class="setup-done">
            <li><strong>Add a folder and upload documents.</strong> They stay hidden until you mark them Visible.</li>
            <li><strong>Invite an investor</strong> and tick the folders they may see.</li>
            <li><strong>Preview</strong> the room exactly as that investor sees it.</li>
          </ol>
          ${testSender
            ? notice("info", `Before inviting investors: sign-in emails can only reach ${owner?.email ?? "you"} until you verify your domain in Resend and set your sender in Settings.`)
            : ""}
          <p><a class="btn wide" href="/admin">Go to my data room</a></p>
        </section>`,
    }),
  );
});
