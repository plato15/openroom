import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            ENVIRONMENT: "test",
            APP_ORIGIN: "https://dataroom.test",
            ADMIN_EMAILS: "admin@example.test",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    resolve: { alias: [{ find: /^\.\/harness$/, replacement: resolve(import.meta.dirname, "test/harness.workers.ts") }] },
    test: { setupFiles: ["./test/setup.ts"], include: ["test/room.test.ts", "test/xlsxstyle.test.ts"] },
  };
});
