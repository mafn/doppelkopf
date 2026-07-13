import { test, expect } from "@playwright/test";

test("onnxruntime vendor assets are served", async ({ page, request }) => {
  await page.goto("/doppelkopf/");

  const assets = [
    "/vendor/onnxruntime/ort-wasm-simd-threaded.mjs",
    "/vendor/onnxruntime/ort-wasm-simd-threaded.jsep.mjs",
    "/vendor/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs",
    "/vendor/onnxruntime/ort-wasm-simd-threaded.jspi.mjs",
  ];

  for (const url of assets) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(200);
  }
});
