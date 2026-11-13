#!/usr/bin/env bash
# Brings this copy of Openroom up to a newer release. Run by the "Update Openroom" workflow
# (Actions tab), or by hand: bash scripts/update-openroom.sh [latest|v1.2.3]
# It only ever adds one commit; push it and Cloudflare redeploys. Nothing is pushed here.
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/plato15/openroom.git}"
WANT="${1:-latest}"
say() { echo "$*"; }
fail() { echo "::error::$*" >&2; echo "Not updated: $*" >&2; exit 1; }

[[ "$WANT" == latest || "$WANT" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'$WANT' is not a version. Use latest, or a version like v0.4.0."
[ -z "$(git status --porcelain)" ] || fail "there are uncommitted changes here. Commit or discard them first."

git remote get-url upstream >/dev/null 2>&1 && git remote set-url upstream "$UPSTREAM_URL" || git remote add upstream "$UPSTREAM_URL"
git fetch --quiet --tags --force upstream

if [ "$WANT" = latest ]; then
  TAG="$(git ls-remote --tags --refs upstream 'v*' | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
  [ -n "$TAG" ] || fail "no Openroom release found."
else
  TAG="v${WANT#v}"
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || fail "Openroom $TAG does not exist."
fi
NEW="${TAG#v}"
CURRENT="$(node -p "require('./package.json').version")"
if [ "$(printf '%s\n%s\n' "$CURRENT" "$NEW" | sort -V | tail -1)" = "$CURRENT" ]; then
  say "Already on Openroom $CURRENT (newest release: $NEW). Nothing to do."
  exit 0
fi
say "Updating Openroom $CURRENT -> $NEW"

# GitHub never lets an automation change automation files, so a release that changes them is
# applied by hand once (README, "Updating").
if ! git diff --quiet HEAD "$TAG" -- .github/workflows; then
  fail "Openroom $NEW changes the files in .github/workflows, which GitHub only lets you update yourself. See 'Updating' in README.md."
fi

OLD_CFG="$(mktemp)"
cp wrangler.jsonc "$OLD_CFG"

if git merge-base HEAD "$TAG" >/dev/null 2>&1; then
  # A fork, or a copy updated before: a normal merge.
  if ! git merge --no-edit -m "Update Openroom to $NEW" "$TAG" >/dev/null 2>&1; then
    conflicts="$(git diff --name-only --diff-filter=U)"
    if [ "$conflicts" = "wrangler.jsonc" ]; then
      git show "$TAG:wrangler.jsonc" > wrangler.jsonc
      node scripts/keep-room-config.mjs "$OLD_CFG" wrangler.jsonc
      git add wrangler.jsonc
      git commit --no-edit -q
    else
      git merge --abort
      fail "these files were changed both here and in Openroom $NEW: $(echo $conflicts). Nothing was changed. Update them by hand, or ask for help in Openroom's GitHub issues."
    fi
  fi
else
  # A copy made by the Deploy button: no shared history with Openroom. Take Openroom's files,
  # keep this room's own Worker name, database, bucket and domains. From now on the histories
  # are linked, so later updates are normal merges.
  git merge --allow-unrelated-histories --no-commit -s ours "$TAG" >/dev/null 2>&1
  git read-tree -u --reset "$TAG"
  node scripts/keep-room-config.mjs "$OLD_CFG" wrangler.jsonc
  git add -A
  git commit -q -m "Update Openroom to $NEW"
fi
rm -f "$OLD_CFG"
say "Done: Openroom $NEW. Push this commit and Cloudflare redeploys; database changes apply by themselves."
