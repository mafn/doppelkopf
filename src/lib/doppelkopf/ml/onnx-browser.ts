import type * as ortType from "onnxruntime-web";

type SessionCache = {
  sessionPromise: Promise<ortType.InferenceSession>;
  session: ortType.InferenceSession | null;
  metaExpectedFeatureSize: number | null;
};

const cache = new Map<string, SessionCache>();

export type OrtBrowserConfig = {
  modelUrl: string;
  wasmBaseUrl?: string;
};

function inferExpectedFeatureSize(
  session: ortType.InferenceSession,
  inputName: string,
): number | null {
  const meta = (session as any).inputMetadata?.[inputName];
  const dims = meta?.dimensions;
  if (!Array.isArray(dims) || dims.length < 2) return null;
  const d1 = dims[1];
  if (typeof d1 === "number" && Number.isFinite(d1) && d1 > 0) return d1;
  if (typeof d1 === "string") {
    const n = Number(d1);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export async function loadOnnxSession(
  cfg: OrtBrowserConfig,
): Promise<ortType.InferenceSession> {
  const existing = cache.get(cfg.modelUrl);
  if (existing?.session) return existing.session;
  if (existing?.sessionPromise) return existing.sessionPromise;

  const entry: SessionCache = {
    sessionPromise: null as any,
    session: null,
    metaExpectedFeatureSize: null,
  };
  cache.set(cfg.modelUrl, entry);

  entry.sessionPromise = (async () => {
    const ort = (await import("onnxruntime-web")) as unknown as typeof ortType;

    if (cfg.wasmBaseUrl) {
      // Prefix where `ort-wasm*.wasm` and `.mjs` worker files live (served from `public/`).
      // Use absolute URL to prevent Vite from intercepting dynamic imports of public .mjs files in dev mode.
      (ort as any).env.wasm.wasmPaths = new URL(
        cfg.wasmBaseUrl,
        window.location.origin,
      ).href;
    }

    // Keep it deterministic/light; threaded WASM can be finicky across browsers.
    (ort as any).env.wasm.numThreads = 1;

    const s = await (ort as any).InferenceSession.create(cfg.modelUrl, {
      executionProviders: ["wasm"],
    });
    entry.session = s;

    // Best-effort: fetch feature size from sidecar meta JSON (written by `ml/export_onnx.py`).
    // This works even when ORT metadata doesn't expose fixed dimensions.
    try {
      const metaUrl = `${cfg.modelUrl}.meta.json`;
      const res = await (globalThis as any).fetch?.(metaUrl);
      if (res && res.ok) {
        const j = await res.json();
        const n = Number(j?.featureSize);
        if (Number.isFinite(n) && n > 0) entry.metaExpectedFeatureSize = n;
      }
    } catch {
      // Ignore.
    }
    return s;
  })();

  return entry.sessionPromise;
}

export async function getExpectedFeatureSize(
  cfg: OrtBrowserConfig,
): Promise<number | null> {
  const s = await loadOnnxSession(cfg);
  const entry = cache.get(cfg.modelUrl);
  const inputName = ((s as any).inputNames?.[0] as string) ?? "x";
  return (
    inferExpectedFeatureSize(s, inputName) ??
    (entry?.metaExpectedFeatureSize || null)
  );
}

export async function runOnnx(
  cfg: OrtBrowserConfig,
  input: Float32Array,
): Promise<{
  card_logits: Float32Array;
  bid_logits: Float32Array;
  value_logit: Float32Array;
}> {
  const ort = (await import("onnxruntime-web")) as unknown as typeof ortType;
  const s = await loadOnnxSession(cfg);
  const entry = cache.get(cfg.modelUrl);
  const inputName = ((s as any).inputNames?.[0] as string) ?? "x";
  const expected = inferExpectedFeatureSize(s, inputName);
  const expectedAny = expected ?? (entry?.metaExpectedFeatureSize || null);
  if (expectedAny !== null && input.length !== expectedAny) {
    throw new Error(
      `ONNX input feature mismatch: model expects ${expectedAny}, got ${input.length} for ${cfg.modelUrl}`,
    );
  }

  const x = new (ort as any).Tensor("float32", input, [1, input.length]);
  const outputs = await (s as any).run({ [inputName]: x });

  const card =
    outputs.card_logits?.data ?? outputs[Object.keys(outputs)[0]]?.data;
  const bid =
    outputs.bid_logits?.data ?? outputs[Object.keys(outputs)[1]]?.data;
  const val =
    outputs.value_logit?.data ?? outputs[Object.keys(outputs)[2]]?.data;

  return {
    card_logits: card as Float32Array,
    bid_logits: bid as Float32Array,
    value_logit: val as Float32Array,
  };
}
