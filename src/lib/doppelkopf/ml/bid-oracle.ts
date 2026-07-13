import {
  createEngine,
  legalMoves,
  reduce,
  legalAnnouncements,
} from "../engine";
import {
  pickBotCard as pickHeuristic,
  pickBotSolo,
  pickBotPovertyAcceptance,
  pickHeuristicPovertyExchange,
} from "../bot";
import { getMetaActionIndex } from "./canonical-cards";
import type { Card, EngineStep, GameAction, Seat, SoloType } from "../types";
import type { Ruleset } from "../ruleset";
import { isTrump, SUIT_RANK_POWER, trumpPower, countTrumps } from "../rules";
import { rulesetStandard } from "../ruleset";

type BidChoice =
  | { meta: "Pass"; action: Extract<GameAction, { type: "PassSolo" }> }
  | { meta: "ThrowCards"; action: Extract<GameAction, { type: "ThrowCards" }> }
  | {
      meta: `Solo:${SoloType}`;
      action: Extract<GameAction, { type: "ChooseSolo" }>;
    };

function cloneState<T>(obj: T): T {
  // Node supports structuredClone; it correctly preserves Set.
  // eslint-disable-next-line no-undef
  return structuredClone(obj);
}

function canThrowCards(hand: { rank: string }[]): boolean {
  const kings = hand.filter((c) => c.rank === "K").length;
  const nines = hand.filter((c) => c.rank === "9").length;
  return kings >= 5 || kings + nines >= 8;
}

function canMarriage(hand: { suit: string; rank: string }[]): boolean {
  const qclubs = hand.filter(
    (c) => c.suit === "clubs" && c.rank === "Q",
  ).length;
  return qclubs === 2;
}

function canPoverty(hand: Card[], ruleset: Ruleset): boolean {
  return countTrumps(hand, null, ruleset) <= 3;
}

export function enumerateBidChoices(
  step: EngineStep,
  seat: Seat,
  ruleset: Ruleset,
): BidChoice[] {
  if (step.state.phase !== "solo_selection") return [];
  if (ruleset.solo.mode === "disabled") return [];

  const choices: BidChoice[] = [
    { meta: "Pass", action: { type: "PassSolo", seat } },
  ];

  const hand = step.state.hands[seat];

  if (ruleset.schmeissen && canThrowCards(hand)) {
    choices.push({ meta: "ThrowCards", action: { type: "ThrowCards", seat } });
  }

  // Marriage/Poverty are not solos, but are triggered via the same bid action.
  if (canMarriage(hand)) {
    choices.push({
      meta: "Solo:marriage",
      action: { type: "ChooseSolo", seat, soloType: "marriage" },
    });
  }
  if (canPoverty(hand, ruleset)) {
    choices.push({
      meta: "Solo:poverty",
      action: { type: "ChooseSolo", seat, soloType: "poverty" },
    });
  }

  const soloTypes: SoloType[] = [
    "queen_jack",
    "queen",
    "jack",
    "fleischlos",
    "clubs",
    "spades",
    "hearts",
    "diamonds",
  ];
  for (const soloType of soloTypes) {
    if (!ruleset.solo.allowed.includes(soloType)) continue;
    choices.push({
      meta: `Solo:${soloType}`,
      action: { type: "ChooseSolo", seat, soloType },
    });
  }

  return choices;
}

function scoreForSeat(finalStep: EngineStep, seat: Seat): number {
  const team = finalStep.state.teamBySeat[seat];
  const scoreTeam =
    team === "re"
      ? (finalStep.state.scoreRe?.gamePoints ?? 0)
      : (finalStep.state.scoreKontra?.gamePoints ?? 0);
  const scoreOpp =
    team === "re"
      ? (finalStep.state.scoreKontra?.gamePoints ?? 0)
      : (finalStep.state.scoreRe?.gamePoints ?? 0);
  return scoreTeam - scoreOpp;
}

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rolloutToEnd(
  initial: EngineStep,
  ruleset: Ruleset,
  epsilon: number,
  rng: () => number,
): EngineStep {
  let step = initial;
  let loopGuard = 0;
  const MAX = 800;

  while (!step.state.finished && loopGuard < MAX) {
    loopGuard += 1;

    const seat =
      step.state.phase === "solo_selection"
        ? step.state.soloSelection.currentSeat
        : step.state.currentSeat;
    const view = {
      seat,
      phase: step.state.phase,
      hand: step.state.hands[seat],
      currentTrick: step.state.trick,
      completedTricks: step.state.completedTricks,
      legalCards: step.state.hands[seat],
      trickIndex: step.state.trickIndex,
      gameMode: step.state.gameMode,
      announcements: step.state.announcements,
      specialCallouts: step.state.specialCallouts,
      schweineActiveSeat: step.state.schweineActiveSeat,
      ruleset,
    };

    if (step.state.phase === "solo_selection") {
      const soloType = pickBotSolo(view);
      if (soloType === "throw") {
        step = reduce(step.state, { type: "ThrowCards", seat }, ruleset);
      } else if (soloType) {
        step = reduce(
          step.state,
          { type: "ChooseSolo", seat, soloType: soloType as any },
          ruleset,
        );
      } else {
        step = reduce(step.state, { type: "PassSolo", seat }, ruleset);
      }
      continue;
    }

    if (step.state.phase === "poverty_acceptance") {
      step = reduce(step.state, pickBotPovertyAcceptance(view), ruleset);
      continue;
    }

    if (step.state.phase === "poverty_exchange") {
      const mode = step.state.gameMode;
      if (mode.kind === "poverty" && mode.acceptedBySeat !== null) {
        step = reduce(
          step.state,
          pickHeuristicPovertyExchange(
            step.state.hands,
            mode.povertySeat,
            mode.acceptedBySeat,
            mode,
            step.state.schweineActiveSeat,
            ruleset,
          ),
          ruleset,
        );
        continue;
      }
    }

    // Playing
    const legalIds = legalMoves(step.state, seat, ruleset);
    if (legalIds.length === 0) break;

    const legalDecls = legalAnnouncements(step.state, seat, ruleset);
    if (legalDecls.length > 0 && rng() < 0.15) {
      const decl = legalDecls[Math.floor(rng() * legalDecls.length)]!;
      step = reduce(
        step.state,
        { type: "Announce", seat, declaration: decl },
        ruleset,
      );
      view.announcements = step.state.announcements; // Update view
    }

    let cardId = legalIds[0];
    if (rng() < epsilon) {
      cardId = legalIds[Math.floor(rng() * legalIds.length)]!;
    } else {
      const legalCards = step.state.hands[seat].filter((c) =>
        legalIds.includes(c.id),
      );
      cardId = pickHeuristic({ ...view, legalCards } as any);
    }

    step = reduce(step.state, { type: "PlayCard", seat, cardId }, ruleset);

    if (step.events.some((e) => e.type === "RedealRequired")) {
      break;
    }
  }

  return step;
}

export function oracleBidSample(
  seed: number,
  ruleset: Ruleset,
  featurizeFn: (view: any) => Float32Array | number[],
  kRollouts: number = 3,
  epsilon: number = 0.05,
): { samples: any[] } {
  let step = createEngine(seed, ruleset);
  const samples: any[] = [];

  while (step.state.phase === "solo_selection") {
    const seat = step.state.soloSelection.currentSeat;
    const choices = enumerateBidChoices(step, seat, ruleset);
    if (choices.length === 0) {
      step = reduce(step.state, { type: "PassSolo", seat }, ruleset);
      continue;
    }

    const view = {
      seat,
      phase: step.state.phase,
      hand: step.state.hands[seat],
      currentTrick: step.state.trick,
      completedTricks: step.state.completedTricks,
      legalCards: step.state.hands[seat],
      trickIndex: step.state.trickIndex,
      gameMode: step.state.gameMode,
      announcements: step.state.announcements,
      specialCallouts: step.state.specialCallouts,
      schweineActiveSeat: step.state.schweineActiveSeat,
      ruleset,
    };
    const features = featurizeFn(view);

    const values: number[] = [];
    for (const choice of choices) {
      let total = 0;
      for (let i = 0; i < kRollouts; i += 1) {
        const cloned = cloneState(step.state);
        // Use a sub-seed for each rollout to keep them different but deterministic
        const rolloutRng = mulberry32(seed + i * 100);
        const after = reduce(cloned as any, choice.action as any, ruleset);
        const finished = rolloutToEnd(after, ruleset, epsilon, rolloutRng);
        total += scoreForSeat(finished, seat);
      }
      values.push(total / kRollouts);
    }

    let bestIdx = 0;
    for (let i = 1; i < values.length; i += 1) {
      if (values[i]! > values[bestIdx]!) bestIdx = i;
    }
    const best = choices[bestIdx]!;

    const outIdx = getMetaActionIndex(best.meta);
    samples.push({
      type: 1,
      seed,
      seat,
      input: Array.from(features),
      output: outIdx,
      candidates: choices.map((c) => c.meta),
      values,
    });

    // Advance the actual game using the oracle's best choice.
    step = reduce(step.state, best.action as any, ruleset);
  }

  return { samples };
}
