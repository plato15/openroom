import { Hono } from "hono";
import { loadSession, sameOrigin } from "./auth";
import { brand, LOGO_SLOTS, logoKey, readBrandSettings, setBrand, themeCss, type LogoSlot } from "./brand";
import type { AppEnv } from "./env";
import { isLocalOrigin } from "./util";
import { messagePage } from "./layout";
import { adminRoutes } from "./routes/admin";
import { investorRoutes } from "./routes/investor";
import { previewRoutes } from "./routes/preview";
import { publicRoutes, testRoutes } from "./routes/public";

const app = new Hono<AppEnv>();

// On Cloudflare, APP_ORIGIN may be left blank: the room then uses the address it was reached on
// (your *.workers.dev address, or a custom domain). Cloudflare only routes your own hostnames to
// the Worker, so the Host cannot be forged. The Node build always requires APP_ORIGIN.
app.use("*", async (c, next) => {
  if (!c.env.APP_ORIGIN) c.env = { ...c.env, APP_ORIGIN: new URL(c.req.url).origin };
  await next();
});

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

app.use("*", async (c, next) => {
  await next();
  const h = c.res.headers;
  // Rendered spreadsheets and Word files set a stricter policy of their own; keep it.
  if (!h.has("content-security-policy")) h.set("content-security-policy", CSP);
  h.set("x-frame-options", "SAMEORIGIN");
  h.set("x-content-type-options", "nosniff");
  // same-origin: other sites never see our URLs (sign-in tokens included), and browsers still send a real Origin on our own form posts.
  h.set("referrer-policy", "same-origin");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  h.set("x-robots-tag", "noindex, nofollow");
  if (c.env.APP_ORIGIN.startsWith("https://")) h.set("strict-transport-security", "max-age=63072000; includeSubDomains");
  if (!h.has("cache-control")) h.set("cache-control", "private, no-store");
});
app.use("*", async (c, next) => {
  await setBrand(c.env);
  await next();
});
app.use("*", sameOrigin);
app.use("*", loadSession);

// Colours and fonts from the BRAND_* settings, loaded after app.css.
app.get("/theme.css", (c) =>
  c.body(themeCss(brand()), 200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" }),
);

// Logos uploaded on the Branding tab. Public, so emails can show them. The URL carries a version,
// so it can be cached for a long time. Uploaded SVGs are never shown as a page of their own:
// they go out as a download with a sandbox policy, and only ever render inside <img>.
app.get("/brand/:slot", async (c) => {
  const slot = c.req.param("slot") as LogoSlot;
  if (!LOGO_SLOTS.includes(slot)) return c.notFound();
  const saved = (await readBrandSettings(c.env)).logos?.[slot];
  const obj = saved ? await c.env.FILES.get(logoKey(slot)) : null;
  if (!saved || !obj) return c.notFound();
  const headers: Record<string, string> = {
    "content-type": saved.type,
    "cache-control": "public, max-age=31536000, immutable",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "cross-origin",
  };
  if (saved.type === "image/svg+xml") headers["content-disposition"] = `attachment; filename="logo.svg"`;
  return new Response(obj.body, { headers });
});

app.use("/__test/*", async (c, next) => (c.env.ENVIRONMENT === "test" && isLocalOrigin(c.env.APP_ORIGIN) ? next() : c.notFound()));
app.route("/", testRoutes);
app.route("/", publicRoutes);
app.route("/", investorRoutes);
app.route("/", previewRoutes);
app.route("/", adminRoutes);

app.notFound((c) => c.html(messagePage(c.get("session") ?? null, "Page not found", "This page does not exist."), 404));
app.onError((err, c) => {
  console.error(err);
  return c.html(messagePage(c.get("session") ?? null, "Something went wrong", "Please try again in a moment."), 500);
});

export default app;
