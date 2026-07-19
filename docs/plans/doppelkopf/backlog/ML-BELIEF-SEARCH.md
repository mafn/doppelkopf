# Doppelkopf V3 ML, Belief, and Search Backlog

Status: implementation backlog  
Scope: training data, structured belief, learned policy, population training, evaluation, ONNX/browser deployment, belief-aware search, and distillation

## Product designs

We will build and evaluate exactly two product agent designs:

1. **Structured-Belief Policy Agent**: a rule-conditioned policy/value model with a permutation-invariant hand encoder, an ordered public-event encoder, and an explicit learned distribution over feasible hidden worlds. A matched GRU-versus-small-causal-transformer experiment selects the event encoder; those are two variants of one product design, not separate agents.
2. **Deployment candidate B split**: 
   - **Offline rollout policy improver**: An operator estimating Q under a fixed population prior and fixed continuation policies.
   - **Distilled policy**: The learned policy distilled from the offline rollout policy improver.
   - **Optional live hybrid**: Only deployed if profiling allows. GO-MCTS and generative observation-space planning are deferred to a later experimental phase.

A small engineered MLP may be used to validate data and training plumbing. Uniform PIMC is a simple determinization baseline. Neither is a third product design.

## External gates

The backlog depends on concrete engine and integration tasks owned elsewhere:

- **`CORE-READY = ENG3-015`**: certified rules, deterministic transitions, settlement, replay, and baseline simulation.
- **`OBS-READY = ENG3-014`**: frozen `AgentObservationV3`, complete legal actions, relative-seat projection, and leakage tests.
- **`RUNNER-READY = V3-SIM-001`**: manifests, `AgentRunnerV3`, and deterministic multi-agent match scheduling.
- **`EVAL-READY = V3-EVAL-001`**: the canonical matched-deal, tactical, cross-play, and promotion harness.

Tasks may begin as soon as all listed dependencies are complete. A downstream task must not change an upstream schema incidentally; schema changes create a new task and version.

## Implementation graph

```text
CORE-READY + OBS-READY
  -> ML-001, ML-002, ML-003, BEL-001

EVAL-READY
  -> EVAL-001

ML-001 + ML-002 + ML-003
  -> DATA-001, TRAIN-001, MODEL-001

BEL-001 + DATA-001
  -> BEL-002 -> BEL-003 -> BEL-004

MODEL-001
  -> MODEL-002, MODEL-003, MODEL-004

TRAIN-001 + MODEL-002/003 + MODEL-004
  -> TRAIN-002

TRAIN-002 + BEL-004
  -> TRAIN-003 -> MODEL-005

MODEL-005 + EVAL-001
  -> POP-001 -> POP-002

MODEL-005 + DEPLOY-001 + POP-002
  -> AGENT-001

AGENT-001 + BEL-001 + POP-001
  -> SEARCH-001, SEARCH-002, SEARCH-003, SEARCH-004

SEARCH-001..004 + EVAL-001
  -> SEARCH-005

SEARCH-005
  -> DISTILL-001 -> DISTILL-002
  -> DEPLOY-003

DISTILL-002 + DEPLOY-003
  -> AGENT-002
```

## Data and encoding

### ML-001: Versioned decision-record schema and codec

**Dependencies:** `CORE-READY`, `OBS-READY`

**Context and scope:** Define the authoritative cross-language training record. It must preserve game, acting-seat episode, timestep, rules, schemas, legal actions, behavior policy, action probability, and terminal utility so returns can never cross seats or hands. Implement a compact binary codec plus TypeScript and Python readers.

**Definition of done:**

- The schema has an explicit append-only version and documented endianness and numeric representation.
- Every record contains `gameId`, `episodeId`, acting seat, timestep, ruleset ID/hash, observation/action schema IDs, observation payload, legal actions, chosen action, behavior policy/log probability, and optional terminal and auxiliary labels.
- Unknown versions, truncated files, invalid lengths, and incompatible schema combinations fail closed.
- The format records explicit `Pass` decisions and does not infer episode boundaries from record order.

**Testing plan:** TypeScript-to-Python and Python-to-TypeScript golden round trips; corruption, truncation, and unknown-version tests; mixed-seat fixture proving grouping by `(gameId, actingSeat)`; large-file streaming test; stable-byte snapshot.

### ML-002: Canonical observation featurization

**Dependencies:** `OBS-READY`

**Context and scope:** Implement one versioned featurization in TypeScript and Python for the private hand multiset, ordered legitimate events, current trick, completed public history, phase, contract, rules effects, and relative seats. Privileged state is excluded by construction.

**Definition of done:**

- Both implementations produce identical tensors and masks for the same serialized observation.
- Hand order and identical-copy labels do not affect the representation.
- Sequence padding, truncation, and current-trick placement are specified.
- No future Hochzeit partner, unresolved true team, other hand, or presentation state is encoded.

**Testing plan:** Cross-language golden tensors for every phase and initial rules pack; hand permutation and identical-copy invariance; hidden-hand shuffle information-set test; event causality and padding tests; mutation isolation test.

### ML-003: Legal-action encoding and factorized masks

**Dependencies:** `OBS-READY`

**Context and scope:** Map the complete engine action surface to stable model selectors. Card and small meta actions may use fixed heads; for the combinatorial Armut exchange macro-action encoding, use a dynamic candidate-action encoder. Since searching all 455 subsets is impractical, implement an action proposal stage: evaluate cheaply, retain top-k and diverse candidates, then allocate rollouts.

**Definition of done:**

- Every legal engine action round-trips through the model adapter.
- Illegal actions receive zero probability before sampling and log-probability calculation.
- Card copies and exchange selections have canonical, deterministic representations.
- An empty legal mask is an explicit error rather than a fallback.

**Testing plan:** Phase-complete action fixtures; property tests over generated legal-action sets; TypeScript/Python parity; probability normalization; duplicate-card and exchange-order invariance; invalid-selector rejection.

### DATA-001: Reproducible latent-world corpus generator

**Dependencies:** `ML-001`, `ML-002`, `ML-003`, `CORE-READY`

**Context and scope:** Generate supervised belief and auxiliary labels from authoritative games while keeping latent labels outside actor inputs. Support natural play and explicit rare-phase scenario distributions.

**Definition of done:**

- A manifest pins engine/rules/schema versions, generator config, root seed, derived seed method, shard hashes, and record counts.
- Every decision, including optional passes, can be emitted with its actor observation, legal mask, latent world, card counts, voids, phase, trick outcome, and contingent Hochzeit outcome.
- Natural and stratified datasets are distinguishable and reproducible.
- Generated files are streamed and atomically finalized.

**Testing plan:** Same manifest produces byte-identical shards; labels reconstruct engine truth; no missing or duplicate decision IDs; interrupted generation leaves no valid-looking shard; actor tensors remain unchanged when latent labels are shuffled.

## Structured belief

### BEL-001: Deterministic constrained feasible-world generator

**Dependencies:** `CORE-READY`, `OBS-READY`

**Context and scope:** Build the non-learned reference sampler over complete worlds consistent with one actor observation. It is the legality source for learned belief and the first search variants.

**Definition of done:**

- Samples respect remaining multiplicities, exact hidden-hand capacities, known cards, void evidence, contract/rules constraints, and legally known exchange history.
- Identical copies are exchangeable in likelihood and diagnostics.
- Unresolved Hochzeit yields contingent outcomes rather than a current partner label.
- Impossible observations return a typed failure; sampling cannot enter an unbounded rejection loop.

**Testing plan:** Exhaustive reduced-deck comparison; all-phase/rules-pack property suite; deterministic seeded sampling; copy-swap invariance; impossible-observation fixtures; zero invalid worlds under the independent validator.

### BEL-002: Independent world-feasibility oracle

**Dependencies:** `BEL-001`, `DATA-001`

**Context and scope:** Implement an independently structured validator for belief samples. It must identify capacity, multiplicity, void, phase, exchange, and team-semantic violations without sharing the sampler's decision logic.

**Definition of done:**

- Validation returns stable typed reasons.
- The suite covers normal games, solos, Armut before/during/after exchange, and Hochzeit before/after clarification and fallback.
- The oracle is reusable by training evaluation and every search method.

**Testing plan:** Mutation-based invalid worlds; one-constraint-at-a-time fixtures; exhaustive toy games; all engine-generated latent worlds pass; all deliberately impossible worlds fail for the expected reason.

### BEL-003: Exact constrained DP world sampler

**Dependencies:** `BEL-002`, `ML-002`, `DATA-001`

**Context and scope:** Implement and validate the constraint-exact DP world sampler; optionally train one-shot allocation potentials and observed-action likelihood models to generate feasible worlds.

**Definition of done:**

- Training exposes exact log likelihood (if learned potentials are used); inference exposes deterministic and stochastic feasible samples.
- The DP construction prevents invalid or non-completable partial allocations by design rather than repairing them afterward.
- Team configurations are derived from complete sampled worlds and current phase semantics.
- Marginal card/team diagnostics are calculated from samples and remain copy invariant.

**Testing plan:** Zero invalid completions; normalized probabilities on exhaustive toy states; finite-gradient and tiny-overfit tests; save/load and seeded-sampling parity; copy-swap invariance; bounded worst-case decoding test.

### BEL-004: Belief training and calibration pipeline

**Dependencies:** `BEL-003`, `DATA-001`

**Context and scope:** Train and select the optional allocation potentials and likelihood models independently of policy strength so belief quality cannot be hidden by self-play results.

**Definition of done:**

- Reports held-out NLL, valid completion rate, diversity, effective sample size, card-location calibration, void/trump calibration, and unresolved-Hochzeit outcome calibration by phase and ruleset.
- Checkpoints and reports carry complete data/config provenance.
- Selection rejects mode collapse or material rare-phase calibration regressions.

**Testing plan:** Tiny overfit; deterministic evaluation; resume equivalence; corrupted-label failure; synthetic calibrated/miscalibrated metric fixtures; natural-versus-stratified slice checks.

## Policy models and training

### MODEL-001: Shared model contract and hand-set encoder

**Dependencies:** `ML-002`, `ML-003`

**Context and scope:** Define the common learned core used by both event-encoder ablations. Implement a permutation-invariant private-hand encoder and structured rule, phase, trick, and legal-action embeddings.

**Definition of done:**

- The hand representation is invariant to card ordering and exchangeable-copy swaps.
- The model contract exposes fused state, legal-action embeddings, and stable hooks for policy, value, auxiliary, and belief components.
- Configs report exact parameter counts and tensor dimensions.

**Testing plan:** Permutation/copy invariance; tensor shapes for every phase; padding invariance; forward/backward smoke tests; serialized-config round trip; parameter-count snapshot.

### MODEL-002: Matched GRU event-encoder variant

**Dependencies:** `MODEL-001`

**Context and scope:** Implement the compact GRU candidate over ordered public and actor-legitimate private events, fused with the shared hand/rule/action representation.

**Definition of done:**

- Event encoding is causal and uses the same inputs and output heads as the transformer candidate.
- Parameter count falls within the declared comparison tolerance.
- All action phases produce a normalized masked distribution.

**Testing plan:** Causality and padding tests; all-phase forward/backward pass; legal-mask tests; deterministic save/load; ONNX export feasibility smoke test.

### MODEL-003: Matched causal-transformer event-encoder variant

**Dependencies:** `MODEL-001`

**Context and scope:** Implement the small causal-transformer candidate at matched parameter count and with the same non-event components as `MODEL-002`.

**Definition of done:**

- Attention cannot observe future or padded events.
- Inputs, loss heads, training samples, and comparison budget match the GRU variant.
- Compute and memory differences are recorded rather than normalized away.

**Testing plan:** Causal-mask and padding tests; all-phase forward/backward pass; legal-mask tests; deterministic save/load; ONNX export feasibility; attention-mask edge cases.

### MODEL-004: Policy, per-seat value, and auxiliary heads

**Dependencies:** `MODEL-001`, `DATA-001`

**Context and scope:** Add phase-conditioned action heads, a terminal-utility value head, and diagnostic predictions for trick outcome, voids, trump counts, phase/role, and contingent Hochzeit outcome.

**Definition of done:**

- Value targets are authoritative terminal utility for the acting seat.
- Relative-seat labels are aligned for all four actors.
- Before Hochzeit clarification, no current-partner label or future partner feature enters the critic.
- Auxiliary losses never modify environment reward.

**Testing plan:** Four-seat label rotations; unresolved/clarified Hochzeit fixtures; masked-loss behavior; head-specific gradient tests; no-future-feature static contract test; zero-sum terminal fixtures.

### TRAIN-001: Batched deterministic rollout collector

**Dependencies:** `ML-001`, `ML-002`, `ML-003`, `RUNNER-READY`

**Context and scope:** Run many Node environments while batching learned inference. Preserve separate acting-seat trajectories and record policy identity and probability exactly.

**Definition of done:**

- Records group by `(gameId, actingSeat)` and strictly increasing timestep.
- Terminal utility is assigned without inferring teams or scores in the collector.
- Queue delay, policy lag, environment speed, and inference batching are measured.
- Failures, timeouts, and invalid actions fail the run; no silent fallback enters training data.

**Testing plan:** Four-seat trajectory separation; fixed-seed replay equality; terminal-return alignment; complete meta/pass action coverage; backpressure and worker-crash injection; no-partial-shard test.

### TRAIN-002: Terminal-utility actor-critic learner

**Dependencies:** `TRAIN-001`, `MODEL-004`, `MODEL-002` or `MODEL-003`

**Context and scope:** Implement the model-free learner with legal masked likelihoods, per-seat episodic returns, entropy, and optional auxiliary losses. Dense trick-point reward is disabled by default. Compare terminal Monte Carlo action-value learning and PPO actor-critic with an observation-only baseline, where `gamma = 1`. Select the baseline algorithm using sample efficiency, stability, final strength, calibration and implementation complexity.

**Definition of done:**

- Return and advantage computation never crosses game or actor boundaries.
- Behavior temperature and recorded log probability are handled consistently.
- Runs are resumable and carry complete config/data/model provenance.
- Invalid masks, non-finite values, or incompatible records stop training.

**Testing plan:** Hand-calculated multi-seat return fixtures; no-cross-seat regression; tiny overfit; resume equivalence; temperature/log-probability parity; NaN and invalid-mask failures.

### TRAIN-003: Joint policy and structured-belief training

**Dependencies:** `TRAIN-002`, `BEL-004`, both encoder variants for comparison runs

**Context and scope:** Couple the selected policy losses with the structured belief components without allowing privileged belief labels into runtime actor inputs.

**Definition of done:**

- Supports frozen-belief, alternating, and joint-fine-tune schedules with explicit weights.
- Policy strength and belief calibration are reported separately.
- Training detects and rejects sampler validity or calibration degradation.
- Exportable actor inputs remain identical whether privileged labels are present or absent.

**Testing plan:** Frozen-parameter checks; loss-schedule tests; component checkpoint compatibility; tiny end-to-end run; privileged-label shuffle test; resume parity.

### TRAIN-004: Objective and sparse-return pilot

**Dependencies:** `TRAIN-002`, `EVAL-001`

**Context and scope:** Measure rather than assume the cost of terminal rewards. Compare terminal utility, terminal plus auxiliaries, warm start, and the isolated legacy dense reward under equal decisions and seeds.

**Definition of done:**

- The experiment enforces equal environment-decision budgets and matched seeds.
- Reports learning curves, phase/head gradients, learner throughput, and confidence intervals.
- Dense reward remains a diagnostic condition and cannot become the production objective without a separate approval.

**Testing plan:** Reduced reproducible matrix; budget-equality assertions; manifest completeness; report regeneration from immutable run artifacts.

### MODEL-005: Matched GRU-versus-transformer selection

**Dependencies:** `TRAIN-003`, `TRAIN-004`, `DEPLOY-001`, `EVAL-001`

**Context and scope:** Select the event encoder for the Structured-Belief Policy Agent. This is an ablation inside product design one.

**Definition of done:**

- Both variants use matched data, seeds, parameter tolerance, objectives, and evaluation schedules.
- The report covers game strength, calibration, samples/second, browser p50/p95, cold start, memory, and artifact size.
- The result records one selection or an explicit inconclusive outcome.

**Testing plan:** Comparison-budget validator; rerunnable reduced study; report generated only from immutable manifests; statistical interval checks.

## Evaluation and population training

### EVAL-001: Matched-deal evaluation and tactical harness

**Dependencies:** `EVAL-READY`

**Context and scope:** Add model-specific slices, belief-calibration joins, and ML report views to the canonical harness owned by `V3-EVAL-001`. Do not create another scheduler, tactical fixture format, confidence-interval implementation, or promotion report generator.

**Definition of done:**

- Canonical match/report IDs remain unchanged when model-specific metrics are joined.
- Reports add belief calibration, auxiliary-head quality, model latency, and artifact identity by relevant ruleset and partnership slice.
- Redeals, invalid actions, fallback, timeout, and inference failures retain the canonical harness semantics.

**Testing plan:** Identical-agent seat symmetry; zero-sum aggregation; deterministic matched deals; known solved-endgame and tactical results; injected runner failures; report-schema validation.

### POP-001: Versioned population registry and scheduler

**Dependencies:** `TRAIN-003`, `EVAL-001`

**Context and scope:** Register immutable checkpoints, legal-random, heuristics, selected search agents, and capped legacy adapters. Sample partners and opponents independently.

**Definition of done:**

- Each member has immutable artifact hashes, schema compatibility, style tags, and permitted roles/weights.
- Schedules are deterministic from a manifest and cover cross-play and stranger-partner assignments.
- Missing or incompatible artifacts fail rather than falling back.

**Testing plan:** Manifest validation; deterministic schedules; independent teammate/opponent distributions; mixture-cap enforcement; unavailable-artifact failure; cross-play coverage test.

### POP-002: Population and co-play training

**Dependencies:** `POP-001`, `TRAIN-003`

**Context and scope:** Train partnership robustness against checkpoint history, heuristics, deliberately different styles, and limited legacy behavior.

**Definition of done:**

- Partners and opponents vary independently.
- Natural and rare-phase training mixtures are recorded separately from evaluation distributions.
- Promotion uses cross-play, held-out partner evaluation, and worst-partner constraints, not self-play Elo alone.
- Population retention and replacement rules prevent unbounded growth.
- Non-transitive cycling detection is applied to evaluate skill progression.
- PSRO and NFSP are supported as optional ablations.

**Testing plan:** Sampling-distribution tests; frozen-opponent integrity; deterministic reduced league; promotion rejection on stranger-partner regression; retention-limit test.

## Export and first product agent

### DEPLOY-001: ONNX export, manifest, and numerical parity

**Dependencies:** `TRAIN-003`

**Context and scope:** Export policy, value, and learned belief components with checksummed manifests and strict compatibility validation.

**Definition of done:**

- Manifest pins engine/rules/observation/action schemas, architecture, runtime/opset, training run, data, checksums, and evaluation report.
- PyTorch and ONNX outputs match declared tolerances across representative phases and sequence lengths.
- Quantized/FP16 variants are distinct artifacts and cannot replace reference exports silently.

**Testing plan:** Cross-runtime logits/value/likelihood parity; dynamic batch/sequence dimensions; incompatible manifest/opset rejection; checksum failure; quantized tactical/calibration comparison.

### DEPLOY-002: Browser policy and belief worker

**Dependencies:** `DEPLOY-001`, `RUNNER-READY`, `V3-WEB-001`

**Context and scope:** Load and execute the Structured-Belief Policy Agent in a Web Worker without assuming threaded WASM or cross-origin isolation.

**Definition of done:**

- Validates manifest and checksums before inference.
- Supports cancellation, explicit failure, model disposal, and deterministic configured fallback in user play only.
- Records cold start, p50/p95 decision latency, peak memory, and artifact bytes.

**Testing plan:** Chromium and WebKit; mobile viewport/device profile; repeated load/dispose; malformed artifact and incompatible schema; deterministic fixture actions; main-thread responsiveness.

### AGENT-001: Structured-Belief Policy Agent release

**Dependencies:** `MODEL-005`, `POP-002`, `DEPLOY-002`

**Context and scope:** Assemble product design one from the selected event encoder, policy/value heads, and structured belief model.

**Definition of done:**

- Handles every decision phase through `AgentV3`.
- Manifest declares `native`, `compatible`, and `unsupported` ruleset coverage based on evidence.
- Passes legality, replay/parity, tactical, calibration, cross-play, stranger-partner, browser, and artifact gates.
- Release report names the exact policy, belief, data, population, and evaluation artifacts.

**Testing plan:** Full runner conformance; all-phase fixtures; incompatible-manifest rejection; fixed replay; browser smoke suite; promotion report reproducibility.

## Belief-aware search

### SEARCH-001: Uniform constrained PIMC simple determinization baseline

**Dependencies:** `AGENT-001`, `BEL-001`

**Context and scope:** Establish a simple determinization baseline and exercise engine clone/apply/undo. It is affected by strategy fusion.

**Definition of done:**

- Samples only feasible worlds, evaluates legal root actions, and aggregates under deterministic node/sample budgets.
- Diagnostics expose sampled worlds, values, and the method's information assumptions.
- Search never mutates authoritative root state.

**Testing plan:** Solved endgames; deterministic budgets; branch-isolation property test; legal-root-action invariant; uniform-sampling sanity checks.

### SEARCH-002: Policy-weighted PIMC and EPIMC ablation

**Dependencies:** `SEARCH-001`, `POP-001`

**Context and scope:** Reweight feasible worlds using observed-action likelihood under population policies and implement a documented postponed-reasoning aggregation baseline.

**Definition of done:**

- Uses stable log weights and reports effective sample size.
- Equal likelihoods reproduce uniform PIMC.
- Low-ESS behavior is explicit and deterministic.
- The report continues to label strategy-fusion limitations.

**Testing plan:** Weight normalization and underflow; uniform equivalence; low-ESS fallback; tactical fixtures; deterministic node/sample budgets.

### SEARCH-003: Belief rollout search (primary search architecture)

**Dependencies:** `AGENT-001`, `BEL-001`, `POP-001`

**Context and scope:** Implement the primary search architecture using "Root-action Monte Carlo evaluation over belief particles with fixed rollout policies" operational flow:
1. Sample particles (feasible hidden worlds).
2. Enumerate legal root actions.
3. For each root action, use common particles.
4. Apply action.
5. Rollout all players with fixed policies.
6. Aggregate terminal utility for each root action.
7. Report uncertainty.

Policy/style identity is sampled or assigned from the population, and every simulated actor receives only its own hand, legitimate private memory, and public history.

**Definition of done:**

- Actor observations are projected at every node; no rollout policy receives root hidden state.
- Particle ancestry, re-determinization, contradictions, and effective sample size are traceable.
- The implementation documents whether and when histories can become globally inconsistent.

**Testing plan:** Instrumented no-leakage assertions; per-node observation equality; impossible-history detection; solved imperfect-information toy games; deterministic budgets; style-mixture tests.

### SEARCH-004: GO-MCTS and generative observation-space search (Experimental)

**Dependencies:** `AGENT-001`, `DATA-001`

**Context and scope:** Move GO-MCTS and observation-space generative search to a later experimental phase. Train a compact model of future legal observations/actions and evaluate root decisions without exposing complete sampled worlds to simulated actors.

**Definition of done:**

- The dynamics model is conditioned only on the acting information state and policy/style context.
- Generated sequences report legality and engine-consistency rates.
- Root search has deterministic compute budgets and full trace diagnostics.
- The prototype is not production-selected without measured gains over simpler methods.

**Testing plan:** Teacher-forced prediction; generated legality/consistency; impossible-event rejection; deterministic sampling; toy-game recovery; held-out rules/phase slices.

### SEARCH-005: Search comparison and production selection

**Dependencies:** `SEARCH-001`, `SEARCH-002`, `SEARCH-003`, `SEARCH-004`, `EVAL-001`

**Context and scope:** Compare no search and every implemented hierarchy level using the same learned checkpoint and compute accounting.

**Definition of done:**

- Reports natural, rare-phase, tactical, cross-play, stranger-partner, nodes/second, model calls, memory, and p50/p95 latency.
- Trace audit proves actor-observation correctness for any serious candidate.
- Selects a method and trigger set or records that no live search qualifies.
- Aggregate strength cannot override a leakage or consistency failure.

**Testing plan:** Equal-budget enforcement; deterministic reduced matrix; confidence-interval checks; trace audit; trigger boundary tests; critical-slice regression thresholds.

## Distillation and second product agent

### DISTILL-001: Search-target dataset generator

**Dependencies:** `SEARCH-005`

**Context and scope:** Convert selected, valid search decisions into reproducible supervised targets without adding determinizations or latent worlds to student inputs.

**Definition of done:**

- Records root observation, legal mask, policy prior, search action/value targets, search identity/budget, population context, and consistency diagnostics.
- Failed, leaked, inconsistent, or low-quality searches are excluded by explicit reasons.
- Shards and manifests are reproducible and checksummed.

**Testing plan:** Search replay regeneration; legal-target normalization; deterministic shards; checksum/manifest validation; static proof that student inputs contain no latent world.

### DISTILL-002: Optional search distillation and validation

**Dependencies:** `DISTILL-001`, `TRAIN-003`, `POP-002`

**Context and scope:** Make search distillation optional and promotion-gated. Fine-tune policy/value outputs toward selected search targets while retaining natural-play calibration and co-play robustness. Evaluate search distillation by tactical regret, not global KL divergence.

**Definition of done:**

- Search distillation is an optional phase gated by teacher-quality and student-fidelity.
- Search loss weights and source budgets are explicit.
- Evaluation compares pre/post tactical strength (measuring tactical regret), natural game points, belief calibration, cross-play, stranger-partner, latency, and artifact size.
- The candidate is rejected for inherited convention, leakage, or critical-slice regressions.

**Testing plan:** Tiny overfit; zero-search-weight equivalence; legal masked target loss evaluated by tactical regret; held-out search states; stranger-partner promotion gate; calibration regression test.

### DEPLOY-003: Selective browser search worker

**Dependencies:** `SEARCH-005`, `DEPLOY-002`

**Context and scope:** Run the selected search only on approved trigger states using a separate worker. Evaluation uses deterministic budgets; interactive play uses deadlines and cancellation.

**Definition of done:**

- Exposes trigger reason, nodes/samples, model calls, elapsed time, and fallback reason.
- Deadline or worker failure returns the policy action explicitly and is observable.
- Search cannot block the main thread or mutate production engine state.

**Testing plan:** Cancellation/deadline injection; worker lifecycle and memory; policy-only equivalence when disabled; branch isolation; browser latency; fallback telemetry.

### AGENT-002: Distilled Policy and Search Teacher release

**Dependencies:** `SEARCH-005`, `DISTILL-002`, `DEPLOY-003`

**Context and scope:** Assemble product design two from the same structured-belief core, the offline rollout policy improver, and the distilled policy.

**Definition of done:**

- Manifest states whether live search is enabled as an optional hybrid and pins its triggers, budgets, population model, and distilled checkpoint.
- Passes complete legality, observation-correctness, tactical, calibration, cross-play, stranger-partner, browser, and artifact gates against `AGENT-001`.
- If optional live hybrid search adds insufficient incremental value or fails profiling, the release is the distilled policy and search remains an offline teacher.

**Testing plan:** Policy-only fallback; deterministic fixed-budget replay; full action surface; selected-search trace audit; browser conformance; incompatible artifact rejection; reproducible promotion report.

## Parallel execution lanes

The following work can proceed concurrently without overlapping ownership:

1. After the engine gates: `ML-001`, `ML-002`, `ML-003`, `BEL-001`, and `EVAL-001`.
2. After the encoding contracts: `DATA-001`, `TRAIN-001`, and `MODEL-001`.
3. After the shared model contract: `MODEL-002`, `MODEL-003`, and `MODEL-004`; belief-oracle work proceeds independently.
4. After the first product release: `SEARCH-001`, `SEARCH-003`, and `SEARCH-004`; `SEARCH-002` follows the small PIMC interface but does not block the serious candidates.
5. After search selection: `DISTILL-001` and `DEPLOY-003`.

Each task is intended to fit one medium-effort implementation agent with no context beyond this backlog, the V3 design, and completed dependency artifacts.
