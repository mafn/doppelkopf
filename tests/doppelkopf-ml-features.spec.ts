import { expect, test } from "@playwright/test";

import { createEngine, legalMoves, reduce } from "../src/lib/doppelkopf/engine";
import { rulesetStandard } from "../src/lib/doppelkopf/ruleset";
import {
  FEATURE_SCHEMA_V1,
  FEATURE_SIZE_V1,
} from "../src/lib/doppelkopf/ml/feature-schema";
import { featurizeInternal } from "../src/lib/doppelkopf/ml/featurizer";
import { getCardIndex } from "../src/lib/doppelkopf/ml/canonical-cards";
import { computeQclubsBelief } from "../src/lib/doppelkopf/ml/qclubs-belief";

function advancePastSoloSelection(seed: number) {
  const ruleset = rulesetStandard();
  let step = createEngine(seed, ruleset);
  while (step.state.phase === "solo_selection") {
    const seat = step.state.soloSelection.currentSeat;
    step = reduce(step.state, { type: "PassSolo", seat }, ruleset);
  }
  return { step, ruleset };
}

test("featurizeV1 produces correct length + legal mask", () => {
  const { step, ruleset } = advancePastSoloSelection(123);
  expect(step.state.phase).toBe("playing");

  const seat = step.state.currentSeat;
  const legalIds = legalMoves(step.state, seat, ruleset);
  const legalCards = step.state.hands[seat].filter((c) =>
    legalIds.includes(c.id),
  );

  const view = {
    seat,
    phase: step.state.phase,
    hand: step.state.hands[seat],
    currentTrick: step.state.trick,
    completedTricks: step.state.completedTricks,
    legalCards,
    trickIndex: step.state.trickIndex,
    gameMode: step.state.gameMode,
    announcements: step.state.announcements,
    specialCallouts: step.state.specialCallouts,
    schweineActiveSeat: step.state.schweineActiveSeat,
    ruleset,
  } as const;

  const { features, legalMask } = featurizeInternal(view, FEATURE_SCHEMA_V1);
  expect(features).toHaveLength(FEATURE_SIZE_V1);
  expect(legalMask).toHaveLength(48);

  const legalSet = new Set(legalIds.map((id) => getCardIndex(id)));
  for (let i = 0; i < 48; i += 1) {
    const expected = legalSet.has(i) ? 1 : 0;
    expect(legalMask[i], `legalMask[${i}]`).toBe(expected);
    expect(
      features[FEATURE_SCHEMA_V1.offsets.legalMask.start + i],
      `features[legalMask+${i}]`,
    ).toBe(expected);
  }
});

test("qclubs belief treats forced marriage as 1v3", () => {
  const ruleset = rulesetStandard();
  const holderSeat = 0 as const;
  const state = createEngine(999, ruleset).state;

  const mkView = (seat: 0 | 1 | 2 | 3) => ({
    seat,
    phase: "playing" as const,
    hand: state.hands[seat],
    currentTrick: [],
    completedTricks: [],
    legalCards: state.hands[seat],
    trickIndex: 0,
    gameMode: {
      kind: "marriage" as const,
      holderSeat,
      partnerSeat: null,
      clarificationEndsAtTrick: 3,
      forced: true,
    },
    announcements: [],
    specialCallouts: [],
    schweineActiveSeat: null,
    ruleset,
  });

  const b0 = computeQclubsBelief(mkView(0));
  expect(b0.pRe).toEqual([1, 0, 0, 0]);

  const b1 = computeQclubsBelief(mkView(1));
  // From seat=1, holderSeat=0 is "prev" (rel index 3).
  expect(b1.pRe).toEqual([0, 0, 0, 1]);
});
