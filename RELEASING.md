# Releasing Openroom

Releases are made by a maintainer from `main`. One tag does everything: the workflow in `.github/workflows/release.yml` checks the version, runs the tests on both builds, publishes the Docker image and creates the GitHub release with the notes from `CHANGELOG.md`.

## Choosing the version

- **Patch** (`0.2.0` → `0.2.1`): fixes only. Nobody has to do anything.
- **Minor** (`0.2.1` → `0.3.0`): new features. Updating is automatic (migrations apply by themselves).
- **Major** (`0.3.0` → `1.0.0`): someone running a room has to do something by hand. Say exactly what under **Upgrading** in the changelog.

## Steps

1. Make sure `main` is green and everything going out is merged.
2. On a branch `release/vX.Y.Z`:
   - In `CHANGELOG.md`, rename `## Unreleased` to `## X.Y.Z (D Mon YYYY)` and start a new empty `## Unreleased` above it.
   - Set the version without tagging: `npm version X.Y.Z --no-git-tag-version`
   - Commit (`Release vX.Y.Z`), open a pull request, merge it.
3. Tag the merged commit on `main` and push the tag:
   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "Openroom vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. Watch the **release** workflow on GitHub. When it is green:
   - `ghcr.io/plato15/openroom:X.Y.Z`, `:X.Y` and `:latest` exist (the first time, set the package to **Public** under the repository's **Packages**);
   - the GitHub release is published with the changelog section as its notes.

The workflow stops before publishing anything if the tag does not match `package.json`, if the changelog has no `## X.Y.Z` section, or if a test fails. Fix it, delete the tag (`git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`) and tag again.

## Pre-releases

Tags like `v0.3.0-rc.1` publish an image tagged `0.3.0-rc.1` (not `latest`) and a GitHub pre-release. The changelog section is `## 0.3.0-rc.1`.
