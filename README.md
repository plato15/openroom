# Openroom

**An open-source investor data room you host yourself on Cloudflare.** Share diligence documents folder by folder, see who opened what, and stamp every page with the viewer's email. No passwords, no per-seat pricing, no documents on someone else's servers.

Built for a real seed fundraise, then opened up.

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

<p><img src="docs/admin-documents.jpg" alt="Admin: folders, files, download switches and visibility" width="88%"></p>

## How it is built

One Cloudflare Worker ([Hono](https://hono.dev)), one D1 database, one **private** R2 bucket. Pages are rendered on the server: no front-end framework, fast on slow networks. PDFs are stamped with [pdf-lib](https://pdf-lib.js.org), spreadsheets read with [SheetJS](https://sheetjs.com), Word files with [mammoth](https://github.com/mwilliamson/mammoth.js). Email goes through Amazon SES.

**Security model.** Every request is checked on the server: a file is served only to a signed-in investor who is not revoked, not past their end date and has access to its folder, and only if the file is Visible. Anything else is a 404. Ids and tokens are random (128 to 256 bits) and only their hashes are stored. Sign-in links work once, last 15 minutes and are used up by a button press, so email scanners cannot burn them. See [SECURITY.md](SECURITY.md), including what a browser-based room can and cannot prevent.

## Deploy (about 15 minutes)

You need a Cloudflare account on the **Workers Paid** plan ($5 a month; stamping a PDF takes more CPU than the free plan allows), a domain on Cloudflare, an Amazon SES sender, and Node 22.12 or newer.

```bash
git clone https://github.com/plato15/openroom.git && cd openroom
npm install
npx wrangler login
```

1. Create the database and paste the printed id into `wrangler.jsonc` (`database_id`):
   ```bash
   npx wrangler d1 create openroom
   ```
2. Create the private file bucket:
   ```bash
   npx wrangler r2 bucket create openroom-files
   ```
3. In `wrangler.jsonc`, set your address (`routes` and `APP_ORIGIN`), your sender (`MAIL_FROM`, `SES_REGION`) and your branding (next section).
4. Create the tables (run again whenever `migrations/` gets a new file):
   ```bash
   npm run db:migrate
   ```
5. Set the secrets. `ADMIN_EMAILS` is a comma-separated list of who gets the admin view. Use an IAM user allowed only `ses:SendEmail`.
   ```bash
   npx wrangler secret put ADMIN_EMAILS
   npx wrangler secret put AWS_ACCESS_KEY_ID
   npx wrangler secret put AWS_SECRET_ACCESS_KEY
   ```
6. Deploy:
   ```bash
   npm run deploy
   ```

Open your address, enter an admin email, and click the link in your inbox.

**Recommended:** a Cloudflare rate-limiting rule on `POST /login`, and a Cloudflare Access policy on `/admin*` limited to your own email as a second lock.

## Make it yours

| Setting (`wrangler.jsonc` → `vars`) | What it changes |
|---|---|
| `BRAND_NAME` | "Acme" → "Acme data room" in titles, pages and emails |
| `BRAND_LEGAL_NAME` | Footer and email small print ("Acme Inc.") |
| `BRAND_INVITER` | Who the invite email says it is from ("Ada at Acme") |
| `BRAND_COLOR`, `BRAND_DARK` | Buttons and links; header and table heads (hex, like `#2563EB`) |
| `BRAND_FONT_BODY`, `BRAND_FONT_DISPLAY` | Any [Google Font](https://fonts.google.com) name |
| `SHOW_CREDIT` | `"false"` hides the small "Powered by Openroom" line |

Replace the logo files in `public/static/`: `logo-white.svg` (shown on the dark header), `icon.svg` (browser tab) and `logo-email.png` (about 288 × 56, top of emails).

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

On a local address no email is sent: the sign-in link appears on the "Check your email" page.

## Tests

```bash
npm test
```

The suite runs the Worker in the real Workers runtime (Miniflare) and covers the access rules: uninvited, revoked and expired emails; single-use and expired links; folder grants; hidden files; per-file downloads; stamping; custom links; replacing files; admin-only routes; cross-site posts; HTML escaping.

## Code map

| File | What it does |
|---|---|
| `src/access.ts` | The one visibility rule, and file serving (stamping, headers, rendered pages) |
| `src/auth.ts` | Sign-in links, sessions, same-origin check |
| `src/brand.ts` | Branding settings and theme |
| `src/routes/public.ts` | Sign-in pages |
| `src/routes/investor.ts` | Investor room and document viewer |
| `src/routes/preview.ts` | Admin Preview (the room as an investor sees it) |
| `src/routes/admin.ts` | Documents, Investors, Activity |
| `src/render.ts` | Excel, CSV and Word as read-only pages |
| `src/watermark.ts` | PDF stamping |
| `src/email.ts` | SES sending and the two emails |
| `migrations/` | D1 schema |

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck` and `npm test` before opening a pull request, and keep the security rule in one place (`src/access.ts`). Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE).
