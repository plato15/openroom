import type { Context } from "hono";
import type { AppEnv } from "./env";
import { now } from "./util";

type EventInput = {
  email: string;
  action: "sign_in" | "view" | "download" | "email_failed";
  fileId?: string;
  fileName?: string;
  folderName?: string;
};

/** Records who opened what. Repeat opens of the same file within a minute count once. */
export async function logEvent(c: Context<AppEnv>, e: EventInput) {
  const t = now();
  if (e.fileId) {
    const recent = await c.env.DB.prepare(
      "SELECT 1 FROM events WHERE email = ? AND file_id = ? AND action = ? AND at > ? LIMIT 1",
    )
      .bind(e.email, e.fileId, e.action, t - 60_000)
      .first();
    if (recent) return;
  }
  const cf = (c.req.raw as { cf?: { country?: string } }).cf;
  await c.env.DB.prepare(
    `INSERT INTO events (at, email, action, file_id, file_name, folder_name, ip, country, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      t,
      e.email,
      e.action,
      e.fileId ?? null,
      e.fileName ?? null,
      e.folderName ?? null,
      c.req.header("cf-connecting-ip") ?? null,
      cf?.country ?? null,
      (c.req.header("user-agent") ?? "").slice(0, 300) || null,
    )
    .run();
}
