// Prints the CHANGELOG.md section for one version, for the GitHub release notes.
// Fails if the version has no section or package.json says something else.
// Usage: node scripts/release-notes.mjs 0.2.0
import { readFileSync } from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Not a version: "${process.argv[2] ?? ""}". Expected something like 0.2.0`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync("package.json", "utf8")).version;
if (pkg !== version) {
  console.error(`The tag says ${version} but package.json says ${pkg}. Run: npm version ${version} --no-git-tag-version`);
  process.exit(1);
}
const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
const escaped = version.replace(/[.+]/g, "\\$&");
const start = lines.findIndex((l) => new RegExp(`^## \\[?${escaped}\\]?(\\s|$)`).test(l));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## ${version}" section. Rename "## Unreleased" to it first.`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
console.log(lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim());
