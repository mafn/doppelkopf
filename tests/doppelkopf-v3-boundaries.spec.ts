import { expect, test } from "@playwright/test";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";

import * as agents from "../src/lib/doppelkopf/v3/agents";
import * as engine from "../src/lib/doppelkopf/v3/engine";
import * as testkit from "../src/lib/doppelkopf/v3/testkit";
import * as v3 from "../src/lib/doppelkopf/v3";

type PublicModule = typeof v3;
type EngineModule = typeof engine;
type AgentsModule = typeof agents;
type TestkitModule = typeof testkit;

const publicModules: readonly PublicModule[] = [v3];
const browserModules: readonly (EngineModule | AgentsModule | TestkitModule)[] =
  [engine, agents, testkit];

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const nodeBuiltinModules = new Set(
  builtinModules.flatMap((moduleName) => {
    const bareModuleName = moduleName.replace(/^node:/, "");
    return [bareModuleName, `node:${bareModuleName}`];
  }),
);

async function bundleForBrowser(entryPoint: string) {
  return build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "reject-node-only-imports",
        enforce: "pre",
        resolveId(source, importer) {
          if (nodeBuiltinModules.has(source)) {
            throw new Error(
              `browser bundle cannot import ${source}${
                importer ? ` from ${importer}` : ""
              }`,
            );
          }
          return null;
        },
      },
    ],
    build: {
      write: false,
      lib: {
        entry: entryPoint,
        formats: ["es"],
        fileName: "v3-browser-boundary",
      },
    },
  });
}

test("V3 public module entry points resolve as Node ESM modules", () => {
  expect(publicModules).toHaveLength(1);
  expect(browserModules).toHaveLength(3);
});

test("V3 public entry points compile into a Vite browser bundle", async () => {
  const bundle = await bundleForBrowser(fixturePath("v3-browser-entry.ts"));

  expect(Array.isArray(bundle)).toBeTruthy();
});

test("browser boundary rejects a Node-only evaluation dependency edge", async () => {
  await expect(
    bundleForBrowser(fixturePath("v3-browser-entry-with-node-only.ts")),
  ).rejects.toThrow("browser bundle cannot import fs/promises");
});

test("browser boundary rejects node: dependency edges", async () => {
  await expect(
    bundleForBrowser(
      fixturePath("v3-browser-entry-with-node-only-node-protocol.ts"),
    ),
  ).rejects.toThrow("browser bundle cannot import node:fs/promises");
});
