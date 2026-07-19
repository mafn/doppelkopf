# Doppelkopf Agent V3: Engine and Agent Design

Status: draft for implementation  
Scope: the reusable Doppelkopf engine, headless simulation, bots, training, evaluation, and browser inference

## Ambitions

- **Product success: a fun Doppelkopf bot.** It must be fast, plausible, and fun for human partners and opponents.
- **Research success: improve population-robust expected utility and approximate best-response resistance on a frozen certified ruleset.** Equilibrium-oriented claims are restricted to reduced games where the relevant metric can be computed.

## Executive decision

The next generation is not a larger card-ranking network. It is a complete agent built around one certified imperfect-information game interface:

```text
authoritative state
  -> observationFor(seat)
  -> legalActionsFor(seat)
  -> agent.decide(observation, legalActions)
  -> transition(action)
  -> public/private events and per-seat terminal utility
```

The same interface must be used by the browser, heuristics, self-play, search, replay, and evaluation. The policy optimizes terminal per-seat game points. It does not receive a dense reward for taking tricks or card points.

We evaluate three agent configurations:

1. **Deployment candidate A: Model-Free Policy Agent:** a compact rule-conditioned hand-set plus public-event model with policy/value heads. It reconstructs an implicit belief representation from the complete visible event history on every decision, removing hidden runtime state logic. A matched GRU-versus-small-transformer encoder ablation selects its event encoder. This is a fully eligible low-latency production candidate.
2. **Deployment candidate B split:**
   - **Offline rollout policy improver**: An operator estimating Q under a fixed population prior and fixed continuation policies. For each root action, use common particles, apply action, rollout all players with fixed policies, aggregate terminal utility.
   - **Distilled policy**: The learned policy distilled from the offline rollout policy improver.
   - **Optional live hybrid**: Only deployed if profiling allows.
3. **Research ablation: Policy Agent with explicit belief features/sampling but no search:** the baseline model augmented with a pack-certified constraint-satisfying feasible-world sampler with optional approximate behavioral reweighting.

The engine is a greenfield replacement. Existing code and checkpoints may be used as test evidence or deliberately weak population members, but they do not constrain the new state model, action schema, or training format.

## Why V3 is necessary

The research report diagnoses structural failures rather than a lack of model capacity:

- local trick rewards teach selfish point capture, partner overtrumping, and premature use of control cards;
- isolated self-play produces private conventions that fail with unfamiliar partners;
- manually assembled observations and phase-specific dispatchers make training and production different games;
- Hochzeit, Armut, announcements, and endgames are too rare to learn reliably at their natural frequency;
- self-play Elo can improve while partnership quality gets worse.

The current implementation also has correctness problems that invalidate a clean continuation of the existing PPO line:

- PPO records from different seats are interleaved and treated as single trajectories, crossing players and teams;
- partnership targets are written in absolute-seat order but trained as self-relative targets;
- announcement imitation contains positive actions without the corresponding `Pass` decisions;
- the last-trick Dulle exception is off by one and the Karlchen check is unreachable;
- poverty acceptance does not fully enforce phase/turn order, and a rejected poverty exchange can partially mutate a hand;
- full rules objects are hashed on every transition instead of binding to a `rulesetHash`, and rules are supplied again on every reducer call instead of being bound to the hand;
- bot views are assembled in several places and poverty exchange logic receives all four hands;
- replay serialization does not faithfully encode `Set` values and does not bind rules, dealer, or engine schema.

Existing PPO checkpoints are therefore legacy behavior sources, not valid starting points for V3 training or authoritative strength benchmarks.

## Goals

1. Make engine correctness, legality, information boundaries, and replay testable contracts.
2. Expose every decision through one phase-complete agent API.
3. Optimize final party settlement while learning calibrated beliefs about teams and cards.
4. Produce agents that cooperate with policies outside their own training run.
5. The engine architecture supports expansion across the documented catalog. V3.0 certifies one primary pack. Every additional pack requires its own conformance fixtures and certification.
6. Train rare contracts deliberately while evaluating on both natural and stratified distributions.
7. Keep browser inference practical through ONNX Runtime Web and explicit latency, memory, and bundle budgets.
8. Preserve selected legacy table behavior through locked rules and legacy-agent adapters.
9. Keep Classic, Oblivious, and Tournament as UI adapters with optional settings presets over one engine and controller.

## Non-goals

- ReBeL-style public-belief equilibrium solving in the first implementation.
- An LLM in the move-selection path.
- Supporting undocumented rules or arbitrary executable rule plugins.
- Preserving old feature vectors, rollout files, or checkpoint compatibility in the V3 core.
- Treating UI callouts, animation events, or localized text as game observations.

## Locked decisions

These decisions apply to the V3 program:

1. **Greenfield core.** The new engine does not preserve the current reducer, `BotView`, feature schemas, or rollout formats.
2. **Engine before training.** No V3 performance claim is valid until the engine certification gate passes.
3. **Broad rules, explicit model coverage.** The engine architecture supports expansion across the documented catalog. V3.0 certifies one primary pack. Every additional pack requires its own conformance fixtures and certification. Each learned model declares the packs and axes on which it was trained.
4. **One full agent.** Card play, reservations, announcements, poverty, and optional rule actions share one public interface even if the model uses internal phase-specific heads.
5. **Terminal utility.** The principal reward is the authoritative settlement for the acting seat.
6. **No hidden execution inputs.** A deployed policy and its search layer receive only the acting seat's observation.
7. **Population evaluation.** Promotion requires cross-play and stranger-partner results, not self-play Elo alone.
8. **Versioned artifacts.** Rules, observations, actions, replays, datasets, and models all carry schema identifiers.
9. **No silent fallback.** Model load or inference failure is recorded explicitly; evaluation never silently substitutes another bot.
10. **Modes do not own rules.** UI modes may choose a named preset, but legality, phases, settlement, observations, and actions remain engine-owned.

## Rule catalog and training coverage

The engine should expose the useful house-rule pool identified by the research. At minimum it must represent:

- 48 cards or 40 cards without nines;
- enabled solos, eligibility, and reservation precedence;
- Hochzeit declaration, clarification trick, finding rule, and unresolved fallback;
- Armut eligibility, acceptance order, exchange count, and team assignment;
- Dulle tie behavior, Schweine, and Superschweine;
- announcement declarations and exact timing semantics;
- scoring specials, Bock, and redeal triggers;
- dealer and opening-seat rotation.

This is a better website product than a single hard-coded ruleset. The important distinction is between **engine support** and **learned-policy support**. The engine architecture supports expansion across the documented catalog. V3.0 certifies one primary pack. Every additional pack requires its own conformance fixtures and certification.

Rules fall into three training-cost classes:

1. **Parametric rules** change comparisons or settlement without changing the phase graph: Dulle tie behavior, scoring specials, and similar toggles. These are relatively cheap to condition on.
2. **Strategic rules** change incentives or information while retaining mostly the same actions: announcement windows, Hochzeit finding rules, reservation precedence, and Schweine. They need explicit embeddings, stratified data, and evaluation slices.
3. **Topological rules** change the deck, phases, private information, or action structure: 40 versus 48 cards, Armut exchange, additional solo families, redeals, and materially different Hochzeit flows. These are expensive and should be trained as named regimes or adapters.

Do not train uniformly over the Cartesian product. Compile a broad rule catalog into a smaller set of curated packs that cover distinct behavioral regimes. Compatibility is empirical, not categorical. Rule conditioning must expose derived mechanics, not just flags. A model manifest declares exact coverage:

- `native`: trained and promotion-tested on this pack;
- `certified-compatible`: differs only on validated parametric axes (after hash evaluation);
- `unsupported`: use a rules/search agent or a separately fine-tuned policy.

Train the first model solely on the primary website pack before expanding. Shared pretraining across packs should transfer card play and belief skills. Small rule adapters or fine-tuned heads can specialize topological regimes. Natural-frequency evaluation remains separate for every public website preset.

The current `standard` ruleset is not precise enough for this catalog. V3 should begin with named, versioned packs such as `website-48-single-hand-v1`, `private-48-armut-v1`, and `private-40-v1`, while allowing the UI to compose only combinations accepted by the rules compiler.

Rule conditioning communicates rule effects; it does not guarantee compositional generalization. Evaluation separates:

1. unseen deals under seen complete configurations;
2. held-out combinations whose individual rule values appeared elsewhere in training;
3. configurations containing a genuinely unseen rule value;
4. named specialist performance on its native pack.

Compare a conditioned shared policy with pack specialists or small specialist adapters using the same data budget. A universal policy earns `compatible` status only through held-out-combination results, never from architectural intent.

## Engine V3

### Implementation substrate

Implement the greenfield rules engine as a framework-independent TypeScript package shared by Node and the browser:

- Astro and browser play import the package directly;
- optional browser search, when enabled, runs in a Web Worker;
- self-play and evaluation use Node worker threads (allow 1/2/4 for CI, keep 32 for release bench);
- **Synchronous ONNX snapshot actors**: The training loop runs as follows: Python freezes policy to ONNX -> Node workers load ONNX -> generate binary trajectories -> return to Python -> update. Do not use JSON IPC per action. Python consumes compact binary trajectories and produces model artifacts rather than reimplementing game rules.

Use exact integer arithmetic, an explicit portable PRNG state, canonical serialization, bitsets/typed arrays where they improve hot paths, and golden replays across Node and supported browsers. Never use `Math.random` or locale-dependent behavior in the engine.

The safe public transition API may return detached state, while the private simulator/search API may use pooled state plus reversible apply/undo. Mutable search state must never escape the engine boundary.

ONNX is used for the learned model and is independent of the engine language. Rust/WASM is a possible measured optimization, not a starting assumption. Benchmark simulation, inference, world sampling, and representative search first. If TypeScript misses a declared target and profiling identifies engine/search execution as the bottleneck, port the complete hot rollout/search loop behind the same contracts; do not introduce per-transition JS/WASM crossings.

The serialized rules format may be YAML or JSON for authoring, but the engine consumes a validated typed `HandRulesetV3` and `SessionRulesetV3`. A rules compiler checks compatibility, derives trump/card ordering, constructs the permitted phase graph, and produces a stable ruleset hash. House rules are declarative data, not arbitrary callbacks.

### Bound game definition and Session Context

A hand is created from an immutable definition and context:

```ts
interface GameDefinitionV3 {
  engineSchema: "doko-engine-v3";
  rulesetId: string;
  rulesetHash: string;
  rules: HandRulesetV3;
}

interface SessionDefinitionV3 {
  sessionSchema: "doko-session-v3";
  sessionId: string;
  sessionRules: SessionRulesetV3;
}

interface SessionStateV3 {
  dealer: Seat;
  scoring: {
    cumulativePoints: Readonly<Record<Seat, number>>;
    activeBockMultipliers: number;
    pendingBockMultipliers: number;
  };
  pflichtsolo: {
    remainingBySeat: Readonly<Record<Seat, number>>;
    handsRemaining: number;
  };
}

interface SessionEngineV3 {
  startNextHand(): HandContextV3;
  finishHand(utility: SeatUtility): void;
}

interface HandContextV3 {
  roundId: string;
  handIndex: number;
  sessionState: SessionStateV3;
}
```

The definition and context are stored with the state. V3.0 agents optimize the current hand only. The first certified pack must be a pure single-hand game to match the hand-local utility objective. Callers cannot switch rules during a hand. Note that the engine receives this full context, while the agent observation receives its legal projection. A hand-local learned policy is not certified as strategically session-aware.

`RulesetV3` must describe game mechanics rather than an experience or UI mode. UI presets may point to a ruleset, but flags such as callout visibility do not belong in engine rules.

### Transition contract

Replace silent mutation/failure with an explicit result:

```ts
type TransitionResult =
  | {
      accepted: true;
      state: GameStateV3;
      publicEvents: readonly PublicGameEvent[];
      privateEvents: Readonly<
        Partial<Record<Seat, readonly PrivateGameEvent[]>>
      >;
    }
  | {
      accepted: false;
      state: GameStateV3;
      reason: IllegalActionReason;
    };
```

Rejected actions must be atomic. Search requires either immutable transitions or an explicit clone/apply discipline whose tests prove branches cannot affect each other.

Development builds should validate invariants after every accepted transition. Production may use a cheaper validation level.

### Complete legal actions

The engine owns `legalActionsFor(state, seat)`. It returns stable, typed actions for the current decision only:

- reservation pass, throw, Hochzeit, Armut, and enabled solos;
- poverty accept/reject;
- poverty offer and return selections;
- announcements and explicit pass. The engine must not spam `Pass`. It only offers decisions when actions lead to genuinely different future rights/information;
- Schweine or other enabled rule actions;
- legal card plays.

Do not fabricate partial `GameState` values to reuse legality helpers. Internal helpers may remain, but every caller outside the engine uses the complete API.

Poverty exchange must be modeled as seat-owned decisions. The poverty player chooses cards from their legal private view; the accepting player chooses return cards from the information the rules permit. No agent receives all hands.

### Per-seat utility

Settlement returns a value for every seat:

```ts
type SeatUtility = Readonly<Record<Seat, number>>;
```

For a 2v2 hand of value `v`, winners receive `+v` and losers `-v`. For a 1v3 hand, the soloist receives `+3v` and each defender `-v`, with signs reversed when the soloist loses. Utilities sum to zero.

Announcement success, thresholds, specials, forfeits, and poverty card provenance must be resolved by one reviewed settlement function. Training must not reconstruct utility from `scoreRe - scoreKontra`.

### Replay envelope

Move from a single final hash to a hash chain:

```ts
interface ReplayStepV3 {
  action: GameActionV3;
  stepHash: string; // H(previousStepHash || canonical(action) || canonical(publicEvents) || saltedPrivateCommitments || rulesetHash || resultingStateHash)
}

interface AuthoritativeGameReplayV3 {
  replaySchema: "doko-authoritative-replay-v3";
  engineVersion: string;
  definition: GameDefinitionV3;
  context: HandContextV3;
  prngStreams: {
    deal: PrngDescriptor;
  };
  steps: readonly ReplayStepV3[];
}

interface PublicRedactedReplayV3 {
  replaySchema: "doko-public-replay-v3";
  engineVersion: string;
  definition: GameDefinitionV3;
  context: HandContextV3;
  prngStreams: {
    deal: PrngDescriptor;
  };
  steps: readonly ReplayStepV3[]; // Private commitments are redacted
}

interface ActionAttemptV3 {
  action: GameActionV3;
  reason: IllegalActionReason;
}

interface AgentDecisionTraceV3 {
  schema: "doko-agent-trace-v3";
  prngStream: PrngDescriptor;
  decisions: readonly {
    observationHash: string;
    actionId: string;
    logits?: readonly number[];
    latencyMs: number;
    actionAttempts: readonly ActionAttemptV3[];
  }[];
}

interface SearchTraceV3 {
  schema: "doko-search-trace-v3";
  prngStreams: {
    worldSampling: PrngDescriptor;
    rollouts: PrngDescriptor;
  };
  // details of MCTS rollouts/particles
}
```

Canonical serialization sorts set-like values and includes all state relevant to rules and future decisions. Replays bind algorithms, session, and versions. Golden replays cover normal play, every solo family, Hochzeit paths, Armut paths, announcements, redeals, and rejected actions.

## Observation contract

### Information layers

The authoritative state contains public, per-seat private, and latent truth. Projection creates a detached immutable observation:

```ts
interface AgentObservationV3 {
  schema: "doko-observation-v3";
  rulesetId: string;
  actor: RelativeSeat; // always self = 0
  decisionId: string; // deterministic: derived from replay ID, index, actor, ordinal
  phase: GamePhaseV3;
  public: PublicObservationV3;
  private: PrivateObservationV3;
}
```

The public portion includes ordered rule events, reservation history, contract state, announcements, dealer/leader/actor, current trick, completed tricks, and publicly established team facts. The private portion includes the player's hand and only that seat's legal private exchange memory.

The observation excludes:

- other hands and true unresolved teams;
- original ownership data not legally known;
- presentation callouts and text;
- full engine objects or mutable array references;
- training labels or search determinizations.

Seats are encoded relative to the actor: self, next, opposite, previous. Observations and legal actions represent identical cards as card-type multiplicities. Stable physical copy IDs exist only in authoritative engine state and replay internals.

### Leakage tests

For two latent states in the same information set, the acting seat must receive identical observations and legal actions. Property tests should shuffle hidden opponent cards while holding public history and the actor's hand fixed, then compare canonical observation hashes.

A privileged critic may see latent truth during training only behind a separately typed `PrivilegedTrainingState`. This is a separate-network ablation. Never share its latent trunk with the deployed actor. Its output must never enter exported actor inputs, inference preprocessing, or search sampling weights at runtime.

## Agent interface

```ts
interface AgentV3 {
  readonly manifest: AgentManifestV3;
  decide(request: DecisionRequestV3): Promise<AgentDecisionV3>;
}

interface DecisionRequestV3 {
  observation: AgentObservationV3;
  legalActions: readonly LegalActionV3[];
  deadlineMs: number;
}

interface AgentDecisionV3 {
  actionId: string;
  logits?: readonly number[];
  diagnostics?: AgentDiagnostics;
}

type PrngAlgorithm = "xoshiro256plusplus-v1" | "chacha8-v1";

interface PrngDescriptor {
  algorithm: PrngAlgorithm;
  initialStateHex: string;
}
```

`AgentRunnerV3` validates the returned ID, records latency and failure type, and applies a deterministic configured fallback only in user-facing play. Training and evaluation treat invalid actions, timeouts, and incompatible artifacts as failures. Remove `randomSeed` from `DecisionRequestV3`. Policies return logits; runner owns PRNG. Use `PrngDescriptor` for portability.

The runner is the only integration point used by UI, simulation, evaluation, and telemetry. A bot name maps to a validated manifest, not an unchecked local-storage string.

The async runner is a product boundary, not the simulation hot loop. Headless training uses a synchronous engine API, batches learned-policy inference across games, and groups trajectories after inference. Search uses deterministic node/sample budgets in evaluation; wall-clock deadlines apply only to interactive play.

### Action representation

Actions have formally canonical schema IDs (independent of object insertion or physical card identity). Card actions reference canonical card types rather than unique physical copy IDs (identical cards do not have a split action space). Action collapsing must respect provenance/settlement (e.g., Armut). Define `actionEquivalenceKey(card, state, rules)`. Small phase choices use enumerated IDs. Combinatorial exchange choices (like Armut) use a dynamic legal-action scorer. Searching all 455 Armut subsets is impractical. Add an action proposal stage: evaluate subsets cheaply with the dynamic scorer, retain top-k plus diverse candidates, and then allocate rollouts to the proposed actions.

The architecture allows a modular agent (shared observation encoder + modules for announcement, card-play, exchange) rather than forcing one monolithic network. It uses dynamic action-feature scoring (`logit(a) = f(o, \\phi(a))`) instead of fixed policy heads. The adapter still exposes a single masked distribution over the engine's legal action IDs for the current decision.

### Agent families

V3 maintains five useful families behind the same interface:

1. `legal-random-v3`: reproducibility and legality sentinel.
2. `heuristic-v3`: card tracker, explicit team hypotheses, trump economy, and deterministic tie-breaking.
3. `model-free-baseline-v3`: compact learned policy/value model. It reconstructs an implicit belief representation from the complete visible event history on every decision, removing hidden runtime state logic.
4. `structured-belief-policy-v3`: the baseline model augmented with a pack-certified constraint-satisfying feasible-world sampler with optional approximate behavioral reweighting.
5. `belief-search-v3`: the learned core plus a measured belief rollout search.

V1, V2, and current heuristic bots remain available through clearly named legacy adapters for comparison only.

Legacy adapters may be useful as the population's "non-partnership player": they expose conventions and tactical mistakes that a robust partner must tolerate. They must not be imitation teachers or dominate the training mixture. Their meta decisions use an explicit deterministic fallback when the old bot only knows card play, and evaluation reports their adapter behavior separately from the original policy.

## Architecture selection

The research report's four pipelines are not four comparable alternatives. Its A and B primarily differ by encoder, C wraps an A/B-like model in planning, and D names a research family without fixing a suitable multiplayer backup rule. Population training, rule conditioning, belief representation, and CTDE are orthogonal choices.

The two product experiments are therefore:

| Design                                                                               | Learned components                                                                                                                | Decision path                                                                        | Purpose                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Deployment candidate A: Model-Free Policy Agent                                      | Rule-conditioned hand-set/event encoder, policy/value heads, and implicit belief auxiliary heads                                  | Masked policy inference                                                              | Primary low-latency browser agent                |
| Deployment candidate B split: Offline rollout policy improver                        | The same core plus population-conditioned rollout models                                                                          | Root-action Monte Carlo evaluation over belief particles with fixed rollout policies | Offline rollout policy improver for distillation |
| Deployment candidate B split: Distilled policy                                       | Distilled policy from the offline rollout policy improver                                                                         | Masked policy inference                                                              | Deployment candidate B                           |
| Deployment candidate B split: Optional live hybrid                                   | The same core plus population-conditioned rollout models                                                                          | Belief rollout search on selected states                                             | Only deployed if profiling allows                |
| Research ablation: Policy Agent with explicit belief features/sampling but no search | The same core plus a pack-certified constraint-satisfying feasible-world sampler with optional approximate behavioral reweighting | Masked policy inference plus bounded belief sampling                                 | Baseline for search and ablations                |

The shared learned core makes the second experiment a clean planning ablation. A simple engineered model is built only if needed to verify the environment and training loop. ReBeL-like equilibrium planning remains outside these two designs: hidden and changing coalitions leave both its guarantees and the correct multiplayer backup semantics unclear.

The experiments use staged or factorial ablations across orthogonal axes without turning each combination into a third product design:

| Axis                | Ablations                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Event encoder       | Matched GRU; small causal transformer                                                    |
| Belief              | Marginal diagnostics only; structured feasible-world model                               |
| Training population | Current policy; checkpoint population; deliberately diverse co-play                      |
| Objective           | Terminal seat utility; terminal utility plus auxiliary tasks; separately audited shaping |
| Planning            | None; PIMC sanity check; policy-weighted/EPIMC; belief/observation-space search          |
| Rule handling       | Pack specialist; conditioned shared policy; specialist adapters                          |
| Partner style       | Unconditioned mixture; policy/style conditioning; online style inference                 |

## Baseline and Structured-Belief Agents

### Target architecture

The target model is compact enough for browser inference but structured for the actual game:

- a 24-card-type count tensor (already permutation invariant) for the private hand multiset, with a Set Transformer as an experimental alternative;
- a GRU or small causal transformer over ordered reservations, announcements, exchanges visible to the actor, and card play;
- explicit rule, phase, contract, seat, trick-position, and legal-action embeddings;
- cross-attention or a fused trunk joining hand, history, and current legal actions;
- dynamic action-feature scoring (`logit(a) = f(o, \\phi(a))`) supporting a modular agent structure;
- per-seat terminal value heads (Deployed actor: scalar acting seat utility; Search: four-seat terminal utility vector internally). The privileged critic is a separate-network ablation that never shares its latent trunk. Note that the value of an observation heavily depends on the continuation population. Require logging the complete policy assignment for every hand, defining a specific deployment prior.

Compare the GRU and small event transformer at matched parameter count, training samples, inference batch, and browser throughput. Attention is justified by the mixed set/sequence structure and cross-component interactions, not by unusually long context. Browser acceptance measures quantized/FP16 artifact size, cold start, peak memory, and mobile Safari behavior. Do not assume threaded WASM or cross-origin isolation.

The policy also exposes diagnostic auxiliary predictions (replacing easy tasks with harder ones):

- final trick winner;
- unseen card locations;
- final contract margin;
- void probability.

These marginals do not constitute the belief model. They must agree with or be derived from the feasible-world distribution described below.

### Later architecture

Only increase transformer depth or add learned observation-space dynamics if ablations identify a capacity or planning-model bottleneck. The hand is unordered; public actions are ordered. The architecture should preserve both facts instead of projecting one large sparse feature vector twice.

## Structured belief and contingent teams

The baseline agent reconstructs an implicit belief representation from the complete visible event history on every decision, removing hidden runtime state logic. For search and ablations, the Structured-Belief Policy Agent models a constraint-complete feasible-world sampler with optional approximate behavioral reweighting. Independent card-location or partner probabilities are diagnostics, not the core belief representation.

Explicit world sampling uses a DP exact constrained sampler rather than a masked autoregressive allocator:

1. begin with remaining card-type counts and exact hidden-hand capacities;
2. mask locations forbidden by known cards, void evidence, rules, and private phase information;
3. sample remaining copies using exact dynamic programming constraints to ensure validity;
4. derive team configurations from each sampled world and the current phase;
5. optionally reweight worlds by the likelihood of observed actions under a population of player policies.

Identical copies are exchangeable. Internally labelled instances may simplify the engine, but belief likelihoods and learned features are invariant under swapping identical copies.

Hochzeit uses contingent team semantics. It requires separating epistemic latent-party belief from the policy-contingent Hochzeit outcome forecast. They are distinct. Before clarification there is no current partner label. The state represents probabilities that each eligible seat becomes partner and that the hand becomes a solo. Realized terminal per-seat utility still propagates through the full trajectory, but the critic never receives the future realized partner as an input and no dense reward treats that seat as an existing teammate. After the clarification trick, observation and beliefs switch to confirmed-party semantics.

The existing hard team evidence and Q-clubs hypotheses are useful constraint inputs, but they require calibration and information-set tests.

## Search program

Search is narrow by default. Trigger candidates include late endgames, expensive control-trump decisions, Hochzeit clarification, and forced contract or special-point lines. At every simulated node, the acting policy receives only that simulated player's observation and legitimate private information. Partner and opponent models include a policy identity or latent style drawn from the population. The first search teacher will use a fixed mixture over rollout policies; posterior style inference is an ablation for later ('unknown style' must be in training).

The 7-step belief rollout search process is strictly "Root-action Monte Carlo evaluation over belief particles with fixed rollout policies":

1. Sample particles (feasible hidden worlds).
2. Enumerate legal root actions.
3. For each root action, use common particles.
4. Apply action.
5. Rollout all players with fixed policies.
6. Aggregate terminal utility for each root action.
7. Fallback to the model-free policy on low confidence.

Evaluate the planning hierarchy rather than selecting an algorithm in advance:

1. no-search Structured-Belief Policy Agent;
2. uniform constrained PIMC as a simple determinization baseline sanity check;
3. policy-weighted PIMC or EPIMC;
4. root-action Monte Carlo evaluation over belief particles with fixed rollout policies;
5. observation-space generative search inspired by GO-MCTS (as a later experiment).

PIMC suffers strategy fusion and nonlocality. Re-determinization reduces actor information leakage but can create globally inconsistent simulated histories. Particle-belief and observation-space methods are more coherent but costlier. The offline rollout policy improver uses root-action rollout, distillation, and optional live search.

Search results must be compared with the no-search policy on tactical fixtures, cross-play, and stranger-partner games. Distilled students are checked for inherited determinization or convention errors.

## Feasibility measurements

Do not estimate training duration before measuring the actual target hardware and pilot learning curves. Record:

| Measurement         | Required output                                                |
| ------------------- | -------------------------------------------------------------- |
| Environment         | Completed hands/s and decisions/s by worker count              |
| Inference           | Decisions/s at representative batch sizes                      |
| Interactive latency | p50/p95 single-decision latency by browser/device              |
| Learner             | Samples/s and optimizer updates/s                              |
| Actor pipeline      | Queue delay, policy lag, and accelerator utilization           |
| Structured belief   | Feasible-world samples/s and effective sample size             |
| Search              | Nodes/s, model calls/s, and p50/p95 time per move              |
| Memory              | Trajectory, replay, model, runtime, and peak browser footprint |

Pilot runs compare old dense reward, terminal utility, terminal utility plus auxiliary tasks, and terminal utility plus warm start. Learning curves estimate the number of decisions required. Wall time is then derived from measured end-to-end throughput.

The selected designs target browser feasibility and must pass the declared browser benchmarks: policy and belief networks export to ONNX Runtime Web; TypeScript engine/belief/search code runs in a worker; expensive search can remain offline and be distilled. A native/WASM optimization is considered only after profiling identifies a concrete hot loop.

## Training system

### Dataset record

Every decision record carries enough provenance to reproduce and group it:

```ts
interface TrajectoryHeaderV3 {
  datasetSchema: "doko-trajectory-v3";
  replayId: string;
  gameId: string;
  rulesetId: string;
  schemas: Record<string, string>;
  policies: Record<Seat, string>;
}

interface VisibleDecisionStepV3 {
  decisionId: string;
  absoluteSeat: Seat;
  visibleEventIndices: readonly number[];
  legalActionIds: readonly string[];
  chosenActionId: string;
  behaviorLogits: readonly number[];
  behaviorLogProbability: number;
  behaviorValue: number;
  policyArtifactId: string;
  terminalReturn: number;
  proposal?: {
    candidateIds: readonly string[];
    scores: readonly number[];
  };
}
```

Sequence batching relies on this event-sourced trajectory model. Use framed records and checksums. Training does not assume PPO/GAE. Files fail closed on schema or record-size mismatch. All current data and PPO rollouts must be regenerated.

### Curriculum

**Stage 0: engine certification**

- freeze the initial ruleset;
- pass transition, scoring, replay, leakage, and invariant suites;
- implement deterministic tactical fixtures and rare-phase generators that generate reachable full histories, not synthetic mid-states, to avoid hidden-state bias.

**Stage 1: fixed baselines**

- freeze legal-random, legacy bots, heuristic-v3, and later search-v3;
- establish matched-deal results with seat rotation;
- prohibit changes to a named baseline without a new version.

**Stage 2: representation and belief pretraining**

- collect every decision point, including `Pass`;
- train marginal diagnostics, trick outcomes, phase recognition, and unresolved-Hochzeit outcome forecasts using simulator-truth auxiliary labels (trick outcome, card-location marginals) rather than relying on a sampler;
- use solved endgames and reviewed human decisions for policy warm starts;
- do not imitate legacy bots as primary policy teachers.

**Stage 3: Model-Free Baseline Agent**

- Compare terminal Monte Carlo action-value learning and PPO actor-critic with an observation-only baseline, where `gamma = 1`. Explicitly add a "Deep Monte Carlo state-action baseline" (DMC) as a mandatory ablation to compare against recurrent PPO, citing DouZero's success with variable-action card games. Select the baseline algorithm using sample efficiency, stability, final strength, calibration and implementation complexity;
- use an actor-centric scalar value prediction for the baseline critic;
- randomize/rotate seats and dealer;
- use entropy and auxiliary losses rather than dense trick-point rewards;
- audit gradients and returns by phase and head.

If shaping is later required, it needs an explicit proof or empirical invariance test. A hand-authored cost for playing high trump is not accepted merely because it suppresses one symptom; it can create a different timid policy.

**Stage 4: rare-phase curriculum**

- explicitly separate data streams into: Natural-distribution (calibrates belief/value), Stratified curriculum (tactical competence), Evaluation, and Fixture;
- correct for curriculum distribution biases to prevent belief corruption;
- oversample ambiguous normal-game partnerships, Hochzeit before/after clarification and fallback, Armut acceptance/exchange/support, announcements, and solved endgames;
- keep natural-frequency evaluation separate from the training mixture;
- advance curriculum stages by scenario mastery, not a fixed number of updates.

**Stage 5: population and co-play**

- train against older checkpoints, both heuristics, search variants, and deliberately different styles;
- vary partners and opponents independently;
- select checkpoints using a focal-agent lineup and worst-slice constraints;
- add non-transitive cycling detection and held-out partner evaluation;
- PSRO and NFSP are considered optional ablations.

**Stage 6: planning ablations and Belief-Search Agent**

- compare the defined search hierarchy with identical policy and belief checkpoints;
- add serious belief/observation-space search only where it produces measured gains;
- optionally distill search targets after the teacher-quality and student-fidelity gates pass;
- retain search at runtime only when its incremental value justifies latency.

## Evaluation and promotion

Evaluation uses the production `AgentRunnerV3` and complete action surface. Redeals are tracked explicitly, not scored as zero-value completed games.

### Core metrics

- mean per-seat game points with confidence intervals;
- win rate and game points by ruleset, contract, phase, seat, and partner policy;
- focal-agent lineup evaluation and summarized cross-play views;
- stranger-partner and worst-partner performance;
- announcement, reservation, and poverty decision value;
- product metrics measuring "fun" (e.g., human partner preference, blunder frequency, rematch intent, predictable mistakes);
- invalid-action, fallback, timeout, and inference-error rates;
- browser p50/p95 decision latency, model bytes, cold start, and peak memory.

### Belief metrics

- Brier score and log loss for team beliefs;
- calibration before and after revealing events;
- feasible-world likelihood, valid-completion rate, sample diversity, and effective sample size;
- card-location accuracy and impossible-world rate;
- unresolved-Hochzeit outcome calibration, separate from present-team semantics;
- trick-owner and remaining-trump calibration.

### Tactical suite

Fixtures must cover:

- smearing onto a probable or known partner;
- avoiding unnecessary partner overtrumps;
- minimal winning trump and top-trump preservation;
- early Dulle and Fox safety;
- Hochzeit clarification choices and immediate post-clarification cooperation;
- Armut acceptance, exchange, and weak-partner support;
- announcement thresholds and contract-margin play;
- exhausted suits, remaining trumps, and solved final tricks;
- Karlchen, Fuchs, Doppelkopf, and ruleset-specific specials.

Each tactical fixture represents an `information-set` (weighted worlds and continuation models) to prevent rewarding clairvoyance in imperfect-information decisions, rather than a single authoritative world. It stores the weighted setups, projected observation, legal actions, acceptable action set or oracle EV ordering, ruleset, and failure category.

### Promotion gate

A candidate is promoted only if it:

1. produces no illegal action in the conformance run;
2. passes replay, observation leakage, and production-parity tests;
3. improves or remains within a declared non-inferiority margin on matched-deal game points;
4. does not regress any critical tactical category beyond its threshold;
5. improves cross-play without a material stranger-partner regression;
6. meets the browser latency and size budget;
7. ships with a complete manifest and reproducible evaluation report.

## Model manifest

Every exported model includes:

- agent and model version;
- observation and action schema versions;
- supported ruleset IDs/hashes and capabilities;
- architecture and feature sizes;
- training dataset/run identifiers;
- checkpoint and ONNX checksums;
- expected ONNX Runtime version;
- evaluation report identifier;
- deterministic fallback policy for user-facing play.

Unknown or incompatible manifests are rejected. Feature-size inference and filename conventions are not version detection.

## Implementation sequence

- **V3.0a**: Certified primary-pack engine (`website-48-single-hand-v1`).
- **V3.0b**: Legacy migration (implement Armut, 40-card, Bock, Pflichtsolo, all legacy presets).
- **V3.1**: Fun early bot (Strong heuristic, followed by heuristic + selective bounded rollouts).
- **V3.2**: Tiny deployable learned bot (Distilled policy from heuristic/search traces).
- **V3.3**: Online RL baseline (Recurrent PPO vs Deep Monte Carlo (DMC) state-action learner).
- **V3.4**: Population robustness (held-out partners, style conditioning).
- **V3.5**: Belief/search upgrade (Offline rollout teacher + distillation).
- **V3.6**: Rule specialists and research search.

## Test strategy

The engine and agent boundary require:

- transition tests for every phase and rejection reason;
- invariants for card uniqueness, hand sizes, 240 eyes, active actor, and non-empty legal decisions;
- atomicity tests for every rejected action;
- ruleset matrix and hand-worked settlement tests;
- canonical serialization and golden replay tests;
- observation information-set and mutation-isolation tests;
- legal-action parity across UI, self-play, search, and evaluation;
- per-seat utility conservation tests;
- feasible-world capacity, multiplicity, void, exchange, and completion tests;
- unresolved-Hochzeit contingent-team tests;
- tactical fixtures and solved endgames;
- dataset grouping, self-relative label, mask, and schema tests;
- ONNX/PyTorch numerical parity and incompatible-manifest tests.

## Research basis

Primary anchors for the selected architecture and research ablations:

- Lee et al., [Set Transformer: A Framework for Attention-based Permutation-Invariant Neural Networks](https://arxiv.org/abs/1810.00825), 2018.
- Rebstock et al., [Policy Based Inference in Trick-Taking Card Games](https://arxiv.org/abs/1905.10911), 2019.
- Goodman, [Re-determinizing Information Set Monte Carlo Tree Search in Hanabi](https://arxiv.org/abs/1902.06075), 2019.
- Rebstock et al., [Transformer Based Planning in the Observation Space with Applications to Trick Taking Card Games](https://arxiv.org/abs/2404.13150), 2024.
- Arjonilla, Saffidine, and Cazenave, [Perfect Information Monte Carlo with Postponing Reasoning](https://arxiv.org/abs/2408.02380), 2024.
- Deutscher Doppelkopf-Verband, [Turnier-Spielregeln, Stand 21 February 2026](https://doko-verband.de/wp-content/uploads/2026/04/Turnierspielregeln-Stand-2026-02-21.pdf).

These sources motivate set encoding, policy-aware inference, actor-correct search, observation-space planning, and PIMC/strategy-fusion ablations. They do not establish Doppelkopf performance in this implementation. Every architecture, rule-transfer, and planning claim remains subject to the measurements and promotion gates above.
