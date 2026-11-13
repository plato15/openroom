import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnv, createHandler, openDatabase } from "../src/node/app";
import { DiskBucket } from "../src/node/r2";

/** The Node build, set up like vitest.config.ts sets up the Worker: same settings, fresh database and files. */
const dir = mkdtempSync(join(tmpdir(), "openroom-test-"));
const { db } = openDatabase(":memory:", join(import.meta.dirname, "..", "migrations"));

export const env = createEnv({
  db,
  bucket: new DiskBucket(join(dir, "files")),
  settings: {
    ENVIRONMENT: "test",
    APP_ORIGIN: "https://dataroom.test",
    ADMIN_EMAILS: "admin@example.test",
    MAIL_FROM: "Data Room <onboarding@resend.dev>",
    BRAND_NAME: "Openroom",
    BRAND_LEGAL_NAME: "Openroom",
    BRAND_INVITER: "The Openroom team",
    BRAND_COLOR: "#2563EB",
    BRAND_DARK: "#0F172A",
    BRAND_FONT_BODY: "Inter",
    BRAND_FONT_DISPLAY: "Inter",
    SHOW_CREDIT: "true",
  },
});

const handle = createHandler(env);
export const fetchApp = (req: Request) => handle(req, "127.0.0.1");
