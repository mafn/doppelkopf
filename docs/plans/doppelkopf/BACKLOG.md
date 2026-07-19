# Doppelkopf V3 Implementation Backlog

This index splits the greenfield implementation into medium-effort tasks that can be assigned independently once their dependencies are complete. Every task includes context, a definition of done, and a testing plan.

## Product agents

We will try exactly two product model designs:

1. **Structured-Belief Policy Agent** (with DP constrained sampler and dynamic legal-subset scorer for Armut)
2. **Deployment candidate B split:**
   - **Offline rollout policy improver**: An operator estimating Q under a fixed population prior and fixed continuation policies.
   - **Distilled policy**: The learned policy distilled from the offline rollout policy improver.
   - **Optional live hybrid**: Only deployed if profiling allows.

GRU versus small causal transformer is a matched encoder ablation within the first design. An engineered MLP is only a plumbing baseline, and PIMC is only a simple determinization baseline. Mandatory autoregressive generation is removed.

## Workstreams

- [Greenfield engine](backlog/ENGINE.md): Tasks covering contracts, rules, transitions, settlement, observations, replay, and deterministic simulation.
- [ML, belief, and search](backlog/ML-BELIEF-SEARCH.md): 32 tasks covering schemas, datasets, feasible-world belief, both product agents, population training, evaluation, search, optional distillation, and deployment.
- [Integration, runtime, and release](backlog/INTEGRATION.md): 17 tasks covering repository boundaries, agent runtime, a deterministic V3 heuristic, legacy adapters, browser adoption, evaluation, artifacts, and release gates.

## Global dependency gates

```text
1. V3.0a: Certified primary-pack engine (`website-48-single-hand-v1`).
  -> 2. V3.0b: Legacy migration (implement Armut, 40-card, Bock, Pflichtsolo, all legacy presets).
  -> 3. V3.1: Fun early bot (Strong heuristic, followed by heuristic + selective bounded rollouts).
  -> 4. V3.2: Tiny deployable learned bot (Distilled policy from heuristic/search traces).
  -> 5. V3.3: Online RL baseline (Recurrent PPO vs Deep Monte Carlo (DMC) state-action learner).
  -> 6. V3.4: Population robustness (held-out partners, style conditioning).
  -> 7. V3.5: Belief/search upgrade (Offline rollout teacher + distillation).
  -> 8. V3.6: Rule specialists and research search.
```

Start parallel work from the dependency graph, not from document order. A task may not change an upstream schema incidentally; create an explicit schema-version task when a contract must change.

## Cross-workstream ownership

One task owns each shared artifact:

| Artifact                                                                                                                        | Owner                                    | Consumers                             |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------- |
| Transition legality, correctness fixtures, replay, low-level legal-random traversal, worker determinism, engine microbenchmarks | `ENG3-014A..C`, `ENG3-015A..C`           | Integration and ML                    |
| Agent interface, response validation, browser controller, multi-agent scheduling                                                | `V3-AGT-001`, `V3-WEB-001`, `V3-SIM-001` | Evaluation and ML                     |
| Canonical matched-deal, tactical, cross-play, and promotion harness                                                             | `V3-EVAL-001`                            | ML evaluation tasks and release gates |
| PyTorch/ONNX export and model-specific numerical parity                                                                         | `DEPLOY-001`                             | Runtime artifact validation           |
| Browser policy/belief worker                                                                                                    | `DEPLOY-002`                             | `V3-WEB-001`                          |

Dependency aliases used inside workstream documents map to concrete tasks:

```text
CORE-0 = ENG3-001
CORE-1 = ENG3-012
RULES-1 = ENG3-013A
CORE-2 = OBS-READY = ENG3-014A
BASE-1 = CORE-READY = ENG3-015A
RUNNER-READY = V3-SIM-001
EXPORTED-MODEL = DEPLOY-001
```

The training repository consumes the canonical engine through a read-only Git submodule at `vendor/doppelkopf`, pinned to an exact commit. `engine.lock.json` must match the gitlink, schema IDs, and rule hashes before generation or evaluation runs.
