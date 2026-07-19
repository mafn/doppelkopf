import { performance } from "node:perf_hooks";

const entryPoints = [
  "../src/lib/doppelkopf/v3/index.ts",
  "../src/lib/doppelkopf/v3/engine/index.ts",
  "../src/lib/doppelkopf/v3/agents/index.ts",
  "../src/lib/doppelkopf/v3/testkit/index.ts",
] as const;

const startedAt = performance.now();
await Promise.all(entryPoints.map((entryPoint) => import(entryPoint)));
const elapsedMs = performance.now() - startedAt;

console.log(
  JSON.stringify({
    benchmark: "v3-module-import",
    entryPoints: entryPoints.length,
    elapsedMs: Number(elapsedMs.toFixed(3)),
  }),
);
