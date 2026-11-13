# Security

Openroom holds confidential documents, so security reports are welcome and taken seriously.

**Please do not open a public issue for a vulnerability.** Report it privately through GitHub: the **Security** tab of this repository, then **Report a vulnerability**. Include the steps to reproduce and what an attacker could reach.

## What Openroom promises

- A file is served only to a signed-in investor who is not revoked, not past their end date, and has access to the file's folder, and only if the file is marked Visible. Everything else is a 404.
- Files live in a private R2 bucket (or, with Docker, a private folder or S3 bucket) and leave it only through the app after that check. The one rule lives in `src/access.ts` and the same tests check it on both builds.
- Ids and tokens are 128 or 256 random bits. Only SHA-256 hashes of sign-in tokens and session cookies are stored.
- Form posts must come from the room's own origin. Pages use a strict Content Security Policy with no inline scripts; rendered spreadsheets and Word files run with scripts switched off.

- Branding logos are the only files served without signing in (`/brand/header`, `/brand/email`, `/brand/icon`), because emails show them. Only admins can upload them. They are checked by their first bytes (PNG, JPEG, WebP or SVG, up to 512 KB), and an uploaded SVG is only ever shown inside an image tag: opened directly, it downloads under a sandbox policy instead of running as a page. Names, colours and fonts are checked against strict patterns before they reach CSS, pages or emails.

## Running it yourself with Docker

- `APP_ORIGIN` must be set and use HTTPS (the compose file puts Caddy in front for this). Sign-in links are built from it, never from the request's Host header.
- Activity records the visitor's address from the connection. Set `TRUST_PROXY=true` only when a proxy you control is the sole way in; then the address comes from its `X-Forwarded-For`. A visitor can never set the address header themselves.
- The `/data` volume holds the database (including session and sign-in token hashes) and every document. Keep it private and back it up.

## What it does not promise

Viewing in a browser can always be copied: screenshots, a browser's "save PDF", copying text. Openroom makes leaks traceable (every page is stamped with the viewer's email and the date, and every view is logged); it cannot make them impossible.
