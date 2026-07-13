import { expect, test } from "@playwright/test";
import { createEngine, publicTeamBySeat } from "../src/lib/doppelkopf/engine";
import { rulesetStandard } from "../src/lib/doppelkopf/ruleset";
import {
  computeHardPrivateTeamsFromView,
  computeHardTeamEvidence,
} from "../src/lib/doppelkopf/team-evidence";
import type { Card, Seat } from "../src/lib/doppelkopf/types";

function qclubs(copy: 0 | 1): Card {
  return { id: `clubs-Q-${copy}`, suit: "clubs", rank: "Q", copy };
}

test.describe("Team Evidence", () => {
  test("reveals Re immediately when one Q♣ is publicly played in normal game", () => {
    const { state } = createEngine(12345, rulesetStandard());
    state.gameMode = { kind: "normal" };
    state.trick = [{ seat: 2, card: qclubs(0), wasLegal: true }];
    state.completedTricks = [];

    const publicTeams = publicTeamBySeat(state);
    expect(publicTeams[2]).toBe("re");
    expect(publicTeams[0]).toBe("unknown");
    expect(publicTeams[1]).toBe("unknown");
    expect(publicTeams[3]).toBe("unknown");
  });

  test("reveals full teams when both Q♣ are publicly played by different seats", () => {
    const { state } = createEngine(54321, rulesetStandard());
    state.gameMode = { kind: "normal" };
    state.completedTricks = [
      {
        index: 1,
        winner: 0,
        points: 0,
        plays: [
          { seat: 1, card: qclubs(0), wasLegal: true },
          { seat: 2, card: qclubs(1), wasLegal: true },
        ],
      },
    ];
    state.trick = [];

    const publicTeams = publicTeamBySeat(state);
    expect(publicTeams[1]).toBe("re");
    expect(publicTeams[2]).toBe("re");
    expect(publicTeams[0]).toBe("kontra");
    expect(publicTeams[3]).toBe("kontra");
  });

  test("reveals silent marriage when both Q♣ are publicly played by one seat", () => {
    const { state } = createEngine(98765, rulesetStandard());
    state.gameMode = { kind: "normal" };
    state.completedTricks = [
      {
        index: 1,
        winner: 0,
        points: 0,
        plays: [{ seat: 3, card: qclubs(0), wasLegal: true }],
      },
      {
        index: 2,
        winner: 0,
        points: 0,
        plays: [{ seat: 3, card: qclubs(1), wasLegal: true }],
      },
    ];
    state.trick = [];

    const publicTeams = publicTeamBySeat(state);
    expect(publicTeams[3]).toBe("re");
    expect(publicTeams[0]).toBe("kontra");
    expect(publicTeams[1]).toBe("kontra");
    expect(publicTeams[2]).toBe("kontra");
  });

  test("does not apply Q♣ normal-game inference in poverty mode", () => {
    const { state } = createEngine(11223, rulesetStandard());
    state.gameMode = {
      kind: "poverty",
      povertySeat: 0,
      acceptedBySeat: null,
      exchangeCompleted: false,
    };
    state.completedTricks = [];
    state.trick = [{ seat: 2, card: qclubs(0), wasLegal: true }];

    const publicTeams = publicTeamBySeat(state);
    expect(publicTeams[0]).toBe("re");
    expect(publicTeams[2]).toBe("unknown");
    expect(publicTeams[1]).toBe("unknown");
    expect(publicTeams[3]).toBe("unknown");
  });

  test("private team evidence only marks viewer seat from own hand", () => {
    const base = {
      seat: 0 as Seat,
      gameMode: { kind: "normal" as const },
    };
    const noQueen = computeHardPrivateTeamsFromView({
      ...base,
      hand: [
        { id: "spades-A-0", suit: "spades", rank: "A", copy: 0 },
        { id: "hearts-A-0", suit: "hearts", rank: "A", copy: 0 },
      ],
    });
    expect(noQueen[0]).toBe("kontra");
    expect(noQueen[1]).toBe("unknown");
    expect(noQueen[2]).toBe("unknown");
    expect(noQueen[3]).toBe("unknown");

    const oneQueen = computeHardTeamEvidence({
      ...base,
      hand: [qclubs(0)],
      currentTrick: [],
      completedTricks: [],
      announcements: [],
    });
    expect(oneQueen.private[0]).toBe("re");
    expect(oneQueen.private[1]).toBe("unknown");
    expect(oneQueen.private[2]).toBe("unknown");
    expect(oneQueen.private[3]).toBe("unknown");
  });
});
