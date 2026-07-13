# Doppelkopf V3 browser modules

This directory is the greenfield, browser-safe V3 boundary. It deliberately
does not import from `src/lib/doppelkopf/`, whose contents are legacy evidence
and not a V3 contract.

- `engine/` owns framework-independent game rules, state, observations,
  actions, replay, and deterministic simulation primitives.
- `agents/` owns browser-safe agent interfaces, manifest validation, and
  inference adapters.
- `testkit/` owns test-only fixture and tactical-oracle helpers. Its builders
  must never be re-exported by the production engine entry point.

Each directory starts as an empty module barrel. The backlog task that owns a
public contract adds its exports; do not use these barrels as a shortcut to
reach legacy code or Node-only tooling.

V3 public modules are ESM-only. CommonJS `require()` and computed dynamic
imports are unsupported at this boundary; browser-safe static ESM imports are
enforced by the Vite bundle test.

## Training boundary

Training, data generation, large evaluation jobs, search experiments, and
Python code live in the separate
[`mafn/doppelkopf-training`](https://github.com/mafn/doppelkopf-training)
repository. That repository consumes this repository as the read-only Git
submodule `vendor/doppelkopf`, pinned to an exact commit. Before generation or
evaluation, its `engine.lock.json` must match that gitlink plus the engine,
observation, action, replay, and ruleset schema IDs and the compiled ruleset
hashes. A mismatch is a failure, never a fallback.

Released models, manifests, and evaluation reports are published separately on
Hugging Face. Only schemas, compact fixtures, configurations, and selected
golden reports belong in this repository; generated trajectories, models, and
local benchmark output do not.
