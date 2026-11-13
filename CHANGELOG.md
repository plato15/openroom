# Changelog

Every change people running a room should know about. Newest first. Versions follow [semantic versioning](https://semver.org): a new major number means you have to do something by hand when updating, and it is spelled out under **Upgrading**.

## Unreleased

### Changed
- **The Investor data room template follows the standard due diligence checklist:** 1. Corporate, 2. Capitalization, 3. Financials, 4. Team, 5. Business plan, 6. Financing, 7. IP, with the usual items in each, so an investor's request list maps straight onto the folders. Sections and placeholders come with short links (`/corporate`, `/cap-table`, `/deck`, `/term-sheet` ...), kept when you upload over the placeholder. A link the room already uses is skipped. Bank and wire details are left out on purpose. Rooms that already used the old template are not changed.

## 0.4.0 (13 Nov 2026)

### Added
- **Request access.** A link on the sign-in page lets people ask for access (name, email, firm, a note). Admins are emailed and approve on the Investors page, choosing the folders, which sends the invite, or decline. The page never reveals who already has access.
- **"Openroom X is available"** for admins on the Documents and Settings pages, from a daily check of Openroom's public releases on GitHub. `UPDATE_CHECK=false` turns it off. Settings shows the current version.
- **Update Openroom**, a one-click update from the Actions tab of your copy on GitHub. Works for forks and for copies made by the Deploy button, keeps your Worker name, database, bucket and domains, and stops without changing anything if it cannot update safely. Optional weekly schedule.

### Changed
- The release workflow only runs in Openroom itself, never in a room's copy.

### Upgrading from 0.3.0
- Database change 0008 applies by itself.
- This update brings the **Update Openroom** button, so do it the old way once: **Sync fork** on a fork, `docker compose pull && docker compose up -d` with Docker, or `git pull && npm run deploy` from the command line. Copies made by the Deploy button: see README, "Updating". From 0.4.0 on, updates are one click.

## 0.3.0 (13 Nov 2026)

### Added
- **First-time setup screen.** Nothing to fill in while deploying. The first time the room is opened, the founder enters their email and a Resend key, types the 6-digit code emailed to them (which makes them the owner), picks what the room is for, then sets the company name, colours and logo with a live preview. Every step has a Back link.
- **Templates:** Investor data room, Selling the company, Board portal, Client or partner portal, or start empty. Also on the Documents page as **Start from a template**.
- **Subfolders,** one level deep. Investors get a folder's subfolders with it; empty subfolders stay out of their view.
- **Placeholders.** Template subfolders hold a hidden one-page placeholder ("Pitch deck"). **Upload your version** replaces it in place and makes it visible. Placeholders are never shown to investors.
- **Short links** for files and folders: `/deck`, `/legal`, with **Copy link**. People who are not signed in land on the link after signing in. Old `/d/...` links keep working.
- **Delete a folder with everything in it,** after an "Are you sure?" page that lists what goes.
- **Fold folders** on the Documents page to one line, with Collapse all and Expand all.
- **Settings → Email:** change the sender and Resend key in the app, for example after verifying your domain in Resend.

### Changed
- The Deploy to Cloudflare form asks nothing. `ADMIN_EMAILS` and `RESEND_API_KEY` are optional everywhere, including Docker (only `DOMAIN` is needed there).
- The Branding tab is now called **Settings**.
- `npm run deploy` deploys first and applies database changes after, so it also works on a brand new setup.
- If Resend refuses the setup email, the screen says why: a key that works but can only reach your Resend account's own email until you verify a domain, an unknown key, or an unverified sender domain.
- A room renamed without a logo shows its name in the header and emails instead of the Openroom logo.

### Fixed
- SVG logos exported by design tools (for example Adobe Illustrator) were refused as "not an image".

### Docs
- README: a route that always works when the Deploy button cannot create a repository (fork, then connect it in Cloudflare), every error message people may see with its fix, and the Node 22 requirement for the command line.

### Upgrading from 0.2.0
- Database changes (0006 and 0007) apply by themselves when Cloudflare redeploys or the Docker container starts.
- **A room without `ADMIN_EMAILS` shows the setup screen after updating, and the first person to finish it becomes the owner.** Open your room and claim it straight after updating. Rooms with `ADMIN_EMAILS` set work as before and never show it.

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
