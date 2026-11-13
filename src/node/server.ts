import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import nodemailer from "nodemailer";
import { registerSmtp } from "../email";
import { isLocalOrigin } from "../util";
import { bucketFrom, createEnv, createHandler, openDatabase } from "./app";

/**
 * Openroom on Node (the Docker image). Same app as the Worker: SQLite instead of D1, a folder
 * or S3 bucket instead of R2. Settings come from environment variables (see .env.example).
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.OPENROOM_ROOT ?? join(here, ".."));
const s = process.env;

function fail(message: string): never {
  console.error(`Openroom cannot start: ${message}`);
  process.exit(1);
}

// APP_ORIGIN is required here: sign-in links are built from it, and the Host header of a request
// cannot be trusted on a server that anyone can reach directly.
let origin: URL;
try {
  origin = new URL(s.APP_ORIGIN ?? "");
} catch {
  fail("set APP_ORIGIN to the room's address, for example https://dataroom.example.com");
}
if (origin.origin !== s.APP_ORIGIN!.replace(/\/+$/, "")) fail("APP_ORIGIN must be just the address, like https://dataroom.example.com, with no path");
s.APP_ORIGIN = origin.origin;
if (origin.protocol !== "https:" && !isLocalOrigin(origin.origin)) {
  fail("APP_ORIGIN must start with https:// (sign-in cookies only work over HTTPS). docker-compose.yml sets up HTTPS for you with Caddy.");
}
if (!s.ADMIN_EMAILS) fail("set ADMIN_EMAILS to at least one admin email");

const dataDir = resolve(s.DATA_DIR ?? "/data");
mkdirSync(dataDir, { recursive: true });
const { db, applied } = openDatabase(join(dataDir, "openroom.db"), join(root, "migrations"));
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);

if (s.SMTP_URL) {
  const transport = nodemailer.createTransport(s.SMTP_URL);
  registerSmtp(async (from, mail) => {
    await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
  });
}

const env = createEnv({ settings: s, db, bucket: bucketFrom(s, dataDir) });
const handle = createHandler(env, { trustProxy: s.TRUST_PROXY === "true" });

// The public/ folder, read once at start-up. Only these exact paths are served; nothing else on disk is reachable.
const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};
const assets = new Map<string, { body: Uint8Array; type: string }>();
function load(dir: string, prefix: string) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) load(full, `${prefix}${name}/`);
    else assets.set(`${prefix}${name}`, { body: readFileSync(full), type: TYPES[extname(name)] ?? "application/octet-stream" });
  }
}
load(join(root, "public"), "/");

const port = Number(s.PORT ?? 3000);
serve(
  {
    port,
    hostname: s.HOST ?? "0.0.0.0",
    fetch: (req, bindings: { incoming?: { socket?: { remoteAddress?: string } } }) => {
      const url = new URL(req.url);
      const asset = req.method === "GET" || req.method === "HEAD" ? assets.get(url.pathname) : undefined;
      if (asset) {
        return new Response(req.method === "HEAD" ? null : asset.body, {
          headers: { "content-type": asset.type, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" },
        });
      }
      return handle(req, bindings?.incoming?.socket?.remoteAddress);
    },
  },
  () => console.log(`Openroom is running on port ${port}, serving ${origin.origin}`),
);

const stop = () => {
  db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
