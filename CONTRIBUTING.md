# Contributing

## Repository ownership

This repository owns the browser application, canonical rules engine, observation/action schemas, and browser inference runtime. Training jobs, generated datasets, large evaluations, and model export belong in [`mafn/doppelkopf-training`](https://github.com/mafn/doppelkopf-training). Released weights belong in a model registry, not normal Git history.

The current engine under `src/lib/doppelkopf/` is legacy evidence. New V3 work follows `docs/plans/doppelkopf/AGENT-V3-DESIGN.md` and the dependency graph in `docs/plans/doppelkopf/BACKLOG.md`.

## Setup

Use Node 24 and install from the lockfile:

```sh
npm ci
npx playwright install chromium
npm run verify
```

## Change requirements

- Bind every rules change to focused conformance fixtures and full-hand regression coverage.
- Preserve illegal-action atomicity: rejected actions must not change state, RNG, or events.
- Do not expose another seat's private state through observations, adapters, logs, or tests.
- Version changes to actions, observations, rules, replays, manifests, or serialized fixtures.
- Record a reproducible seed for stochastic failures.
- Do not commit datasets, checkpoints, ONNX files, generated reports, or local benchmark output.
- Keep modes as presentation and initial settings over one engine; do not add another rules implementation to a UI component.

Open a pull request from a branch. Include what changed, why, verification commands, and any rule or compatibility tradeoff.
