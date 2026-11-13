// Used by scripts/update-openroom.sh. Takes Openroom's new wrangler.jsonc and puts back this
// room's own values from the old one, so an update never points the room at a new, empty
// database or bucket, or deploys it under another Worker name.
// Usage: node scripts/keep-room-config.mjs <old wrangler.jsonc> <new wrangler.jsonc>
import { readFileSync, writeFileSync } from "node:fs";

/** JSON with comments and trailing commas, as Wrangler allows. */
export function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i === -1) break;
      i++;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** The new config, with the room's own names, ids and domains from the old one. */
export function keepRoomConfig(oldCfg, newCfg) {
  const merged = structuredClone(newCfg);
  for (const key of ["name", "account_id", "routes", "route", "workers_dev"]) if (key in oldCfg) merged[key] = oldCfg[key];
  for (const db of merged.d1_databases ?? []) {
    const mine = (oldCfg.d1_databases ?? []).find((d) => d.binding === db.binding);
    if (!mine) continue;
    for (const k of ["database_name", "database_id", "preview_database_id"]) if (mine[k]) db[k] = mine[k];
  }
  for (const b of merged.r2_buckets ?? []) {
    const mine = (oldCfg.r2_buckets ?? []).find((x) => x.binding === b.binding);
    if (mine?.bucket_name) b.bucket_name = mine.bucket_name;
  }
  if (oldCfg.vars) merged.vars = { ...(newCfg.vars ?? {}), ...oldCfg.vars };
  return merged;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [oldPath, newPath] = process.argv.slice(2);
  const merged = keepRoomConfig(parseJsonc(readFileSync(oldPath, "utf8")), parseJsonc(readFileSync(newPath, "utf8")));
  writeFileSync(
    newPath,
    `// Openroom's settings for this room. Updated by "Update Openroom": your Worker name, database,\n// bucket and domains are kept from your previous version. See README.md for every setting.\n${JSON.stringify(merged, null, 2)}\n`,
  );
  console.log("Kept this room's Worker name, database, bucket and domains in wrangler.jsonc.");
}
