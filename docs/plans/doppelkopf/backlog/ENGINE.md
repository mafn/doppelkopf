## Workstream A: Greenfield Engine

The V3 engine lives under `src/lib/doppelkopf/v3/`. Existing files under `src/lib/doppelkopf/` are legacy evidence only and do not constrain V3 types, state, actions, or behavior. Unit and conformance tests live under `tests/doppelkopf-v3/`. Mandate a fast Node runner for mechanics, settlements, and generated hands. Relegate Playwright *only* to browser parity, Web Worker tests, and ONNX integration.

All tasks use these references:

- Primary design: `docs/plans/doppelkopf/AGENT-V3-DESIGN.md`
- Research basis and stable bibliography: `docs/plans/doppelkopf/AGENT-V3-DESIGN.md`
- Legacy rule notes, as non-authoritative evidence: `docs/doppelkopf/rules.md`

Unsupported or ambiguous rule combinations must fail validation. Tasks must not invent executable `custom` rules or silently select defaults for strategically meaningful axes.

### Dependency Graph

```text
ENG3-001 Contracts
|-- ENG3-002 Canonical codec
|-- ENG3-003 PRNG, cards, and deal
`-- ENG3-004 Rules compiler
    `-- ENG3-005 Card and trick mechanics

ENG3-001..005 -> ENG3-006 Transition kernel
ENG3-006 -> ENG3-007 Reservations and contracts
ENG3-006 -> ENG3-008 Armut
ENG3-006 -> ENG3-009 Trick play and Hochzeit
ENG3-006 -> ENG3-010 Announcements and promotions
ENG3-001,004,005 -> ENG3-011 Settlement
ENG3-007..011 -> ENG3-012 Integrated hand engine
ENG3-004,012 -> ENG3-013A Primary pack (V3.0a)
ENG3-002,012,013A -> ENG3-014A Primary observation, replay, certification (V3.0a)
ENG3-003,012..014A -> ENG3-015A Primary deterministic simulation (V3.0a)

ENG3-013A -> ENG3-013B Extended packs (V3.0b)
ENG3-013B,014A -> ENG3-014B Extended observation, replay, certification (V3.0b)
ENG3-014B,015A -> ENG3-015B Extended deterministic simulation (V3.0b)

ENG3-013B..015B -> ENG3-013C Session engine (V3.0b)
ENG3-013C,014B -> ENG3-014C Session observation, replay, certification (V3.0b)
ENG3-014C,015B -> ENG3-015C Session deterministic simulation (V3.0b)
```

After `ENG3-001`, tasks `002`, `003`, and `004` can proceed concurrently. After `ENG3-006`, tasks `007` through `011` can proceed concurrently because each owns a separate module. `ENG3-012` is the deliberate integration point.

### ENG3-001: Freeze V3 Engine Contracts

**Dependencies:** `V3-INT-001`.

**Context and scope:** Establish append-only public types so later work can proceed without repeatedly editing shared files. `V3-INT-001` owns repository layout, empty module barrels, and root scripts; this task owns all files under `src/lib/doppelkopf/v3/engine/contracts/` and the engine's public exports. We only freeze the core envelope early (seats, schema identifiers, events, etc.). Treat phase-specific contracts as provisional until the primary pack passes certification (V3.0a). Define cards, rules, actions, state, events, settlement, observation, replay, branded schema IDs, `Seat`, canonical card IDs, immutable `GameDefinition`, `HandContextV3`, `PrngDescriptor`, `actionEquivalenceKey`, `ReplayStepV3`, phase-specific state variants, complete actions, legal actions, public/private events, `TransitionResult`, illegal-action reasons, and per-seat utility. Unresolved Hochzeit must be a contingent party state, not a future partner stored as present truth. Duplicate physical copies are preserved internally for determinism/replays, but the agent boundary receives canonical card types to avoid action duplication. Action collapsing must respect provenance/settlement. The agent optimizes hand-local utility in a pure single-hand game.

**Definition of done:** Every phase and action named in the V3 design is represented; exhaustive switches compile; rules are bound through `GameDefinition` and `HandContextV3`; UI text and legacy engine types do not cross the boundary; internal storage optimizations are not frozen into the public contract.

**Testing plan:** Add compile-time exhaustive fixtures for every union, negative type assertions separating observation from authoritative state, and run `npm run check` plus the focused contract tests.

### ENG3-002: Canonical Serialization and Stable Hashing

**Dependencies:** `ENG3-001`.

**Context and scope:** Add `v3/codec/` with canonical encoding and hashing for rules, definitions, states, actions, decisions, and replays. Specify ordering for keys, cards, actions, and set-like collections. Move from a single final hash to a cryptographic hash chain: `stepHash = H(previousStepHash || canonical(action) || canonical(publicEvents) || saltedPrivateCommitments || resultingStateHash)`. Reject functions, cycles, `undefined`, non-finite numbers, and unknown schemas. Use identical UTF-8 bytes and a supported hash implementation in Node and browsers.

**Definition of done:** Semantically identical values produce identical bytes and hashes regardless of insertion order; every decision-relevant mutation changes the hash; encoding is locale-independent; schema mismatches fail closed.

**Testing plan:** Golden byte/hash fixtures, shuffled-key and shuffled-set metamorphic tests, malformed-value rejection, UTF-8 cases, and Node/Chromium/WebKit hash parity.

### ENG3-003: Portable PRNG, Decks, and Deal

**Dependencies:** `ENG3-001`.

**Context and scope:** Add an explicit serializable PRNG. Require distinct PRNG streams for Deal, Policy, World Sampling, and Rollouts. Add unbiased bounded sampling, deterministic shuffle, canonical duplicate-card IDs, 48-card and no-nines 40-card decks, dealing, and dealer/opening-seat helpers. Add validated test-only construction from explicit hands. Engine code must not call `Math.random`.

**Definition of done:** Definition plus seed reproduces byte-identical hands and final PRNG state in supported runtimes; every card occurs exactly once; 48-card hands contain 12 cards and 40-card hands contain 10; malformed fixture deals are rejected.

**Testing plan:** Golden seeds, large deterministic seed sweeps, uniqueness and capacity properties, no-nine assertions, malformed fixtures, and Node/browser shuffle parity.

### ENG3-004: Declarative Rules Compiler

**Dependencies:** `ENG3-001`, `ENG3-002`.

**Context and scope:** Add typed authoring schema, validation, compilation, and derived effects under `v3/rules/`. Cover deck composition, solo families and reservation precedence, Hochzeit, Armut, trump ordering and ties, Schweine/Superschweine, announcements, scoring specials, Bock, redeal triggers, and rotation. Compile to a deeply immutable `RulesetV3` with a stable hash, derived phase capabilities, timing tables, precedence, and trump inputs. Return structured diagnostics for invalid combinations and unknown keys.

**Definition of done:** Compiler output is deterministic and immutable; IDs cannot disagree with hashes; no callbacks or UI flags are accepted; every meaningful axis is explicit; incompatible or unsupported combinations fail closed.

**Testing plan:** Valid/invalid matrix, unknown-key rejection, hash snapshots, mutation attempts, incompatible combination fixtures, and snapshots of derived phase/trump/timing effects.

### ENG3-005: Pure Card, Trump, Follow, and Trick Mechanics

**Dependencies:** `ENG3-001`, `ENG3-004`.

**Context and scope:** Implement pure functions under `v3/cards/` for points, card classification, trump order, follow obligations, legal card filtering, trick comparison, and trick winner. Cover every compiled solo family, normal play, 40/48 decks, Dulle tie modes including the final-trick exception, and active Schweine/Superschweine promotion state.

**Definition of done:** Functions are total, deterministic, and mutation-free; tie and lead semantics are explicit; identical copies are exchangeable apart from canonical identity; callers supply compiled effects and contract context rather than relying on defaults.

**Testing plan:** Table-driven order tests for every contract, exhaustive pair comparisons, follow-suit/trump cases, final-trick Dulle regression, 240-eye totals for full decks, and permutation/metamorphic tests.

### ENG3-006: Atomic Transition Kernel and Initial State

**Dependencies:** `ENG3-001` through `ENG3-005`.

**Context and scope:** Add hand creation, the common transition shell, invariant validation, and a phase-handler interface under `v3/engine/`. Bind the immutable definition and compiled rules, initialize the deal and actor, separate public/private events, and reject wrong-seat, wrong-phase, unknown, and malformed actions explicitly. Support development and production invariant levels.

**Definition of done:** Rejected transitions preserve the canonical state hash and cannot leak partial mutation; accepted branches cannot mutate prior branches; every active state nominates a valid actor; rules cannot change during a hand; phase handlers can be independently injected for tests.

**Testing plan:** Atomicity tests for generic rejection reasons, branch-isolation tests, bound-rules tests, initialization fixtures, and invariant failure diagnostics using controlled faulty test handlers.

### ENG3-007: Reservations, Solos, and Contract Formation

**Dependencies:** `ENG3-006`.

**Context and scope:** Implement `v3/phases/reservations.ts`. Cover explicit pass, all enabled solos, eligibility, Pflicht/Lust behavior, compiled precedence, announced and silent Hochzeit, Armut declaration handoff, and configured Schmeissen/redeal requests. Export only the phase-specific legal-action generator and transition handler.

**Definition of done:** Seats decide in configured order; precedence is deterministic and independent of declaration timing where required; disabled/ineligible actions never appear and are atomically rejected; the result is a typed contract and party state with correct public/private events.

**Testing plan:** Reservation-order permutations, every solo family, two-club-queen cases, throw triggers, all-pass flow, tied precedence, wrong-seat actions, and duplicate decisions.

### ENG3-008: Armut Acceptance and Private Exchange

**Dependencies:** `ENG3-006`.

**Context and scope:** Implement `v3/phases/poverty.ts`. Cover eligibility, configured acceptance order, accept/reject exhaustion, exact offer and return selections, trump-giveaway constraints, card capacities, party assignment, and configured no-acceptance outcome. Actions and events must be seat-owned; no agent-facing object may contain all hands.

**Definition of done:** Acceptance enforces exact phase and actor; invalid exchange selections cannot partially mutate either hand; after exchange each card exists exactly once and hand capacities are restored; private exchange details go only to legally entitled seats.

**Testing plan:** Accept/reject order, no-acceptance variants, duplicate/wrong-owner/short selections, required trumps, rollback regressions, private-event recipients, and 40/48-card cases.

### ENG3-009: Card Play and Hochzeit Clarification

**Dependencies:** `ENG3-006`.

**Context and scope:** Implement `v3/phases/play.ts` and `hochzeit.ts`. Consume legal cards, complete tricks, advance leader/actor, record public void evidence, and terminate at the deck-dependent trick count. Implement every compiled Hochzeit finding rule, clarification boundary, and unresolved fallback without exposing the eventual partner early.

**Definition of done:** Follow obligations are enforced; trick winner leads next; cards remain unique; unresolved Hochzeit has contingent team semantics; clarification or solo/redeal fallback occurs exactly once at the qualifying boundary.

**Testing plan:** Deterministic normal and solo hands, actor rotation, all finding rules, first/last clarification boundaries, no-clarification paths, final trick, card uniqueness, and known Dulle/Hochzeit regression fixtures.

### ENG3-010: Announcements and Trump Promotions

**Dependencies:** `ENG3-006`.

**Context and scope:** Implement `v3/phases/meta-actions.ts`. Cover Re/Kontra and No90/60/30/Schwarz chains, explicit pass whenever a meta decision is offered, compiled timing windows, team eligibility, Hochzeit timing effects, Pflichtansage where supported, and Schweine/Superschweine declaration and activation. Define deterministic interleaving with card play. The engine must not spam `Pass`. It only offers decisions when actions lead to genuinely different future rights/information.

**Definition of done:** Timing derives from compiled rules and remaining cards, not UI clocks; every optional decision includes pass; duplicate/late/wrong-team actions are rejected atomically; promotions affect subsequent comparisons but never completed tricks.

**Testing plan:** 40/48 timing boundaries, announcement chains, both parties announcing, unresolved and resolved Hochzeit, pass progression, duplicate/late actions, and promotion eligibility in every contract family.

### ENG3-011: Authoritative Settlement and Seat Utility

**Dependencies:** `ENG3-001`, `ENG3-004`, `ENG3-005`.

**Context and scope:** Add pure settlement under `v3/scoring/`. Consume terminal facts, compiled rules, contract, realized parties, announcements, trick provenance, and enabled specials. Calculate eyes, winner thresholds, margins, announcement stakes, Absagen/counter-thresholds, Fuchs, Doppelkopf, Karlchen, normal versus solo settlement, and zero-sum `SeatUtility`. Return machine-readable components rather than localized strings.

**Definition of done:** 2v2 winners receive `+v` and losers `-v`; 1v3 settlement gives the soloist `+/-3v` and each defender the opposite `-/+v`; utilities sum to zero; 120:120 behavior is explicit; specials apply only in permitted contracts and use authoritative provenance.

**Testing plan:** Hand-worked score tables across every threshold, successful and failed announcements, counter-thresholds, each special, solo sign reversal, Hochzeit and Armut, disabled toggles, forfeits, and utility-conservation properties.

### ENG3-012: Integrated Hand Engine and Complete Legal Actions

**Dependencies:** `ENG3-007`, `ENG3-008`, `ENG3-009`, `ENG3-010`, `ENG3-011`.

**Context and scope:** Wire phase modules into `v3/engine/hand.ts`, a small registry, and the authoritative `legalActionsFor`. Expose only hand creation, complete legal actions, transition, settlement inspection, and invariant APIs. Integrate terminal and explicit redeal outcomes. Keep phase behavior in owned modules rather than copying it into the registry.

**Definition of done:** A legal-random traversal can finish or explicitly redeal every supported path; every nonterminal decision has at least one stable typed action; callers never fabricate partial state or pass rules separately; settlement executes exactly once.

**Testing plan:** End-to-end seeded hands for every contract, traversal from every phase fixture, action-ID stability, wrong ID/seat/phase atomicity, event ordering, and terminal/redeal behavior.

### ENG3-013A: Primary Rule Pack (V3.0a)

**Dependencies:** `ENG3-004`, `ENG3-012`.

**Context and scope:** Add pinned declarative pack `website-48-single-hand-v1`. Compatibility is empirical, not categorical. Rule conditioning must expose derived mechanics, not just flags.

**Definition of done:** The public pack compiles to a pinned hash and explicitly sets all strategic axes.

**Testing plan:** Pack hash snapshots, pairwise axis comparisons, executable conformance fixtures for all catalog features.

### ENG3-014A: Primary Observation, Replay, and Certification (V3.0a)

**Dependencies:** `ENG3-002`, `ENG3-012`, `ENG3-013A`.

**Context and scope:** Implement detached actor-relative observations, canonical replay recording/execution using a hash chain (`ReplayStepV3`), and the certification suite for the primary pack. Observations include public ordered history plus only the acting seat's hand and legal private exchange memory. Replays bind schema, engine version, complete definition, session context, algorithms, actions, and hash chains. Certification covers invariants, atomicity, information sets, rules, scoring, and known legacy defects for `website-48-single-hand-v1`.

**Definition of done:** Hidden opponent cards, unresolved true teams, future Hochzeit partner, original ownership, and other seats' private events are unreachable from observations; mutation of an observation cannot affect state; replay alone reproduces events, settlement, and final hash; incompatible/corrupt replays fail closed; the certification command reports seeds and action traces on failure.

**Testing plan:** Same-information-set hidden-card swaps must preserve observation and legal-action hashes; relative-seat rotations; unresolved-Hochzeit leakage; mutation isolation; golden replays for all phase families; corruption/reordering tests; thousands of generated hands for the primary pack; permanent regressions.

### ENG3-015A: Primary Deterministic Simulation and Runtime Parity (V3.0a)

**Dependencies:** `ENG3-003`, `ENG3-012..014A`.

**Context and scope:** Add a synchronous legal-random agent, complete headless decision loop, trajectory capture, deterministic worker partitioning, and reproducible Node/browser benchmarks for the primary pack. Measure hands/s and decisions/s by worker count, transition latency, allocation/memory, and representative phase mix. Do not extrapolate training duration.

**Definition of done:** A manifest of seeds yields identical replay hashes and utilities at 1, 8, and 32 workers; empty legal sets and invalid actions are hard failures; canonical replay subsets match in Node, Chromium, Firefox, and WebKit; benchmark reports include raw data, warm-up, runtime, and hardware metadata.

**Testing plan:** Fixed-seed batch goldens, worker-count equivalence, forced rare phases, crash propagation, utility conservation over large runs, cross-browser replay parity, repeated-run variance checks, and a CI-sized benchmark smoke test for the primary pack.

### ENG3-013B: Extended Packs (V3.0b)

**Dependencies:** `ENG3-013A`.

**Context and scope:** Add pinned declarative packs `private-48-armut-v1`, and `private-40-v1`, plus a capability matrix and reviewed deviations from DDV and legacy `standard`. The V3.0 engine must preserve ALL V1/V2 mechanics (Armut, 40-card play, existing solos, Schweine, etc.). Create a legacy migration matrix mapping every V1/V2 preset (e.g., standard, oblivious, tournament) to a V3 ruleset ID, ensuring parity-tested mechanical support in V3.0.

**Definition of done:** Every public pack compiles to a pinned hash and explicitly sets all strategic axes; packs differ only on documented axes; legacy presets are parity-tested against V3 mappings.

**Testing plan:** Pack hash snapshots, pairwise axis comparisons, executable conformance fixtures for all catalog features.

### ENG3-014B: Extended Observation, Replay, and Certification (V3.0b)

**Dependencies:** `ENG3-013B`, `ENG3-014A`.

**Context and scope:** Extend observation, replay, and certification for extended packs.

**Definition of done:** Same as 014A, but for extended packs.

**Testing plan:** Armut privacy; poverty mutation/order, lossy `Set` serialization, and thousands of generated hands per extended pack.

### ENG3-015B: Extended Deterministic Simulation and Runtime Parity (V3.0b)

**Dependencies:** `ENG3-014B`, `ENG3-015A`.

**Context and scope:** Extend simulation and runtime parity for extended packs.

**Definition of done:** Same as 015A, but for extended packs.

**Testing plan:** Fixed-seed batch goldens, worker-count equivalence, all extended packs.

### ENG3-013C: Session Engine (V3.0b)

**Dependencies:** `ENG3-013B..015B`.

**Context and scope:** Add a separate deterministic session layer for dealer/opening-seat rotation, redeals, Bock, and Pflichtsolo. A redeal must not count as a zero-value completed hand.

**Definition of done:** Session state is canonically serializable (including `SessionDefinitionV3`, `SessionStateV3`, and `SessionEngineV3` with cumulative scoring, pflichtsolo, and bock queues); dealer progression is deterministic.

**Testing plan:** Multi-hand golden sessions, repeated redeals, dealer rotation, and serialized resume.

### ENG3-014C: Session Observation, Replay, and Certification (V3.0b)

**Dependencies:** `ENG3-013C`, `ENG3-014B`.

**Context and scope:** Extend observation, replay, and certification for multi-hand sessions.

**Definition of done:** Session replays reproduce full session events, settlement, and final hash.

**Testing plan:** Session replay and certification tests.

### ENG3-015C: Session Deterministic Simulation and Parity (V3.0b)

**Dependencies:** `ENG3-014C`, `ENG3-015B`.

**Context and scope:** Extend simulation and runtime parity for multi-hand sessions.

**Definition of done:** Simulation works across multi-hand sessions.

**Testing plan:** Multi-hand session simulation tests.
