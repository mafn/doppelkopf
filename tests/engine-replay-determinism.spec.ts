import { test, expect } from "@playwright/test";
import { createEngine, reduce, legalMoves } from "../src/lib/doppelkopf/engine";
import { rulesetStandard } from "../src/lib/doppelkopf/ruleset";
import type { GameAction } from "../src/lib/doppelkopf/types";

test("engine replay is deterministic", async () => {
  const seed = 12345;
  const ruleset = rulesetStandard();

  // 1. Generate a random game history
  let step = createEngine(seed, ruleset);
  const history: GameAction[] = [];
  let turns = 0;
  while (!step.state.finished && turns < 100) {
    const seat =
      step.state.phase === "solo_selection"
        ? step.state.soloSelection.currentSeat
        : step.state.currentSeat;
    let action: GameAction;
    if (step.state.phase === "solo_selection") {
      action = { type: "PassSolo", seat };
    } else if (step.state.phase === "playing") {
      const legal = legalMoves(step.state, seat, ruleset);
      action = { type: "PlayCard", seat, cardId: legal[0] };
    } else if (step.state.phase === "poverty_acceptance") {
      action = { type: "RejectPoverty", seat };
    } else {
      break;
    }
    history.push(action);
    step = reduce(step.state, action, ruleset);
    turns++;
  }

  const finalState1 = JSON.stringify(step.state);

  // 2. Replay history twice and compare
  const replay = (actions: GameAction[]) => {
    let s = createEngine(seed, ruleset);
    for (const a of actions) {
      s = reduce(s.state, a, ruleset);
    }
    return JSON.stringify(s.state);
  };

  const finalState2 = replay(history);
  const finalState3 = replay(history);

  expect(finalState2).toBe(finalState1);
  expect(finalState3).toBe(finalState1);
});
