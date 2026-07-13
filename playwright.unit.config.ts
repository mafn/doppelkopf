import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "doppelkopf-engine.spec.ts",
    "doppelkopf-ml-features.spec.ts",
    "team-evidence.spec.ts",
    "engine-replay-determinism.spec.ts",
    "doppelkopf-v3-boundaries.spec.ts",
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
});
