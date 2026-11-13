# Notes for AI agents

You are probably here for one of two jobs: **set up a room for someone**, or **change the code**. Both are below. Human-facing detail is in [README.md](README.md); the full list of settings is its "All settings" table.

## Setting up a room

Ask the person which they want, then follow one path. Do not invent settings that are not in the README.

**Cloudflare (default choice).** Nothing is filled in at deploy time. After the first deploy, the person opens the room's address and a setup screen asks for their email and a Resend API key, sends them a 6-digit code, and makes them the owner; then name, colours and logo. If they can click: send them to the Deploy to Cloudflare button in the README and tell them to open the address right away. If you have a shell and they have run `npx wrangler login`:

```bash
git clone https://github.com/plato15/openroom.git && cd openroom
npm install
npm run deploy   # deploys (creating D1 + R2 the first time), then applies migrations
```

Then they open the printed address and follow the setup screen themselves (you must not type their Resend key for them). To skip the claim step, set `ADMIN_EMAILS` before the first visit (`npx wrangler secret put ADMIN_EMAILS`).

- Node 22.12+ is required (`node -v`). On a Mac with Homebrew, a newer Node may be installed but not first on PATH.
- If the Deploy button fails ("could not create the Git repository", "authorization has expired", "unknown error", timeout), use the fork route in the README ("If the button does not work"): fork, Cloudflare **Create → Continue with GitHub**, deploy command `npm run deploy`, preview builds off, then open the address for the setup screen. Do not uninstall the Cloudflare GitHub app on an account that other projects build from.
- Migrations must run **after** `wrangler deploy` on a fresh setup: the database does not exist until the first deploy provisions it. `npm run deploy` already does it in that order.

- Leave `APP_ORIGIN` unset unless they add a custom domain; then add it in the dashboard as `https://<domain>`.
- In the Deploy button form, the Git account should be their personal GitHub account; "could not create the Git repository" means the name is taken or the organisation blocks Cloudflare.
- The sender defaults to `onboarding@resend.dev`, which only delivers to the Resend account owner. To email investors they must verify a domain in Resend, then set the sender in the room under **Settings → Email** (or a `MAIL_FROM` variable in the Cloudflare dashboard, which wins). `keep_vars` is on, so dashboard settings survive deploys. Do not add a `vars` block to `wrangler.jsonc`: every var there becomes a required field in the Deploy button form.
- Done when: the setup screen has been completed and the owner lands on the Documents page. Until then, anyone who opens the address can claim the room, so the owner should do it right after deploying.

**Docker (they have a server).**

```bash
git clone https://github.com/plato15/openroom.git && cd openroom
cp .env.example .env    # set DOMAIN; everything else is optional
docker compose up -d
docker compose logs openroom   # expect "Openroom is running on port 3000"
```

Then they open `https://<DOMAIN>` for the setup screen.

- The domain's DNS must point at the server and ports 80/443 must be open, or Caddy cannot get a certificate.
- Data lives in the `openroom-data` volume. Tell them to back it up.

**Never** put secrets in `wrangler.jsonc`, a committed file, a URL or a chat log. Use `wrangler secret put` or `.env` (git-ignored).

## Changing the code

```bash
npm install
npm run typecheck   # must be clean
npm test            # runs the suite on the Worker AND on the Node build; both must pass
npm run dev         # http://localhost:8799 (copy .dev.vars.example to .dev.vars first)
```

Rules that matter more than anything else (the full list is in [CONTRIBUTING.md](CONTRIBUTING.md)):

1. **Access is decided in one place:** `fileForInvestor` and `visibleToInvestor` in `src/access.ts`. Every route that serves a document to an investor goes through it. Never add a second path to a file. Subfolders reach access through their top folder (`COALESCE(f.parent_id, f.id)` in every grant join), and placeholders (`files.placeholder = 1`) are never served.
2. **Unknown or forbidden means 404**, never 403, so ids cannot be probed.
3. **Both builds run the same `src/`.** Only `src/node/` is Node-specific. Do not use Cloudflare-only or Node-only APIs elsewhere; if you must, add an adapter in `src/node/` and a test in `test/node.test.ts`.
4. **Database changes are new files** in `migrations/` (`0006_*.sql`, ...). Never edit an existing migration. They must run on both D1 and SQLite.
5. **Setup claims a room once.** `src/routes/setup.ts` only runs while the room has no admin (`needsSetup`), the owner row is written with insert-if-absent, and codes are limited (5 wrong tries, 5 sends an hour). Keep those limits.
6. **Escape everything user-supplied.** Pages use `hono/html` templates (auto-escaped); emails use `esc()` in `src/email.ts`. Branding values are validated in `src/brand.ts`.
7. **New behaviour needs a test** in `test/room.test.ts` (it runs on both builds).
8. Copy uses plain words, no em dashes.

Where things live: see the "Code map" table in the README.
