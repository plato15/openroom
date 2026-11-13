// Bundles the Node build (src/node/server.ts plus all of src/) into dist/server.mjs.
import { build } from "esbuild";

await build({
  entryPoints: ["src/node/server.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  // Some dependencies are CommonJS and call require() for Node built-ins.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
});
