import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";

export default defineConfig({
  srcDir: "./src",
  outDir: "./dist",
  vite: {
    resolve: {
      alias: {
        "@doppelkopf-v3": fileURLToPath(
          new URL("../../../src/lib/doppelkopf/v3/index.ts", import.meta.url),
        ),
      },
    },
  },
});
