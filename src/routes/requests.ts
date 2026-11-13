import { Hono } from "hono";
import { html } from "hono/html";
import { activeInvestor } from "../auth";
import { brand } from "../brand";
import { accessRequestMail, sendMail } from "../email";
import type { AppEnv } from "../env";
import { notice, page } from "../layout";
import { isAdmin, roomOwner } from "../settings";
import { adminEmails, normalizeEmail, now, randomId } from "../util";

/**
 * "Request access" from the sign-in page. Whatever happens (new request, someone who already
 * has access, a limit reached, a spam bot), the visitor sees the same thank-you page, so the
 * page never reveals who is invited.
 */
export const requestRoutes = new Hono<AppEnv>();

const PER_EMAIL_PER_DAY = 3;
const PER_HOUR = 30; // all requests together: a flood stops being stored or emailed
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : "");

function requestPage(error?: string, v: { email?: string; name?: string; firm?: string; note?: string } = {}) {
  return page({
    title: "Request access",
    narrow: true,
    body: html`<section class="hero">
        <p class="eyebrow">Request access</p>
        <h1 class="display">${brand().roomName}</h1>
        <p class="lead">Tell us who you are. The team reviews every request and emails you when access is ready.</p>
      </section>
      <section class="card">
        ${notice("error", error)}
        <form method="post" action="/request" class="stack">
          <label for="r-name">Your name</label>
          <input id="r-name" name="name" required maxlength="100" autocomplete="name" value="${v.name ?? ""}">
          <label for="r-email">Work email</label>
          <input id="r-email" name="email" type="email" required maxlength="254" autocomplete="email" inputmode="email" value="${v.email ?? ""}" placeholder="you@fund.com">
          <label for="r-firm"><span>Firm <span class="muted small hint">(optional)</span></span></label>
          <input id="r-firm" name="firm" maxlength="120" autocomplete="organization" value="${v.firm ?? ""}">
          <label for="r-note"><span>Anything we should know? <span class="muted small hint">(optional)</span></span></label>
          <textarea id="r-note" name="note" maxlength="1000" rows="3">${v.note ?? ""}</textarea>
          <div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
          <button class="btn wide" type="submit">Request access</button>
        </form>
      </section>
      <p class="small center">Already have access? <a href="/">Sign in</a></p>`,
  });
}

const thanksPage = () =>
  page({
    title: "Request sent",
    narrow: true,
    body: html`<section class="card center">
        <div class="mail-icon" aria-hidden="true">✓</div>
        <h1 class="h2">Thank you</h1>
        <p class="muted">The team will review your request and email you when access is ready.</p>
        <p class="small muted">If you already have access, you can <a href="/">sign in</a> now.</p>
      </section>`,
  });

requestRoutes.get("/request", (c) => c.html(requestPage()));

requestRoutes.post("/request", async (c) => {
  const form = await c.req.parseBody();
  const email = normalizeEmail(form.email);
  const name = clip(form.name, 100);
  const firm = clip(form.firm, 120);
  const note = typeof form.note === "string" ? form.note.replace(/\r/g, "").trim().slice(0, 1000) : "";
  if (!email || !name) return c.html(requestPage("Enter your name and a valid email address.", { email: clip(form.email, 254), name, firm, note }), 400);

  // A bot that fills every field gets the same thanks and nothing else.
  if (clip(form.website, 200)) return c.html(thanksPage());
  // People who can already sign in do not need a request.
  if ((await isAdmin(c.env, email)) || (await activeInvestor(c.env, email))) return c.html(thanksPage());

  const t = now();
  const [mine, recent] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE email = ? AND created_at > ?").bind(email, t - 24 * 3600_000).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE created_at > ?").bind(t - 3600_000).first<{ n: number }>(),
  ]);
  if ((mine?.n ?? 0) >= PER_EMAIL_PER_DAY || (recent?.n ?? 0) >= PER_HOUR) return c.html(thanksPage());

  // One open request per person: asking again updates it instead of adding another.
  const open = await c.env.DB.prepare("SELECT id FROM access_requests WHERE email = ? AND status = 'pending'").bind(email).first<{ id: string }>();
  if (open) {
    await c.env.DB.prepare("UPDATE access_requests SET name = ?, firm = ?, note = ?, created_at = ? WHERE id = ?").bind(name, firm, note, t, open.id).run();
    return c.html(thanksPage());
  }
  await c.env.DB.prepare(
    "INSERT INTO access_requests (id, email, name, firm, note, created_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(randomId(), email, name, firm, note, t, c.req.header("cf-connecting-ip") ?? null)
    .run();

  // Tell every admin: ADMIN_EMAILS plus the owner from the setup screen.
  const owner = await roomOwner(c.env);
  const admins = new Set([...adminEmails(c.env.ADMIN_EMAILS), ...(owner ? [owner.email] : [])]);
  c.executionCtx.waitUntil(
    Promise.all([...admins].map((to) => sendMail(c.env, accessRequestMail(c.env.APP_ORIGIN, to, { name, email, firm, note })))).catch((err) =>
      console.error(`access request email failed: ${(err as Error).message}`),
    ),
  );
  return c.html(thanksPage());
});
