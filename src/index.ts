import { Hono } from "hono";
import { loadSession, sameOrigin } from "./auth";
import { brand, setBrand, themeCss } from "./brand";
import type { AppEnv } from "./env";
import { isLocalOrigin } from "./util";
import { messagePage } from "./layout";
import { adminRoutes } from "./routes/admin";
import { investorRoutes } from "./routes/investor";
import { previewRoutes } from "./routes/preview";
import { publicRoutes, testRoutes } from "./routes/public";

const app = new Hono<AppEnv>();

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
  setBrand(c.env);
  await next();
});
app.use("*", sameOrigin);
app.use("*", loadSession);

// Colours and fonts from the BRAND_* settings, loaded after app.css.
app.get("/theme.css", (c) =>
  c.body(themeCss(brand()), 200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" }),
);

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
