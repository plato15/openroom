import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/** The same room tests against the Node build (Docker), plus tests for the Node adapters. */
export default defineConfig({
  resolve: { alias: [{ find: /^\.\/harness$/, replacement: resolve(import.meta.dirname, "test/harness.node.ts") }] },
  test: { environment: "node", include: ["test/room.test.ts", "test/node.test.ts", "test/xlsxstyle.test.ts"] },
});
