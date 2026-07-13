# Doppelkopf V3 Implementation Backlog

This index splits the greenfield implementation into medium-effort tasks that can be assigned independently once their dependencies are complete. Every task includes context, a definition of done, and a testing plan.

## Product agents

We will try exactly two product model designs:

1. **Structured-Belief Policy Agent**
2. **Belief-Search Agent**

GRU versus small causal transformer is a matched encoder ablation within the first design. An engineered MLP is only a plumbing baseline, and PIMC is only a search lower bound.

## Workstreams

- [Greenfield engine](backlog/ENGINE.md): 15 tasks covering contracts, rules, transitions, settlement, observations, replay, and deterministic simulation.
- [ML, belief, and search](backlog/ML-BELIEF-SEARCH.md): 32 tasks covering schemas, datasets, feasible-world belief, both product agents, population training, evaluation, search, distillation, and deployment.
- [Integration, runtime, and release](backlog/INTEGRATION.md): 17 tasks covering repository boundaries, agent runtime, a deterministic V3 heuristic, legacy adapters, browser adoption, evaluation, artifacts, and release gates.

## Global dependency gates

```text
Engine contracts and rules
  -> transition kernel and settlement
  -> integrated hand engine
  -> certified observation, legal actions, replay, simulation
  -> shared agent runner and legal-random baseline
  -> data, belief, model, population, and evaluation lanes
  -> Structured-Belief Policy Agent
  -> belief-aware search experiments
  -> Belief-Search Agent and distillation
  -> browser promotion and release
```

Start parallel work from the dependency graph, not from document order. A task may not change an upstream schema incidentally; create an explicit schema-version task when a contract must change.

## Cross-workstream ownership

One task owns each shared artifact:

| Artifact                                                                                                                        | Owner                                    | Consumers                             |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------- |
| Transition legality, correctness fixtures, replay, low-level legal-random traversal, worker determinism, engine microbenchmarks | `ENG3-014`, `ENG3-015`                   | Integration and ML                    |
| Agent interface, response validation, browser controller, multi-agent scheduling                                                | `V3-AGT-001`, `V3-WEB-001`, `V3-SIM-001` | Evaluation and ML                     |
| Canonical matched-deal, tactical, cross-play, and promotion harness                                                             | `V3-EVAL-001`                            | ML evaluation tasks and release gates |
| PyTorch/ONNX export and model-specific numerical parity                                                                         | `DEPLOY-001`                             | Runtime artifact validation           |
| Browser policy/belief worker                                                                                                    | `DEPLOY-002`                             | `V3-WEB-001`                          |

Dependency aliases used inside workstream documents map to concrete tasks:

```text
CORE-0 = ENG3-001
CORE-1 = ENG3-012
RULES-1 = ENG3-013
CORE-2 = OBS-READY = ENG3-014
BASE-1 = CORE-READY = ENG3-015
RUNNER-READY = V3-SIM-001
EXPORTED-MODEL = DEPLOY-001
```

The training repository consumes the canonical engine through a read-only Git submodule at `vendor/doppelkopf`, pinned to an exact commit. `engine.lock.json` must match the gitlink, schema IDs, and rule hashes before generation or evaluation runs.
