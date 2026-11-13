import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { brand, googleFontsHref } from "./brand";
import type { Session } from "./env";

/** Bump when public/static/app.css or app.js change, so browsers fetch the new files. */
const ASSET_VERSION = "6";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export function page(opts: {
  title: string;
  session?: Session | null;
  nav?: "documents" | "investors" | "activity" | "branding";
  body: Html;
  narrow?: boolean;
  /** Admin Preview: investor screens with a banner saying whose view this is. */
  preview?: { text: string; back: string };
}) {
  const { title, session, nav, body, narrow, preview } = opts;
  const b = brand();
  const adminNav =
    session?.role === "admin" && !preview
      ? html`<nav class="tabs" aria-label="Admin">
          <a href="/admin" class="${nav === "documents" ? "on" : ""}">Documents</a>
          <a href="/admin/investors" class="${nav === "investors" ? "on" : ""}">Investors</a>
          <a href="/admin/activity" class="${nav === "activity" ? "on" : ""}">Activity</a>
          <a href="/admin/branding" class="${nav === "branding" ? "on" : ""}">Branding</a>
        </nav>`
      : "";
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="${b.dark}">
<title>${title} · ${b.roomName}</title>
<link rel="icon" href="${b.icon}" type="${b.iconType}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${googleFontsHref(b)}">
<link rel="stylesheet" href="/static/app.css?v=${ASSET_VERSION}">
<link rel="stylesheet" href="/theme.css">
<script src="/static/app.js?v=${ASSET_VERSION}" defer></script>
</head>
<body>
<header class="bar">
  <div class="bar-in ${narrow ? "narrow" : ""}">
    <a href="/" class="brand" aria-label="${b.roomName} home">
      <img src="${b.logo}" alt="${b.name}" height="22">
      <span class="brand-tag">Data room</span>
    </a>
    ${session
      ? html`<form method="post" action="/logout" class="signout">
          <span class="who">${session.email}</span>
          <button type="submit" class="link-btn">Sign out</button>
        </form>`
      : ""}
  </div>
  ${adminNav ? html`<div class="bar-in ${narrow ? "narrow" : ""}">${adminNav}</div>` : ""}
</header>
${preview
  ? html`<div class="preview-bar" role="status"><div class="bar-in">
      <span><strong>Preview.</strong> ${preview.text}</span>
      <a href="${preview.back}" class="btn small ghost">Back to admin</a>
    </div></div>`
  : ""}
<main class="wrap ${narrow ? "narrow" : ""}">${body}</main>
<footer class="foot wrap ${narrow ? "narrow" : ""}">${b.legalName}. Confidential. Shared for due diligence only.${b.credit
  ? html`<span class="credit">Powered by <a href="https://github.com/plato15/openroom" rel="noopener">Openroom</a>.</span>`
  : ""}</footer>
</body>
</html>`;
}

export function notice(kind: "ok" | "error" | "info", text: string | null | undefined) {
  if (!text) return "";
  return html`<div class="notice ${kind}" role="${kind === "error" ? "alert" : "status"}">${text}</div>`;
}

export function messagePage(session: Session | null, title: string, text: string, back = "/") {
  return page({
    title,
    session,
    narrow: true,
    body: html`<section class="card center">
      <h1 class="h2">${title}</h1>
      <p class="muted">${text}</p>
      <p><a class="btn" href="${back}">Back</a></p>
    </section>`,
  });
}
