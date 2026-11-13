# Openroom

**An open-source investor data room you host yourself, on Cloudflare in one click or on your own server with Docker.** Share diligence documents folder by folder, see who opened what, and stamp every page with the viewer's email. No passwords, no per-seat pricing, no documents on someone else's servers.

Built for a real seed fundraise, then opened up.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/plato15/openroom)

<p>
  <img src="docs/investor-room.jpg" alt="The investor's room: folders with documents, on desktop" width="62%">
  <img src="docs/investor-phone.jpg" alt="The same room on a phone" width="24%">
</p>

## What it does

**For investors**
- Sign in with a one-time email link. Nothing to install, no password to forget.
- See only the folders you shared with them, on a clean page that works on a phone.
- Read documents in the browser. PDFs show slides wide and documents tall; Excel, CSV and Word files open as read-only pages.

**For you (the admin)**
- Folders, uploads, and per-investor access you tick folder by folder.
- **Download** switch on every file, off by default: investors view only unless you allow it.
- **Stamping**: every PDF page, spreadsheet and Word page carries the viewer's email and the date.
- **Activity**: every sign-in, view and download, per investor and per file.
- **Preview** the room exactly as a given investor sees it, without signing out.
- Optional **custom link** per file (`/d/pitch-deck`), and **replace with a new version** that keeps the link, access and history.
- End dates per investor, instant revoke, invites by email.
- Files named "draft" or "internal" upload hidden and cannot be published until renamed.
- **Branding** tab: your name, colours, fonts and logos, changed in the app with no redeploy.

<p><img src="docs/admin-documents.jpg" alt="Admin: folders, files, download switches and visibility" width="88%"></p>

## How it is built

One Cloudflare Worker ([Hono](https://hono.dev)), one D1 database, one **private** R2 bucket. Pages are rendered on the server: no front-end framework, fast on slow networks. PDFs are stamped with [pdf-lib](https://pdf-lib.js.org), spreadsheets read with [SheetJS](https://sheetjs.com), Word files with [mammoth](https://github.com/mwilliamson/mammoth.js). Email goes through [Resend](https://resend.com), Amazon SES, or (with Docker) any SMTP server.

The same code also runs on Node for people who prefer their own server: the Docker image swaps D1 for a SQLite file and R2 for a folder or any S3-compatible bucket, and the whole test suite runs against both, so the access rules cannot drift apart.

**Security model.** Every request is checked on the server: a file is served only to a signed-in investor who is not revoked, not past their end date and has access to its folder, and only if the file is Visible. Anything else is a 404. Ids and tokens are random (128 to 256 bits) and only their hashes are stored. Sign-in links work once, last 15 minutes and are used up by a button press, so email scanners cannot burn them. See [SECURITY.md](SECURITY.md), including what a browser-based room can and cannot prevent.

## Deploy to Cloudflare (recommended)

About five minutes, no command line.

1. Make a free account at [resend.com](https://resend.com) and create an **API key**. This sends the sign-in emails.
2. Click **Deploy to Cloudflare** above and sign in to Cloudflare (a free account works).
3. Fill in the form:
   - **ADMIN_EMAILS**: your email. Add more, separated by commas, for anyone else who manages the room.
   - **RESEND_API_KEY**: the key from step 1.
   - **APP_ORIGIN**: leave it empty. The room uses the free `https://openroom.<your-name>.workers.dev` address Cloudflare gives it.
   - **MAIL_FROM**: leave it as it is for now (see "Email" below before inviting investors).
4. Click **Create and deploy**. Cloudflare copies Openroom to your GitHub account, creates the database and the private file bucket, sets up the tables and puts the room online.
5. Open the address it shows, enter your email, and click the link in your inbox. Then go to **Branding** to add your name, logo and colours.

From then on, every push to your copy on GitHub redeploys the room and applies any new database changes.

**Email.** Until you verify a domain, Resend only delivers to the email you signed up with, which is enough to sign in as admin. To email investors, add your domain in Resend (**Domains**, then the DNS records it shows), then set `MAIL_FROM` to an address on it, like `Data Room <rooms@acme.com>`, in the Cloudflare dashboard under **Workers & Pages → openroom → Settings → Variables and Secrets**. Prefer Amazon SES? Add the secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (an IAM user allowed only `ses:SendEmail`), set `SES_REGION`, and leave `RESEND_API_KEY` empty.

**Your own domain (optional).** In the dashboard, **Workers & Pages → openroom → Settings → Domains & Routes → Add → Custom domain**, enter for example `dataroom.acme.com` (the domain must be on your Cloudflare account), then set the variable `APP_ORIGIN` to `https://dataroom.acme.com`. Sign-in links then always use that address.

**Plan.** The free Workers plan runs the room. Stamping a long PDF can use more CPU time than the free plan allows per request, so for a real fundraise use **Workers Paid** ($5 a month).

**Recommended:** a Cloudflare rate-limiting rule on `POST /login`, and a Cloudflare Access policy on `/admin*` limited to your own email as a second lock.

<details>
<summary>Deploying from the command line instead</summary>

You need Node 22.12 or newer.

```bash
git clone https://github.com/plato15/openroom.git && cd openroom
npm install
npx wrangler login
npx wrangler secret put ADMIN_EMAILS
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy      # first time: creates the database and bucket
npm run deploy           # applies database changes, then deploys
```

Use `npm run deploy` for every later update.
</details>

## Run with Docker

For your own server (a VPS, a home server, anything with Docker). The image is the same app on Node, with the database in a SQLite file and documents in a folder (or any S3-compatible bucket).

1. Point a domain, for example `dataroom.acme.com`, at your server.
2. Get the files and fill in the settings:
   ```bash
   git clone https://github.com/plato15/openroom.git && cd openroom
   cp .env.example .env
   ```
   In `.env` set `DOMAIN`, `ADMIN_EMAILS`, `MAIL_FROM`, and one email option: `RESEND_API_KEY`, `SMTP_URL` (any mail server, like `smtp://user:password@smtp.example.com:587`) or the SES keys.
3. Start it:
   ```bash
   docker compose up -d
   ```

[Caddy](https://caddyserver.com) gets an HTTPS certificate for your domain by itself; sign-in cookies need HTTPS. Database and files are kept in the `openroom-data` volume: back it up. To update, run `docker compose pull && docker compose up -d`; database changes apply on start.

Already have a proxy? Run the image on its own and send traffic to port 3000:

```bash
docker run -d -p 3000:3000 -v openroom-data:/data \
  -e APP_ORIGIN=https://dataroom.acme.com -e ADMIN_EMAILS=you@acme.com \
  -e MAIL_FROM="Data Room <rooms@acme.com>" -e RESEND_API_KEY=re_... \
  ghcr.io/plato15/openroom
```

Set `TRUST_PROXY=true` only when your proxy is the sole way in, so visitor addresses in Activity come from it. To keep files in S3, R2, B2 or MinIO, set `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.

## Make it yours

Admins change the look on the **Branding** tab: company name, legal name, who invites, main and header colours, fonts (any [Google Font](https://fonts.google.com)), and three logos (header, email, browser tab). It takes effect straight away, with no redeploy. Logos are PNG, JPEG, WebP or SVG up to 512 KB; email logos must be PNG or JPEG, since email apps do not show SVG.

The defaults, used for anything left blank on the Branding tab, come from these settings (`wrangler.jsonc` → `vars`, or environment variables for Docker):

| Setting | What it changes |
|---|---|
| `BRAND_NAME` | "Acme" → "Acme data room" in titles, pages and emails |
| `BRAND_LEGAL_NAME` | Footer and email small print ("Acme Inc.") |
| `BRAND_INVITER` | Who the invite email says it is from ("Ada at Acme") |
| `BRAND_COLOR`, `BRAND_DARK` | Buttons and links; header and table heads (hex, like `#2563EB`) |
| `BRAND_FONT_BODY`, `BRAND_FONT_DISPLAY` | Any Google Font name |
| `SHOW_CREDIT` | `"false"` hides the small "Powered by Openroom" line |

## What opens in the browser

| File | Investors see |
|---|---|
| PDF | Native viewer, stamped; wide frame for slides, tall for documents |
| Excel (.xlsx, .xls), CSV | Read-only table with sheet tabs, stamped (values, not formulas or charts) |
| Word (.docx) | Read-only page, stamped |
| Images | As is |
| PowerPoint, old .doc, anything else | Download only. Upload a PDF export to show it in the browser. |

## Local development

```bash
cp .dev.vars.example .dev.vars    # set ADMIN_EMAILS to any email
npm run db:migrate:local
npm run dev                       # http://localhost:8799
```

The Node build runs locally too:

```bash
npm run build:node
DATA_DIR=./data APP_ORIGIN=http://localhost:3000 ADMIN_EMAILS=you@example.com ENVIRONMENT=local npm run start:node
```

On a local address no email is sent: the sign-in link appears on the "Check your email" page.

## Tests

```bash
npm test
```

The suite runs twice: once in the real Workers runtime (Miniflare) and once against the Node build used by Docker. It covers the access rules: uninvited, revoked and expired emails; single-use and expired links; folder grants; hidden files; per-file downloads; stamping; custom links; replacing files; admin-only routes; cross-site posts; HTML escaping; branding input checks and logo handling. Node-only tests cover the SQLite and file adapters.

## Code map

| File | What it does |
|---|---|
| `src/access.ts` | The one visibility rule, and file serving (stamping, headers, rendered pages) |
| `src/auth.ts` | Sign-in links, sessions, same-origin check |
| `src/brand.ts` | Branding: saved settings over BRAND_* defaults, theme, logo checks |
| `src/routes/public.ts` | Sign-in pages |
| `src/routes/investor.ts` | Investor room and document viewer |
| `src/routes/preview.ts` | Admin Preview (the room as an investor sees it) |
| `src/routes/admin.ts` | Documents, Investors, Activity |
| `src/routes/branding.ts` | The Branding tab |
| `src/render.ts` | Excel, CSV and Word as read-only pages |
| `src/watermark.ts` | PDF stamping |
| `src/email.ts` | Resend, SES and SMTP sending, and the two emails |
| `src/node/` | The Node build: SQLite and file adapters, server |
| `migrations/` | Database schema (D1 and SQLite) |

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck` and `npm test` before opening a pull request, and keep the security rule in one place (`src/access.ts`). Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE).
