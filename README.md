# Openroom

**An open-source investor data room you host yourself, on Cloudflare in one click or on your own server with Docker.** Share diligence documents folder by folder, see who opened what, and stamp every page with the viewer's email. No passwords, no per-seat pricing, no documents on someone else's servers.

Built for a real seed fundraise, then opened up.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/plato15/openroom)

<p>
  <img src="docs/investor-room.jpg" alt="The investor's room: folders with documents, on desktop" width="62%">
  <img src="docs/investor-phone.jpg" alt="The same room on a phone" width="24%">
</p>

**Which way should I set it up?**

| You have | Use | Time | Cost |
|---|---|---|---|
| Nothing yet, or a Cloudflare account | [Deploy to Cloudflare](#deploy-to-cloudflare-recommended) | 5 minutes, no command line | Free to try; $5 a month for heavy PDF stamping |
| Your own server with Docker | [Run with Docker](#run-with-docker) | 15 minutes | Your server |

Using an AI coding agent to set it up? Point it at [AGENTS.md](AGENTS.md).

## What it does

**For investors**
- Sign in with a one-time email link. Nothing to install, no password to forget.
- See only the folders you shared with them, on a clean page that works on a phone.
- Read documents in the browser. PDFs show slides wide and documents tall; Excel, CSV and Word files open as read-only pages.

**For you (the admin)**
- Folders with one level of subfolders, uploads, and per-investor access you tick folder by folder (a folder's subfolders come with it).
- **Download** switch on every file, off by default: investors view only unless you allow it.
- **Stamping**: every PDF page, spreadsheet and Word page carries the viewer's email and the date.
- **Activity**: every sign-in, view and download, per investor and per file.
- **Preview** the room exactly as a given investor sees it, without signing out.
- **Short links** for any file or folder, like `dataroom.acme.com/deck` or `dataroom.acme.com/legal`, with a **Copy link** button. Someone who is not signed in signs in first and lands right on it. A link is only a nicer address: access is checked on every open, and a link to something you cannot see looks exactly like one that does not exist. Names the room uses itself (`admin`, `room`, `setup`...) cannot be links.
- **Replace with a new version** that keeps the link, access and history.
- End dates per investor, instant revoke, invites by email.
- Files named "draft" or "internal" upload hidden and cannot be published until renamed.
- **Setup screen** the first time the room opens: your email, what the room is for, then your name, colours and logo. Nothing to configure while deploying.
- **Templates** that set up the folders for you: Investor data room, Selling the company, Board portal, Client or partner portal (or start empty). Each section has **subfolders** with a hidden placeholder page in each, like "Pitch deck"; click **Upload your version** on each one and it becomes visible.
- **Settings** tab: name, colours, fonts, logos and email sender, changed in the app with no redeploy.

<p><img src="docs/admin-documents.jpg" alt="Admin: folders, files, download switches and visibility" width="88%"></p>

## How it is built

One Cloudflare Worker ([Hono](https://hono.dev)), one D1 database, one **private** R2 bucket. Pages are rendered on the server: no front-end framework, fast on slow networks. PDFs are stamped with [pdf-lib](https://pdf-lib.js.org), spreadsheets read with [SheetJS](https://sheetjs.com), Word files with [mammoth](https://github.com/mwilliamson/mammoth.js). Email goes through [Resend](https://resend.com), Amazon SES, or (with Docker) any SMTP server.

The same code also runs on Node for people who prefer their own server: the Docker image swaps D1 for a SQLite file and R2 for a folder or any S3-compatible bucket, and the whole test suite runs against both, so the access rules cannot drift apart.

**Security model.** Every request is checked on the server: a file is served only to a signed-in investor who is not revoked, not past their end date and has access to its folder, and only if the file is Visible. Anything else is a 404. Ids and tokens are random (128 to 256 bits) and only their hashes are stored. Sign-in links work once, last 15 minutes and are used up by a button press, so email scanners cannot burn them. See [SECURITY.md](SECURITY.md), including what a browser-based room can and cannot prevent.

## Deploy to Cloudflare (recommended)

About five minutes, no command line, nothing to fill in while deploying.

You need a free [GitHub](https://github.com) account and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account.

1. Click **Deploy to Cloudflare** above and sign in to Cloudflare.
2. **Git account:** choose your GitHub account (the black cat icon). Cloudflare makes your own private copy of Openroom there; that is how your room gets updates later.
3. Leave everything else as it is and click **Deploy**. Cloudflare creates the database and the private file bucket and puts the room online.
4. Open the `https://openroom.<your-name>.workers.dev` address it shows. **The setup screen takes it from there:**
   - **Your email and a Resend key.** Resend sends the sign-in emails; it is free at [resend.com](https://resend.com/signup). Sign up with the same email, open **API Keys**, create a key and paste it in.
   - **A 6-digit code** sent to your email. Typing it makes you the room's owner. Nobody else can claim the room after that.
   - **Your company name, colours and logo.**
5. You land in your room. Add a folder, upload documents, invite an investor.

Do step 4 straight after deploying: until someone has claimed the room, the first person to open its address gets the setup screen. If the setup screen ever greets you on a room you did not just deploy, close it.

Something went red in the Cloudflare form? See [If the button does not work](#if-the-button-does-not-work) just below: there is a route that always works.

From then on, every push to your copy on GitHub redeploys the room and applies any new database changes.

### If the button does not work

The button has to create a new repository in your GitHub account, and that step fails when Cloudflare's GitHub connection on your account is old or tangled (common if your Cloudflare account already deploys other projects). You will see one of these in the form:

- "Cloudflare could not create the Git repository right now"
- "Your GitHub authorization has expired"
- "An unknown error has occurred", or "Request timed out"
- "A repository with that name already exists"

Also check the **Git account** list: entries with an orange fox icon are **GitLab** groups, not GitHub. Pick a GitHub account (the black cat icon).

If it still fails, copy Openroom yourself and point Cloudflare at the copy. About five minutes, still no command line:

1. **Copy it.** On [github.com/plato15/openroom](https://github.com/plato15/openroom), click **Fork**, pick your account and click **Create fork**.
2. **Connect it.** In the Cloudflare dashboard: **Workers & Pages → Create → Continue with GitHub**, pick your account and the `openroom` repository, then **Next**.
3. **Settings on that page:**
   - **Project name:** `openroom` (or anything).
   - **Build command:** leave empty.
   - **Deploy command:** `npm run deploy`
   - **Enable Preview builds:** off.
4. Click **Deploy**. The build log shows the database and file bucket being created and ends with your `https://openroom.<your-name>.workers.dev` address.
5. Open that address: the setup screen takes it from there (step 4 above).

To get new Openroom versions later, click **Sync fork** on your copy in GitHub; Cloudflare redeploys by itself.

**Email.** Until you verify a domain, Resend only delivers to the email you signed up with, which is enough to set up and sign in as owner. To email investors, add your domain in Resend (**Domains**, then the DNS records it shows), then in your room open **Settings → Email** and set the sender to an address on it, like `Data Room <rooms@acme.com>`. Prefer Amazon SES? Add the Cloudflare secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (an IAM user allowed only `ses:SendEmail`) and the variables `SES_REGION` and `MAIL_FROM`.

**Your own domain (optional).** In the Cloudflare dashboard, **Workers & Pages → openroom → Settings → Domains & Routes → Add → Custom domain**, enter for example `dataroom.acme.com` (the domain must be on your Cloudflare account), then under **Settings → Variables and Secrets** add the variable `APP_ORIGIN` with `https://dataroom.acme.com`. Sign-in links then always use that address. Variables added there stay through every later update.

**Plan.** The free Workers plan runs the room. Stamping a long PDF can use more CPU time than the free plan allows per request, so for a real fundraise use **Workers Paid** ($5 a month).

**Recommended:** a Cloudflare rate-limiting rule on `POST /login`, and a Cloudflare Access policy on `/admin*` limited to your own email as a second lock.

<details>
<summary>Deploying from the command line instead</summary>

You need Node 22.12 or newer: check with `node -v`. Wrangler stops with "Wrangler requires at least Node.js v22.12.0" on older versions; install a newer Node from [nodejs.org](https://nodejs.org) first.

```bash
git clone https://github.com/plato15/openroom.git && cd openroom
npm install
npx wrangler login
npm run deploy      # creates the database and bucket, deploys, sets up the tables
```

If it asks whether to create a database or bucket, or which account to use, accept the defaults. Then open the address it prints and follow the setup screen. Use `npm run deploy` again for every later update.
</details>

## Run with Docker

For your own server (a VPS, a home server, anything with Docker). The image is the same app on Node, with the database in a SQLite file and documents in a folder (or any S3-compatible bucket).

1. Point a domain, for example `dataroom.acme.com`, at your server.
2. Get the files and set your domain:
   ```bash
   git clone https://github.com/plato15/openroom.git && cd openroom
   cp .env.example .env
   ```
   In `.env`, set `DOMAIN`. Nothing else is needed; the rest is optional.
3. Start it:
   ```bash
   docker compose up -d
   ```
4. Open `https://<your domain>` and follow the setup screen (your email, a Resend key, your name, colours and logo).

[Caddy](https://caddyserver.com) gets an HTTPS certificate for your domain by itself; sign-in cookies need HTTPS. Database and files are kept in the `openroom-data` volume: back it up. To update, run `docker compose pull && docker compose up -d`; database changes apply on start.

Prefer your own mail server? Set `SMTP_URL` in `.env` (like `smtp://user:password@smtp.example.com:587`) and `MAIL_FROM`; settings in `.env` win over the setup screen.

Already have a proxy? Run the image on its own and send traffic to port 3000:

```bash
docker run -d -p 3000:3000 -v openroom-data:/data -e APP_ORIGIN=https://dataroom.acme.com ghcr.io/plato15/openroom
```

Set `TRUST_PROXY=true` only when your proxy is the sole way in, so visitor addresses in Activity come from it. To keep files in S3, R2, B2 or MinIO, set `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.

## Make it yours

The setup screen asks for the basics (name, colours, logo). Afterwards admins change everything on the **Settings** tab: company name, legal name, who invites, main and header colours, fonts (any [Google Font](https://fonts.google.com)), and three logos (header, email, browser tab). It takes effect straight away, with no redeploy. Logos are PNG, JPEG, WebP or SVG up to 512 KB; email logos must be PNG or JPEG, since email apps do not show SVG.

You do not need any of the settings below. If you would rather set the defaults outside the app (used for anything left blank on the Settings tab), add them as variables in the Cloudflare dashboard, or as environment variables for Docker:

| Setting | What it changes |
|---|---|
| `BRAND_NAME` | "Acme" → "Acme data room" in titles, pages and emails |
| `BRAND_LEGAL_NAME` | Footer and email small print ("Acme Inc.") |
| `BRAND_INVITER` | Who the invite email says it is from ("Ada at Acme") |
| `BRAND_COLOR`, `BRAND_DARK` | Buttons and links; header and table heads (hex, like `#2563EB`) |
| `BRAND_FONT_BODY`, `BRAND_FONT_DISPLAY` | Any Google Font name |
| `SHOW_CREDIT` | `"false"` hides the small "Powered by Openroom" line |

## All settings

Every setting, in one place. **None of them are needed:** the setup screen asks for your email and Resend key, and everything else has a default. Use these only to set things outside the app; a setting here wins over what the setup screen saved. On Cloudflare, add them in the dashboard (**Workers & Pages → openroom → Settings → Variables and Secrets**; they stay through updates) or with `npx wrangler secret put NAME`. With Docker, everything is an environment variable (`.env`).

| Setting | Needed? | Where | What it is |
|---|---|---|---|
| `ADMIN_EMAILS` | No | Both (secret) | Extra people who manage the room, comma separated, on top of the owner from the setup screen. Set it before the first visit to skip the setup screen's claim step. |
| `APP_ORIGIN` | Docker without compose: yes. Cloudflare: only with a custom domain | Both | The room's address, like `https://dataroom.acme.com`. No path, no trailing slash. |
| `MAIL_FROM` | No | Both | Sender of sign-in emails, like `Data Room <rooms@acme.com>`. Must be allowed by your email provider. Default `Data Room <onboarding@resend.dev>`, which only reaches the Resend account owner. |
| `RESEND_API_KEY` | No | Both (secret) | A [Resend](https://resend.com) API key, instead of the one saved on the setup screen. |
| `SMTP_URL` | No | Docker only | `smtp://user:password@host:587` or `smtps://user:password@host:465`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | No | Both (secret) | Amazon SES keys (an IAM user allowed only `ses:SendEmail`). |
| `SES_REGION` | With SES | Both | Region where the SES sender is verified. Default `us-east-1`. |
| `MAIL_PROVIDER` | No | Both | Force `resend`, `smtp` or `ses`. Otherwise the first one with its keys set is used, in that order. |
| `BRAND_NAME`, `BRAND_LEGAL_NAME`, `BRAND_INVITER`, `BRAND_COLOR`, `BRAND_DARK`, `BRAND_FONT_BODY`, `BRAND_FONT_DISPLAY` | No | Both | Default branding (see [Make it yours](#make-it-yours)). The Settings tab overrides them. |
| `SHOW_CREDIT` | No | Both | `"false"` hides "Powered by Openroom". |
| `ENVIRONMENT` | No | Both | `production` (default). `local` only for development: on a local address it shows sign-in links on the page instead of emailing them. |
| `DOMAIN` | Yes, with Docker compose | Docker (`docker-compose.yml`) | Your domain without `https://`. Compose builds `APP_ORIGIN` from it. |
| `DATA_DIR` | No | Docker only | Where the database and files are kept. Default `/data` (the `openroom-data` volume). |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | No | Docker only | Keep files in an S3-compatible bucket instead of `DATA_DIR`. All five, or none. |
| `TRUST_PROXY` | No | Docker only | `true` when a proxy you control is the only way in (compose sets it). |
| `PORT` | No | Docker only | Port inside the container. Default `3000`. |

## Updating

- **Cloudflare (button or fork):** your copy on GitHub is yours. To get new Openroom versions, open it on GitHub and click **Sync fork** (or merge from `plato15/openroom`). Cloudflare redeploys and applies database changes by itself.
- **Cloudflare (command line):** `git pull && npm install && npm run deploy`.
- **Docker:** `docker compose pull && docker compose up -d`. Database changes apply when the container starts.

Read [CHANGELOG.md](CHANGELOG.md) first: anything you need to do by hand is listed there.

## Backups

- **Cloudflare:** D1 keeps 30 days of history you can restore with [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) (`npx wrangler d1 time-travel restore DB --timestamp=...`). R2 has no automatic backup; copy the bucket with `rclone` or a second bucket if you need one.
- **Docker:** back up the `openroom-data` volume (or `DATA_DIR`). It holds the database (`openroom.db`) and every document (`files/`). For a consistent copy, stop the container first or use `sqlite3 openroom.db ".backup backup.db"`.

## Troubleshooting

| Problem | What to check |
|---|---|
| The sign-in email never arrives | Check spam. With Resend's `onboarding@resend.dev` sender, mail only reaches the email you signed up to Resend with: verify your domain and change `MAIL_FROM`. Then look at the logs (Cloudflare: **Workers → openroom → Logs**; Docker: `docker compose logs openroom`) for a line starting `mail not sent`. |
| "Check your email" shows but no link arrives | You must be the owner from the setup screen, or in `ADMIN_EMAILS` exactly (comma separated, no quotes). Investors must be added on the Investors tab first; anyone else gets the same page but no email, on purpose. |
| `Forbidden` after submitting a form | `APP_ORIGIN` does not match the address in your browser. Fix it, or on Cloudflare leave it empty. |
| Docker: "Openroom cannot start" | The line after it says which setting is missing or wrong. |
| Docker: Caddy cannot get a certificate | The domain's DNS must point at the server, and ports 80 and 443 must be open. |
| Cloudflare: a big PDF does not open (error 1102 or "exceeded CPU") | You are on the free Workers plan. Move to Workers Paid ($5 a month). |
| A Settings change does not show | Reload the page. Other Cloudflare locations pick it up within 10 seconds. |
| Deploy button: "could not create the Git repository", "authorization has expired", "unknown error" or "Request timed out" | Cloudflare's GitHub connection on your account. Use [the fork route](#if-the-button-does-not-work). |
| Cloudflare build log: the first build fails at the database migrations step | The deploy command tried to set up the tables before the first deploy had created the database. Use `npm run deploy` as the deploy command (it deploys first), and run the build again. |
| Setup screen: "Resend did not accept that email" | Check the key, and use the email you signed up to Resend with: Resend's test sender only reaches that one until you verify a domain. |
| The setup screen shows on a room I did not just deploy | Someone has the address before its owner claimed it. Close it. If it is your room, claim it straight away; if someone else claimed it first, delete the Worker (or the Docker volume) and deploy again. |
| "Wrangler requires at least Node.js v22.12.0" | Your computer's Node is too old. Install Node 22 or newer from [nodejs.org](https://nodejs.org). |

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
cp .dev.vars.example .dev.vars    # optional: set ADMIN_EMAILS to skip the setup screen
npm run db:migrate:local
npm run dev                       # http://localhost:8799
```

The Node build runs locally too:

```bash
npm run build:node
DATA_DIR=./data APP_ORIGIN=http://localhost:3000 ENVIRONMENT=local npm run start:node
```

On a local address no email is sent: the setup code and sign-in links appear on the page.

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
| `src/routes/setup.ts` | First-time setup: claim the room with an emailed code, then branding |
| `src/routes/branding.ts` | The Settings tab: branding and email |
| `src/settings.ts` | Settings saved in the database: owner, email, who is admin |
| `src/templates.ts` | Room templates: folders, subfolders and placeholder pages |
| `src/links.ts`, `src/routes/shortlinks.ts` | Short links (`/deck`), reserved names, where to go after sign-in |
| `src/render.ts` | Excel, CSV and Word as read-only pages |
| `src/watermark.ts` | PDF stamping |
| `src/email.ts` | Resend, SES and SMTP sending, and the two emails |
| `src/node/` | The Node build: SQLite and file adapters, server |
| `migrations/` | Database schema (D1 and SQLite) |

## Contributing

Yes, please. Openroom is MIT licensed and contributions of any size are welcome: bug reports, ideas, docs, translations and code.

- **Found a bug or want a feature?** [Open an issue](https://github.com/plato15/openroom/issues/new/choose).
- **Want to send code?** Read [CONTRIBUTING.md](CONTRIBUTING.md): how to run it locally, the rules that keep investors' documents safe, and what a good pull request looks like.
- **Found a security problem?** Do not open an issue; report it privately as described in [SECURITY.md](SECURITY.md).

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Releases

Openroom uses [semantic versioning](https://semver.org). Every release is a tag like `v0.2.0`, a [GitHub release](https://github.com/plato15/openroom/releases) with notes from [CHANGELOG.md](CHANGELOG.md), and a Docker image `ghcr.io/plato15/openroom:0.2.0` (plus `:0.2` and `:latest`). How releases are made: [RELEASING.md](RELEASING.md).

## Licence

[MIT](LICENSE).
