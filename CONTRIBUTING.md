# Contributing to Openroom

Thank you for helping. Openroom holds people's confidential documents, so the bar for safety is high, but the process is simple and first-time contributors are welcome.

## Ways to help

- **Report a bug** or **suggest a feature**: [open an issue](https://github.com/plato15/openroom/issues/new/choose). One problem per issue, with steps to see it.
- **Improve the docs**: setup steps that confused you are bugs too.
- **Send code**: for anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.
- **Security problems**: never in a public issue. See [SECURITY.md](SECURITY.md).

## Run it locally

You need Node 22.12 or newer (`.nvmrc` says which one CI uses).

```bash
git clone https://github.com/<you>/openroom.git && cd openroom
npm install
cp .dev.vars.example .dev.vars       # optional: set ADMIN_EMAILS to skip the setup screen
npm run db:migrate:local
npm run dev                          # http://localhost:8799
```

No email is sent locally: the setup code and sign-in links show on the page.

To try the Docker build: `npm run build:node`, then the command under "Local development" in the README, or `docker build -t openroom .`.

## Before you open a pull request

```bash
npm run typecheck
npm test            # the same tests on the Worker and on the Node build; both must pass
```

- Add or update a test for what you changed (`test/room.test.ts` runs on both builds; `test/node.test.ts` is for the Node adapters).
- Add a line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md) if people running a room would notice the change.
- Keep the pull request to one change, and say in its description what you tested and how.

## Rules that keep documents safe

1. **One access rule.** Whether an investor can see a file is decided only by `fileForInvestor` / `visibleToInvestor` in `src/access.ts`. Every route that serves a document goes through it. Do not add another way to reach a file.
2. **Unknown and forbidden look the same** (404), so ids and links cannot be probed.
3. **Escape everything that came from a person**: file and folder names, investor names, branding. Pages use `hono/html` templates, which escape for you; never build HTML by joining strings with user text.
4. **Same code on both builds.** Everything outside `src/node/` must run on Cloudflare Workers and on Node. If you need a platform feature, add a small adapter in `src/node/` with a test.
5. **Migrations only move forward.** Add a new numbered file in `migrations/`; never change one that has shipped. It must work on both D1 and SQLite.
6. **No new trackers, analytics or third-party scripts.** The only outside requests a page makes are for Google Fonts.

## Style

- TypeScript, strict. Small functions, and a comment when the *why* is not obvious.
- Words people see are short and plain, with no jargon and no em dashes.
- Pages are rendered on the server and must work on a phone and on a slow connection.

## Licence

By contributing you agree your work is released under the [MIT licence](LICENSE), like the rest of Openroom.
