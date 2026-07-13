import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const srcDir = path.join(
  projectRoot,
  "node_modules",
  "onnxruntime-web",
  "dist",
);
const destDir = path.join(projectRoot, "public", "vendor", "onnxruntime");

const patterns = [/^ort-wasm-simd-threaded(\..+)?\.(wasm|mjs)$/];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return [];
    return [entry.name];
  });
}

if (!fs.existsSync(srcDir)) {
  throw new Error(
    `Missing ${srcDir}. Run \`npm install\` so onnxruntime-web is available.`,
  );
}

ensureDir(destDir);

const srcFiles = listFiles(srcDir).filter((name) =>
  patterns.some((re) => re.test(name)),
);

if (srcFiles.length === 0) {
  throw new Error(
    `No ORT runtime assets found in ${srcDir}. Expected files like ort-wasm-simd-threaded*.{wasm,mjs}.`,
  );
}

for (const name of srcFiles) {
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
}
