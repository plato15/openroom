# Changelog

Every change people running a room should know about. Newest first. Versions follow [semantic versioning](https://semver.org): a new major number means you have to do something by hand when updating, and it is spelled out under **Upgrading**.

## Unreleased

### Added
- **Templates.** Setup asks what the room is for (Investor data room, Selling the company, Board portal, Client or partner portal, or empty) and creates the folders. Also on the Documents page as **Start from a template**.
- **Subfolders,** one level deep. Investors get a folder's subfolders with it. Empty subfolders stay out of the investor's view.
- **Short links** for files and folders: `/deck`, `/legal`, with Copy link. People who are not signed in land on the link after signing in. Old `/d/...` links keep working.
- **Placeholders.** Template subfolders hold a hidden one-page placeholder ("Pitch deck"). **Upload your version** replaces it in place and makes it visible. Placeholders are never shown to investors.
- **First-time setup screen.** Nothing to fill in while deploying: the first time the room is opened, the founder enters their email and a Resend key, types the 6-digit code emailed to them (which makes them the owner), then sets the company name, colours and logo. Rooms deployed with `ADMIN_EMAILS` skip it.
- **Settings → Email:** change the sender and Resend key in the app, for example after verifying your domain in Resend.
- A room renamed without a logo shows its name in the header and emails instead of the Openroom logo.

### Changed
- The Deploy to Cloudflare form asks nothing. `ADMIN_EMAILS` and `RESEND_API_KEY` are optional everywhere, including Docker.
- The Branding tab is now called Settings.

### Upgrading
- Rooms that already have `ADMIN_EMAILS` set keep working as before and never see the setup screen.

### Changed
- `npm run deploy` now deploys first and then applies database migrations, so it also works on a brand new setup (the database is created by the first deploy).

### Docs
- README: a route that always works when the Deploy button cannot create a repository (fork, then connect it in Cloudflare), with each error message people may see and its fix, and the Node 22 requirement for the command line.

## 0.2.0 (13 Nov 2026)

### Changed
- The Deploy to Cloudflare form now asks for two things only: your admin email and a Resend key. Every other setting has a default in the code and can be added later in the Cloudflare dashboard, where it stays through updates (`keep_vars`).

### Added
- **Deploy to Cloudflare** button: the database and file bucket are created for you, and the room runs on a free `*.workers.dev` address. `APP_ORIGIN` can be left empty on Cloudflare.
- **Docker** image (`ghcr.io/plato15/openroom`) and `docker-compose.yml` with automatic HTTPS (Caddy). Data in a SQLite file and a folder, or an S3-compatible bucket.
- **Branding** tab: name, legal name, inviter, colours, fonts and logos, changed in the app with no redeploy.
- Email through **Resend** (`RESEND_API_KEY`) and, with Docker, any **SMTP** server (`SMTP_URL`). SES still works.
- The test suite runs against both the Worker and the Node build.

### Changed
- `npm run deploy` applies database migrations before deploying.
- `wrangler.jsonc` no longer needs a `database_id` or a route.

### Upgrading from 0.1.0
- Run `npm run deploy` once (it applies the new migration `0005_settings.sql`).
- If you set a custom domain in `routes`, keep your `routes` and `APP_ORIGIN` lines; the new file defaults to `workers_dev: true`.
- Your `BRAND_*` settings keep working as defaults; anything set on the Branding tab wins.

## 0.1.0 (13 Nov 2026)

First public release: email sign-in links, folder-by-folder access, PDF and document stamping, per-file downloads, custom links, replace in place, admin Preview and activity log, on Cloudflare Workers with D1 and R2.
