import app from "../index";
import type { Env } from "../env";
import { applyMigrations, SqliteD1 } from "./d1";
import { DiskBucket, S3Bucket, type Bucket } from "./r2";

/** Settings the Node build reads (environment variables). Everything the Worker reads, plus storage. */
export type NodeSettings = Record<string, string | undefined>;

const PASS_THROUGH = [
  "ENVIRONMENT", "APP_ORIGIN", "ADMIN_EMAILS", "MAIL_FROM", "MAIL_PROVIDER", "RESEND_API_KEY", "SMTP_URL",
  "SES_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "BRAND_NAME", "BRAND_LEGAL_NAME", "BRAND_INVITER",
  "BRAND_COLOR", "BRAND_DARK", "BRAND_FONT_BODY", "BRAND_FONT_DISPLAY", "SHOW_CREDIT",
] as const;

export function bucketFrom(s: NodeSettings, dataDir: string): Bucket {
  if (s.S3_BUCKET) {
    const missing = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !s[k]);
    if (missing.length) throw new Error(`S3_BUCKET is set, so these are needed too: ${missing.join(", ")}`);
    return new S3Bucket({
      endpoint: s.S3_ENDPOINT!,
      bucket: s.S3_BUCKET,
      region: s.S3_REGION,
      accessKeyId: s.S3_ACCESS_KEY_ID!,
      secretAccessKey: s.S3_SECRET_ACCESS_KEY!,
    });
  }
  return new DiskBucket(`${dataDir}/files`);
}

/** Builds the same bindings the Worker gets: DB (SQLite), FILES (disk or S3) and the plain settings. */
export function createEnv(opts: { settings: NodeSettings; db: SqliteD1; bucket: Bucket }): Env {
  const vars: Record<string, string> = {};
  for (const k of PASS_THROUGH) if (opts.settings[k] !== undefined) vars[k] = opts.settings[k]!;
  vars.ENVIRONMENT ||= "production";
  vars.MAIL_FROM ||= "Data Room <noreply@example.com>";
  return {
    ...(vars as unknown as Env),
    DB: opts.db as unknown as D1Database,
    FILES: opts.bucket as unknown as R2Bucket,
    // Static files are served before the app (see server.ts); the app itself never calls ASSETS.
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } as unknown as Fetcher,
  };
}

export function openDatabase(path: string, migrationsDir: string) {
  const db = new SqliteD1(path);
  const applied = applyMigrations(db, migrationsDir);
  return { db, applied };
}

/** Background work the Worker would hand to waitUntil: run it, and log a failure instead of crashing. */
const executionCtx = {
  waitUntil(p: Promise<unknown>) {
    Promise.resolve(p).catch((err) => console.error("background task failed:", err));
  },
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

/**
 * The request handler: the Worker's own app, with the client address passed the way Cloudflare
 * passes it (cf-connecting-ip). A client can never set that header itself; behind a proxy that
 * you trust (Caddy in docker-compose.yml), the first X-Forwarded-For address is used.
 */
export function createHandler(env: Env, opts: { trustProxy?: boolean } = {}) {
  return (req: Request, remoteAddress?: string): Promise<Response> => {
    const headers = new Headers(req.headers);
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    const forwarded = opts.trustProxy ? headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
    const ip = forwarded || remoteAddress;
    if (ip) headers.set("cf-connecting-ip", ip);
    const init: RequestInit & { duplex?: "half" } = { headers };
    if (req.body) init.duplex = "half";
    return Promise.resolve(app.fetch(new Request(req, init), env, executionCtx));
  };
}
