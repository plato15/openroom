# Security

Openroom holds confidential documents, so security reports are welcome and taken seriously.

**Please do not open a public issue for a vulnerability.** Report it privately through GitHub: the **Security** tab of this repository, then **Report a vulnerability**. Include the steps to reproduce and what an attacker could reach.

## What Openroom promises

- A file is served only to a signed-in investor who is not revoked, not past their end date, and has access to the file's folder, and only if the file is marked Visible. Everything else is a 404.
- Subfolders are one level deep. Access is granted on top-level folders only and covers their subfolders; a file in a subfolder is reached only through the grant on its top-level folder.
- Short links (`/deck`) are names, not keys: every open goes through the same access check, and a link to something you cannot see returns exactly the same page as a link that does not exist. After sign-in, people are only ever sent to the room's own document or folder addresses, never to another site.
- Template placeholders are never served to investors, even if marked Visible, and cannot be made visible until a real document is uploaded over them.
- Files live in a private R2 bucket (or, with Docker, a private folder or S3 bucket) and leave it only through the app after that check. The one rule lives in `src/access.ts` and the same tests check it on both builds.
- Ids and tokens are 128 or 256 random bits. Only SHA-256 hashes of sign-in tokens and session cookies are stored.
- Form posts must come from the room's own origin. Pages use a strict Content Security Policy with no inline scripts; rendered spreadsheets and Word files run with scripts switched off.

- Branding logos are the only files served without signing in (`/brand/header`, `/brand/email`, `/brand/icon`), because emails show them. Only admins can upload them. They are checked by their first bytes (PNG, JPEG, WebP or SVG, up to 512 KB), and an uploaded SVG is only ever shown inside an image tag: opened directly, it downloads under a sandbox policy instead of running as a page. Names, colours and fonts are checked against strict patterns before they reach CSS, pages or emails.

## Claiming a new room

A room deployed without `ADMIN_EMAILS` has no admin. Until someone claims it, every page leads to the setup screen, and **the first person to finish it becomes the owner**. This is the same model as most self-hosted apps, and it means:

- Claiming needs a 6-digit code sent to the claimer's email with the Resend key they enter. A code works for 15 minutes; five wrong tries throw it away; at most five codes are sent per hour, whoever asks.
- The owner is written only if no owner exists yet, in one statement, so a room can be claimed once. After that the setup screen is gone for good.
- The risk is the short window between deploying and claiming: someone who finds the brand new address first could claim it. Claim your room straight after deploying, or set `ADMIN_EMAILS` before the first visit to skip claiming. If someone else claimed it, delete the Worker (or the Docker volume) and deploy again: nothing of yours was in it yet.
- The Resend key from the setup screen (or the Settings tab) is stored in the room's database, readable only by the app, never shown again in the page. A key set as a deployment secret takes priority.

## Outgoing requests

The server makes two kinds of outgoing request: sending email (Resend, SES or SMTP), and once a day an anonymous request to GitHub's public list of Openroom releases, to tell admins about updates. Nothing about the room, its documents or its people is sent. `UPDATE_CHECK=false` turns the release check off. Pages load fonts from Google Fonts; nothing else.

The **Update Openroom** workflow runs only in your own GitHub copy, only when you start it (or on a schedule you turn on). It fetches Openroom's public releases, and pushes to your copy with GitHub's own token for that run; it never sees your Cloudflare or Resend keys.

## Running it yourself with Docker

- `APP_ORIGIN` must be set and use HTTPS (the compose file puts Caddy in front for this). Sign-in links are built from it, never from the request's Host header.
- Activity records the visitor's address from the connection. Set `TRUST_PROXY=true` only when a proxy you control is the sole way in; then the address comes from its `X-Forwarded-For`. A visitor can never set the address header themselves.
- The `/data` volume holds the database (including session and sign-in token hashes) and every document. Keep it private and back it up.

## What it does not promise

Viewing in a browser can always be copied: screenshots, a browser's "save PDF", copying text. Openroom makes leaks traceable (every page is stamped with the viewer's email and the date, and every view is logged); it cannot make them impossible.
