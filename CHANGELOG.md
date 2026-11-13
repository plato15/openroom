# Changelog

Every change people running a room should know about. Newest first. Versions follow [semantic versioning](https://semver.org): a new major number means you have to do something by hand when updating, and it is spelled out under **Upgrading**.

## Unreleased

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
