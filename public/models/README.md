# Model artifacts

The public preview does not ship or select learned models. Local `.onnx` and `.onnx.meta.json` files in this directory are ignored.

Before learned agents become a public option, the browser must consume a tracked manifest that pins an immutable model revision and checksum and validates the engine revision, ruleset hash, observation/action schemas, and runtime capabilities. Missing or incompatible artifacts must fail closed rather than silently presenting a heuristic fallback as an ML bot.
