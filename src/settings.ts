import type { Env } from "./env";
import { adminEmails } from "./util";

/**
 * Room settings kept in the database (the `settings` table, one JSON value per key), so a
 * founder can set the room up in the app instead of in Cloudflare or a config file.
 */

export async function getSetting<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function putSetting(env: Env, key: string, value: unknown) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
  )
    .bind(key, JSON.stringify(value), Date.now())
    .run();
}

/** Writes only if the key is not there yet. True when this call wrote it: used so a room can be claimed once. */
export async function putSettingIfAbsent(env: Env, key: string, value: unknown): Promise<boolean> {
  const r = await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING")
    .bind(key, JSON.stringify(value), Date.now())
    .run();
  return (r.meta?.changes ?? 0) === 1;
}

export async function deleteSetting(env: Env, key: string) {
  await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
}

// ---------- The room's owner ----------

/** The founder who claimed the room on the setup screen. */
export type Owner = { email: string; claimedAt: number };

/**
 * Once a room has an owner it keeps it, so a found owner is remembered for the life of the
 * Worker instance (or Node process). An unclaimed room is checked again on every request.
 */
let ownerCache: Owner | null = null;

export async function roomOwner(env: Env): Promise<Owner | null> {
  if (ownerCache) return ownerCache;
  try {
    ownerCache = await getSetting<Owner>(env, "owner");
  } catch {
    // Before migration 0005 there is no settings table, so there is no owner either.
    return null;
  }
  return ownerCache;
}

/** Admins are the ADMIN_EMAILS setting (if any) plus the owner who claimed the room. */
export async function isAdmin(env: Env, email: string): Promise<boolean> {
  const e = email.toLowerCase();
  if (adminEmails(env.ADMIN_EMAILS).has(e)) return true;
  return (await roomOwner(env))?.email === e;
}

/** A brand new room: nobody can manage it yet, so it shows the setup screen. */
export async function needsSetup(env: Env): Promise<boolean> {
  if (adminEmails(env.ADMIN_EMAILS).size > 0) return false;
  return !(await roomOwner(env));
}

// ---------- Email settings saved in the app ----------

/** Set on the setup screen or the Settings tab. ADMIN-only. Deployment settings (env) win over these. */
export type MailSettings = { resendApiKey?: string; mailFrom?: string };

export const getMailSettings = (env: Env) => getSetting<MailSettings>(env, "mail").catch(() => null);
