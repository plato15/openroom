import type { Env } from "./env";
import { getSetting, putSetting } from "./settings";
import { VERSION } from "./version";

/**
 * "A new version is available", for admins. The room asks GitHub's public release list for
 * Openroom at most once a day, from the server, and keeps the answer in the settings table.
 * Pages read the kept answer and never wait for GitHub; a stale answer is refreshed in the
 * background. Nothing about the room is sent: it is one anonymous request for public data.
 *
 * On by default in production. UPDATE_CHECK=false turns it off; UPDATE_CHECK=true turns it on
 * anywhere (for trying it locally).
 */

export const UPSTREAM = "plato15/openroom";
const DAY = 24 * 60 * 60 * 1000;

export type UpdateInfo = { latest: string; url: string; checkedAt: number };

/** Compares plain versions like 0.10.2 and 0.9.9. Pre-releases are never offered. */
export function newerThan(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export const updateCheckOn = (env: Env) => enabled(env);
const enabled = (env: Env) => (env.UPDATE_CHECK ? env.UPDATE_CHECK === "true" : env.ENVIRONMENT === "production" || !env.ENVIRONMENT);

async function refresh(env: Env): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${UPSTREAM}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "openroom-update-check" },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const r = (await res.json()) as { tag_name?: unknown; html_url?: unknown; prerelease?: unknown; draft?: unknown };
  const tag = typeof r.tag_name === "string" ? r.tag_name.replace(/^v/, "") : "";
  if (!/^\d+\.\d+\.\d+$/.test(tag) || r.prerelease || r.draft) return;
  const url = typeof r.html_url === "string" && r.html_url.startsWith(`https://github.com/${UPSTREAM}/`) ? r.html_url : `https://github.com/${UPSTREAM}/releases`;
  await putSetting(env, "update_check", { latest: tag, url, checkedAt: Date.now() } satisfies UpdateInfo);
}

/**
 * The newer release if there is one, from the kept answer. `later` runs the refresh after the
 * response (waitUntil), so the page is never slowed down.
 */
export async function availableUpdate(env: Env, later: (p: Promise<unknown>) => void): Promise<UpdateInfo | null> {
  const kept = await getSetting<UpdateInfo>(env, "update_check").catch(() => null);
  if (enabled(env) && (!kept || Date.now() - kept.checkedAt > DAY)) {
    // Mark the attempt first, so a GitHub outage means one try a day, not one per page.
    later(
      putSetting(env, "update_check", { latest: kept?.latest ?? VERSION, url: kept?.url ?? "", checkedAt: Date.now() })
        .then(() => refresh(env))
        .catch((err) => console.error(`update check failed: ${(err as Error).message}`)),
    );
  }
  return kept && newerThan(kept.latest, VERSION) ? kept : null;
}
