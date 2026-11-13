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
 * 1. their email, 2. a Resend key (guided), 3. the 6-digit code we send to that email with that
 * key, which makes them the owner, 4. name, colours and logo with a live preview. Then a ready
 * page with what to do next.
 *
 * Claiming works once: the owner row is written only if absent. Rooms deployed with
 * ADMIN_EMAILS never show this screen. Pages work without JavaScript; public/static/app.js adds
 * the live preview, colour swatches and the code box that continues by itself.
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

const STEPS = ["Your email", "Connect email", "Confirm", "Your brand"] as const;

/** The page frame for every setup step: a labelled progress bar over one card. */
function stepPage(n: 1 | 2 | 3 | 4, title: string, body: unknown, opts: { wide?: boolean } = {}) {
  return page({
    title,
    narrow: !opts.wide,
    bare: true,
    body: html`<div class="setup ${opts.wide ? "wide" : ""}">
      <div class="steps" role="progressbar" aria-valuemin="1" aria-valuemax="4" aria-valuenow="${n}" aria-label="Setup progress">
        ${STEPS.map((_, i) => html`<span class="${i < n ? "on" : ""}"></span>`)}
      </div>
      <p class="step-label">Step ${n} of 4 · ${STEPS[n - 1]}</p>
      ${body}
    </div>`,
  });
}

// ---------- Step 1: your email ----------

function emailStep(error?: string, email = "") {
  return stepPage(
    1,
    "Set up your data room",
    html`<section class="card setup-card">
        <h1 class="h2">Welcome. Let's set up your data room.</h1>
        <p class="muted">It takes about three minutes. First, the email you will sign in with. There is no password: we email you a link each time.</p>
        ${notice("error", error)}
        <form method="post" action="/setup/email" class="stack">
          <label for="email">Your email</label>
          <input id="email" name="email" type="email" required autocomplete="email" inputmode="email" value="${email}" placeholder="you@company.com" autofocus>
          <button class="btn wide" type="submit">Continue</button>
        </form>
      </section>
      <p class="small muted center">Not your room? If you did not just deploy this data room, close this page.</p>`,
  );
}

setupRoutes.get("/setup", onlyWhileUnclaimed, (c) => c.html(emailStep()));

setupRoutes.post("/setup/email", onlyWhileUnclaimed, async (c) => {
  const form = await c.req.parseBody();
  const email = normalizeEmail(form.email);
  if (!email) return c.html(emailStep("Enter a valid email address.", typeof form.email === "string" ? form.email.slice(0, 254) : ""), 400);
  return c.html(keyStep(email));
});

// ---------- Step 2: connect email (Resend) ----------

function keyStep(email: string, error?: string, mailFrom = "") {
  return stepPage(
    2,
    "Connect email",
    html`<section class="card setup-card">
        <h1 class="h2">Connect email sending</h1>
        <p class="muted">Your room sends sign-in links and invites through <strong>Resend</strong>, a free email service. You need a key from it, once.</p>
        ${notice("error", error)}
        <ol class="guide">
          <li>
            <span>Create a free Resend account with <strong>${email}</strong>.</span>
            <a class="btn small ghost" href="https://resend.com/signup" target="_blank" rel="noopener">Open Resend ↗</a>
          </li>
          <li>
            <span>In Resend, open <strong>API Keys</strong> and click <strong>Create API key</strong>. Keep the suggested settings.</span>
            <a class="btn small ghost" href="https://resend.com/api-keys" target="_blank" rel="noopener">Open API Keys ↗</a>
          </li>
          <li><span>Copy the key (it starts with <code>re_</code>) and paste it below.</span></li>
        </ol>
        <form method="post" action="/setup/start" class="stack">
          <input type="hidden" name="email" value="${email}">
          <label for="key">Resend API key</label>
          <span class="reveal-field">
            <input id="key" name="resendApiKey" type="password" required autocomplete="off" spellcheck="false" placeholder="re_..." autofocus>
            <button type="button" class="link-btn small" data-reveal="key" aria-controls="key">Show</button>
          </span>
          <details class="more">
            <summary>Send from my own domain (optional)</summary>
            <label class="small" for="from">Sender</label>
            <input id="from" name="mailFrom" value="${mailFrom}" placeholder="${DEFAULT_MAIL_FROM}" spellcheck="false">
            <p class="small muted">Leave this empty for now. Resend's test sender reaches your own email, which is all setup needs. Before inviting investors, verify your domain in Resend and change the sender in Settings.</p>
          </details>
          <button class="btn wide" type="submit">Send my code</button>
        </form>
      </section>
      <p class="small center"><a href="/setup">Use a different email</a></p>`,
  );
}

/** Sends a fresh code with the given key, within the hourly limit. Returns the code, or an error to show. */
async function sendCode(
  env: Env,
  email: string,
  resendApiKey: string,
  mailFrom: string,
): Promise<{ code: string } | { error: string; status: 400 | 429 }> {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const sends = ((await getSetting<number[]>(env, "setup_sends")) ?? []).filter((t) => t > hourAgo);
  if (sends.length >= MAX_SENDS_PER_HOUR) return { error: "Too many codes were sent in the last hour. Try again later.", status: 429 };
  await putSetting(env, "setup_sends", [...sends, Date.now()]);
  const code = newCode();
  const ok = await sendMail(env, setupCodeMail(env.APP_ORIGIN, email, code), { resendApiKey, mailFrom: mailFrom || DEFAULT_MAIL_FROM });
  if (!ok) {
    return {
      error: "Resend did not accept that. Check the key, and that your Resend account uses this same email (Resend's test sender only reaches that one).",
      status: 400,
    };
  }
  const pending: Pending = { email, codeHash: await codeHash(email, code), expiresAt: Date.now() + CODE_TTL, attempts: 0, resendApiKey, mailFrom };
  await putSetting(env, "setup_pending", pending);
  return { code };
}

setupRoutes.post("/setup/start", onlyWhileUnclaimed, async (c) => {
  const form = await c.req.parseBody();
  const email = normalizeEmail(form.email);
  const resendApiKey = typeof form.resendApiKey === "string" ? form.resendApiKey.trim() : "";
  const mailFrom = typeof form.mailFrom === "string" ? form.mailFrom.trim().slice(0, 120) : "";
  if (!email) return c.html(emailStep("Enter a valid email address."), 400);
  if (!RESEND_KEY.test(resendApiKey)) return c.html(keyStep(email, "That does not look like a Resend API key. It starts with re_.", mailFrom), 400);
  if (mailFrom && !SENDER.test(mailFrom)) return c.html(keyStep(email, "The sender should look like Data Room <rooms@yourdomain.com>.", mailFrom), 400);
  const sent = await sendCode(c.env, email, resendApiKey, mailFrom);
  if ("error" in sent) return c.html(keyStep(email, sent.error, mailFrom), sent.status);
  return c.html(codeStep(email, undefined, devCode(c.env, sent.code)));
});

// ---------- Step 3: confirm with the code ----------

const devCode = (env: Env, code: string) => (env.ENVIRONMENT === "local" && isLocalOrigin(env.APP_ORIGIN) ? code : undefined);

function codeStep(email: string, error?: string, dev?: string, info?: string) {
  return stepPage(
    3,
    "Check your email",
    html`<section class="card setup-card">
        <div class="mail-icon center" aria-hidden="true">✉</div>
        <h1 class="h2 center">Check your email</h1>
        <p class="muted center">We sent a 6-digit code to <strong>${email}</strong>. It works for 15 minutes.</p>
        ${notice("error", error)}${notice("ok", info)}
        <form method="post" action="/setup/verify" class="stack">
          <label for="code" class="center">Code</label>
          <input id="code" name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus aria-describedby="code-hint">
          <button class="btn wide" type="submit">Confirm</button>
        </form>
        ${dev ? html`<p class="dev">Local mode: your code is ${dev}</p>` : ""}
        <p id="code-hint" class="small muted center">No email after a minute? Check spam.</p>
        <form method="post" action="/setup/resend" class="center"><button class="link-btn small" type="submit">Send a new code</button></form>
      </section>
      <p class="small center"><a href="/setup">Start again with a different email</a></p>`,
  );
}

setupRoutes.post("/setup/resend", onlyWhileUnclaimed, async (c) => {
  const pending = await getSetting<Pending>(c.env, "setup_pending");
  if (!pending) return c.html(emailStep("Enter your email again to get a new code."), 400);
  const sent = await sendCode(c.env, pending.email, pending.resendApiKey, pending.mailFrom);
  if ("error" in sent) return c.html(codeStep(pending.email, sent.error), sent.status);
  return c.html(codeStep(pending.email, undefined, devCode(c.env, sent.code), "A new code is on its way. Use the newest email."));
});

setupRoutes.post("/setup/verify", onlyWhileUnclaimed, async (c) => {
  const form = await c.req.parseBody();
  const code = typeof form.code === "string" ? form.code.replace(/\s/g, "") : "";
  const pending = await getSetting<Pending>(c.env, "setup_pending");
  if (!pending || pending.expiresAt < Date.now()) {
    await deleteSetting(c.env, "setup_pending");
    return c.html(emailStep("That code has expired. Enter your email again for a new one."), 400);
  }
  if (!/^\d{6}$/.test(code) || (await codeHash(pending.email, code)) !== pending.codeHash) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await deleteSetting(c.env, "setup_pending");
      return c.html(emailStep("Too many wrong codes. Enter your email again for a new one.", pending.email), 400);
    }
    await putSetting(c.env, "setup_pending", { ...pending, attempts });
    return c.html(codeStep(pending.email, `That code is not right. ${MAX_ATTEMPTS - attempts} tries left.`), 400);
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

// ---------- Step 4: your brand ----------

/** Ready-made colours, so nobody has to use a colour picker. */
const MAIN_SWATCHES = ["#2563EB", "#0E9F6E", "#7C3AED", "#DB2777", "#EA580C", "#0891B2", "#111827", "#B45309"];
const HEADER_SWATCHES = ["#0F172A", "#1B2A41", "#111827", "#1E1B4B", "#052E16", "#3B0764"];

function swatches(name: "color" | "dark", colours: string[], current: string) {
  return html`<div class="swatches" role="group" aria-label="${name === "color" ? "Main colour" : "Header colour"} choices">
    ${colours.map(
      (hex) => html`<button type="button" class="swatch" data-swatch="${hex}" data-for="${name}" hidden
        aria-label="${hex}" aria-pressed="${hex.toLowerCase() === current.toLowerCase() ? "true" : "false"}"></button>`,
    )}
    <label class="swatch custom" title="Any colour"><input type="color" name="${name}" value="${current.toLowerCase()}" aria-label="Any colour"></label>
  </div>`;
}

function brandStep(error?: string) {
  const b = brand();
  const name = b.name === "Openroom" ? "" : b.name;
  return stepPage(
    4,
    "Your brand",
    html`<section class="card setup-card">
        <h1 class="h2">Make it yours</h1>
        <p class="muted">This is what investors see. You can change all of it later in Settings.</p>
        ${notice("error", error)}
        <form method="post" action="/setup/brand" enctype="multipart/form-data" class="brand-form">
          <div class="stack">
            <label for="name">Company name</label>
            <input id="name" name="name" required maxlength="80" value="${name}" placeholder="Acme" autocomplete="organization" autofocus>

            <span class="field-label">Main colour <span class="muted small hint">(buttons and links)</span></span>
            ${swatches("color", MAIN_SWATCHES, b.color)}

            <span class="field-label">Header colour</span>
            ${swatches("dark", HEADER_SWATCHES, b.dark)}

            <span class="field-label">Logo <span class="muted small hint">(optional)</span></span>
            <label class="drop" for="logo">
              <input id="logo" type="file" name="logo" accept="${LOGO_TYPES.header.join(",")}">
              <span class="drop-text"><strong>Choose your logo</strong><span class="small muted">PNG, JPEG, WebP or SVG up to 512 KB. It sits on the header colour, so a white or light version works best.</span></span>
            </label>
          </div>

          <aside class="live" aria-label="Preview" data-preview>
            <p class="small muted">Preview</p>
            <div class="live-room">
              <div class="bp-bar" data-pv-bar>
                <img data-pv-logo alt="" ${b.logo ? html`src="${b.logo}"` : "hidden"}>
                <span class="brand-name" data-pv-name ${b.logo ? "hidden" : ""}>${name || "Your company"}</span>
                <span class="brand-tag">Data room</span>
              </div>
              <div class="bp-body">
                <p class="h3" data-pv-room>${name || "Your company"} data room</p>
                <p class="small muted">Welcome. Here are the documents shared with you.</p>
                <span class="btn small" data-pv-btn>Open document</span>
              </div>
            </div>
          </aside>

          <div class="brand-actions">
            <button class="btn wide" type="submit">Finish setup</button>
            <a class="small" href="/setup/done">Skip for now</a>
          </div>
        </form>
      </section>`,
    { wide: true },
  );
}

setupRoutes.get("/setup/brand", ownerOnly, (c) => c.html(brandStep()));

setupRoutes.post("/setup/brand", ownerOnly, async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === "string" ? form.name.trim() : "";
  const color = typeof form.color === "string" ? form.color.trim() : "";
  const dark = typeof form.dark === "string" ? form.dark.trim() : "";
  if (!TEXT.test(name)) return c.html(brandStep("Enter your company name (up to 80 characters, without < or >)."), 400);
  if ((color && !HEX.test(color)) || (dark && !HEX.test(dark))) return c.html(brandStep("Pick the colours with the colour buttons."), 400);

  const saved = await readBrandSettings(c.env);
  const next = { ...saved, name, color: color ? color.toUpperCase() : saved.color, dark: dark ? dark.toUpperCase() : saved.dark };
  const logo = form.logo;
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > MAX_LOGO) return c.html(brandStep("That logo is over 512 KB. Export a smaller one, or skip it for now."), 400);
    const bytes = new Uint8Array(await logo.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type || !LOGO_TYPES.header.includes(type)) return c.html(brandStep("That file is not a PNG, JPEG, WebP or SVG image."), 400);
    await c.env.FILES.put(logoKey("header"), bytes, { httpMetadata: { contentType: type } });
    next.logos = { ...saved.logos, header: { type, v: Date.now() } };
  }
  await saveBrandSettings(c.env, next);
  return c.redirect("/setup/done", 303);
});

// ---------- Ready ----------

setupRoutes.get("/setup/done", ownerOnly, async (c) => {
  await putSetting(c.env, "setup", { doneAt: Date.now() });
  const mail = await getSetting<{ mailFrom?: string }>(c.env, "mail");
  const testSender = !c.env.MAIL_FROM && (!mail?.mailFrom || mail.mailFrom.includes("resend.dev"));
  const owner = await roomOwner(c.env);
  const b = brand();
  return c.html(
    page({
      title: "You are all set",
      narrow: true,
      bare: true,
      session: c.get("session"),
      body: html`<div class="setup">
          <section class="card setup-card">
            <div class="done-mark" aria-hidden="true">✓</div>
            <h1 class="h2 center">${b.name === "Openroom" ? "Your data room is ready" : `The ${b.roomName} is ready`}</h1>
            <p class="muted center">Three things to do next, in this order.</p>
            <ol class="next-steps">
              <li>
                <span><strong>Add your documents.</strong> Make a folder and upload. Files stay hidden until you mark them Visible.</span>
                <a class="btn small" href="/admin">Add a folder</a>
              </li>
              <li>
                <span><strong>Invite an investor.</strong> Tick the folders they may see. They sign in with their email.</span>
                <a class="btn small ghost" href="/admin/investors">Invite</a>
              </li>
              <li>
                <span><strong>See it as an investor.</strong> Preview the room exactly as they will.</span>
                <a class="btn small ghost" href="/admin/preview">Preview</a>
              </li>
            </ol>
            ${testSender
              ? notice(
                  "info",
                  `One more thing before inviting investors: right now sign-in emails can only reach ${owner?.email ?? "you"}. Verify your domain in Resend, then set your sender in Settings, under Email.`,
                )
              : ""}
          </section>
          <p class="center"><a class="btn wide" href="/admin">Go to my data room</a></p>
        </div>`,
    }),
  );
});
