import { expect, test } from "@playwright/test";
import { createEngine, reduce, legalMoves } from "../src/lib/doppelkopf/engine";
import { cardPoints } from "../src/lib/doppelkopf/deck";
import { rulesetStandard } from "../src/lib/doppelkopf/ruleset";
import { getTrumpSuit, isTrump, trumpPower } from "../src/lib/doppelkopf/rules";

test.describe("Doppelkopf Engine", () => {
  function advancePastSoloSelection(
    initial: ReturnType<typeof createEngine>,
    ruleset = rulesetStandard(),
  ) {
    let step = initial;
    while (step.state.phase === "solo_selection") {
      step = reduce(
        step.state,
        { type: "PassSolo", seat: step.state.soloSelection.currentSeat },
        ruleset,
      );
    }
    return step;
  }

  function finishStubbedHand(
    state: ReturnType<typeof createEngine>["state"],
    ruleset = rulesetStandard(),
  ) {
    // Force the state into "one trick left" and play four cards to trigger HandFinished.
    state.phase = "playing";
    state.finished = false;
    state.trick = [];
    state.trickIndex = 12;
    state.completedTricks = Array.from({ length: 11 }, (_, i) => ({
      index: i + 1,
      plays: [],
      winner: 0 as const,
      points: 0,
    }));
    state.currentSeat = 0;

    // Use 0-point cards so we don't disturb stubbed totals.
    // Also ensure seats 1–3 can't follow suit, so their off-suit 9s are still legal.
    state.hands[0] = [
      { id: "clubs-9-last-0", suit: "clubs", rank: "9", copy: 0 },
    ];
    state.hands[1] = [
      { id: "spades-9-last-0", suit: "spades", rank: "9", copy: 0 },
    ];
    state.hands[2] = [
      { id: "hearts-9-last-0", suit: "hearts", rank: "9", copy: 0 },
    ];
    state.hands[3] = [
      { id: "spades-9-last-1", suit: "spades", rank: "9", copy: 1 },
    ];

    let step = reduce(
      state,
      { type: "PlayCard", seat: 0, cardId: "clubs-9-last-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 1, cardId: "spades-9-last-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 2, cardId: "hearts-9-last-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 3, cardId: "spades-9-last-1" },
      ruleset,
    );

    const finished = step.events.find((e) => e.type === "HandFinished");
    if (!finished || finished.type !== "HandFinished") {
      throw new Error("expected HandFinished event");
    }
    return finished;
  }

  test("initializes with 12 cards per seat", () => {
    const { state } = createEngine(12345);
    expect(state.hands[0]).toHaveLength(12);
    expect(state.hands[1]).toHaveLength(12);
    expect(state.hands[2]).toHaveLength(12);
    expect(state.hands[3]).toHaveLength(12);
  });

  test("enforces legal moves (must follow suit)", () => {
    const ruleset = rulesetStandard();
    const started = advancePastSoloSelection(
      createEngine(42, ruleset),
      ruleset,
    );
    const state = started.state;

    // Seat 0 leads a non-trump
    const hand0 = state.hands[0];
    const nonTrump = hand0.find((c) => !isTrump(c));
    if (!nonTrump) return; // Should not happen with standard deck

    let step = reduce(
      state,
      {
        type: "PlayCard",
        seat: 0,
        cardId: nonTrump.id,
      },
      ruleset,
    );

    // Seat 1 must follow suit if they have it
    const seat1 = step.state.currentSeat;
    expect(seat1).toBe(1);

    const hand1 = step.state.hands[1];
    const cardsOfSuit = hand1.filter(
      (c) => !isTrump(c) && c.suit === nonTrump.suit,
    );
    const legal = legalMoves(step.state, 1);

    if (cardsOfSuit.length > 0) {
      // Must play one of the suit
      expect(legal.length).toBe(cardsOfSuit.length);
      for (const id of legal) {
        const card = hand1.find((c) => c.id === id);
        expect(card?.suit).toBe(nonTrump.suit);
        expect(isTrump(card!)).toBe(false);
      }
    } else {
      // Can play anything
      expect(legal.length).toBe(hand1.length);
    }
  });

  test("correctly identifies trick winner and awards points", () => {
    // We'll use a specific seed or mock plays if needed, but let's just play 4 cards.
    const ruleset = rulesetStandard();
    const started = advancePastSoloSelection(
      createEngine(101, ruleset),
      ruleset,
    );
    const state = started.state;

    let cur = state;
    for (let i = 0; i < 4; i++) {
      const seat = cur.currentSeat;
      const legal = legalMoves(cur, seat);
      const step = reduce(cur, { type: "PlayCard", seat, cardId: legal[0] });
      cur = step.state;
    }

    expect(cur.completedTricks).toHaveLength(1);
    const trick = cur.completedTricks[0];
    const expectedPoints = trick.plays.reduce(
      (sum, p) => sum + cardPoints(p.card.rank),
      0,
    );
    expect(trick.points).toBe(expectedPoints);

    expect(cur.capturedBySeat[trick.winner]).toContain(trick.plays[0].card);
    expect(cur.currentSeat).toBe(trick.winner);
  });

  test("rulesetObliviousDay disables meta systems", () => {
    // In standard, Schweine might be enabled if we changed rulesetStandard,
    // but let's check announcements specifically.

    // We need to check if we can announce Re/Kontra.
    // In standard it's enabled.

    const { state: stateOblivious } = createEngine(99, {
      experienceMode: "oblivious",
      announcements: { mode: "disabled" },
      schweine: { mode: "disabled" },
      solo: { mode: "disabled" },
      allowIllegalPlays: false,
      enableCallouts: false,
      dulleBeatsDulle: "except_last_trick",
      schweineInSolo: false,
      schmeissen: false,
    });

    expect(stateOblivious.gameMode.kind).not.toBe("marriage");
    expect(stateOblivious.gameMode.kind).not.toBe("poverty");
  });

  test("Hochzeit partner is only found on non-trump tricks", () => {
    const ruleset = { ...rulesetStandard(), allowIllegalPlays: true };
    const { state } = createEngine(1337, ruleset);

    state.phase = "playing";
    state.gameMode = {
      kind: "marriage",
      holderSeat: 0,
      partnerSeat: null,
      clarificationEndsAtTrick: 3,
      forced: false,
    };
    state.teamBySeat = { 0: "re", 1: "kontra", 2: "kontra", 3: "kontra" };
    state.currentSeat = 0;

    const mode = state.gameMode;

    const leadTrump = state.hands[0]
      .filter((c) => isTrump(c, mode))
      .sort(
        (a, b) =>
          trumpPower(a, null, 0, ruleset, mode) -
          trumpPower(b, null, 0, ruleset, mode),
      )[0];
    expect(leadTrump).toBeTruthy();

    const seat1HighestTrump = state.hands[1]
      .filter((c) => isTrump(c, mode))
      .sort(
        (a, b) =>
          trumpPower(b, null, 1, ruleset, mode) -
          trumpPower(a, null, 1, ruleset, mode),
      )[0];
    expect(seat1HighestTrump).toBeTruthy();

    // Ensure seat 1 actually beats the lead.
    expect(
      trumpPower(seat1HighestTrump!, null, 1, ruleset, mode),
    ).toBeGreaterThan(trumpPower(leadTrump!, null, 0, ruleset, mode));

    let step = reduce(
      state,
      { type: "PlayCard", seat: 0, cardId: leadTrump!.id },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 1, cardId: seat1HighestTrump!.id },
      ruleset,
    );
    const seat2NonTrump =
      step.state.hands[2].find((c) => !isTrump(c, mode)) ??
      step.state.hands[2][0];
    const seat3NonTrump =
      step.state.hands[3].find((c) => !isTrump(c, mode)) ??
      step.state.hands[3][0];
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 2, cardId: seat2NonTrump.id },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 3, cardId: seat3NonTrump.id },
      ruleset,
    );

    expect(step.state.completedTricks).toHaveLength(1);
    expect(step.state.completedTricks[0].winner).toBe(1);

    // Trump-led trick: does NOT find partner.
    expect(step.state.gameMode.kind).toBe("marriage");
    if (step.state.gameMode.kind !== "marriage") {
      throw new Error(`Expected marriage mode after trick 1.`);
    }
    expect(step.state.gameMode.partnerSeat).toBeNull();
  });

  test("Hochzeit finds a partner when a non-holder wins a non-trump-led trick", () => {
    const ruleset = { ...rulesetStandard(), allowIllegalPlays: true };
    const { state } = createEngine(2020, ruleset);

    state.phase = "playing";
    state.gameMode = {
      kind: "marriage",
      holderSeat: 0,
      partnerSeat: null,
      clarificationEndsAtTrick: 3,
      forced: false,
    };
    state.teamBySeat = { 0: "re", 1: "kontra", 2: "kontra", 3: "kontra" };
    state.currentSeat = 0;
    state.trick = [];
    state.trickIndex = 1;
    state.completedTricks = [];
    state.announcementTrickOffset = 0;

    // Force a non-trump-led suit trick where seat 1 wins (seat 0 is holder).
    state.hands[0] = [
      { id: "clubs-9-0", suit: "clubs", rank: "9", copy: 0 },
      { id: "spades-9-0", suit: "spades", rank: "9", copy: 0 },
    ];
    state.hands[1] = [
      { id: "clubs-A-0", suit: "clubs", rank: "A", copy: 0 },
      { id: "spades-A-0", suit: "spades", rank: "A", copy: 0 },
    ];
    state.hands[2] = [
      { id: "clubs-K-0", suit: "clubs", rank: "K", copy: 0 },
      { id: "hearts-9-0", suit: "hearts", rank: "9", copy: 0 },
    ];
    state.hands[3] = [
      { id: "clubs-10-0", suit: "clubs", rank: "10", copy: 0 },
      { id: "diamonds-9-0", suit: "diamonds", rank: "9", copy: 0 },
    ];

    let step = reduce(
      state,
      { type: "PlayCard", seat: 0, cardId: "clubs-9-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 1, cardId: "clubs-A-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 2, cardId: "clubs-K-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 3, cardId: "clubs-10-0" },
      ruleset,
    );

    expect(step.state.completedTricks).toHaveLength(1);
    expect(step.state.completedTricks[0].winner).toBe(1);

    expect(step.state.gameMode.kind).toBe("marriage");
    if (step.state.gameMode.kind !== "marriage")
      throw new Error("expected marriage");
    expect(step.state.gameMode.partnerSeat).toBe(1);
    expect(step.state.gameMode.forced).toBe(false);

    // Teams flip now: holder + partner are Re.
    expect(step.state.teamBySeat[0]).toBe("re");
    expect(step.state.teamBySeat[1]).toBe("re");
    expect(step.state.teamBySeat[2]).toBe("kontra");
    expect(step.state.teamBySeat[3]).toBe("kontra");

    // Announcement windows are shifted after resolution.
    expect(step.state.announcementTrickOffset).toBe(1);
  });

  test("Hochzeit does not find a partner if the holder wins a non-trump-led trick", () => {
    const ruleset = { ...rulesetStandard(), allowIllegalPlays: true };
    const { state } = createEngine(3030, ruleset);

    state.phase = "playing";
    state.gameMode = {
      kind: "marriage",
      holderSeat: 0,
      partnerSeat: null,
      clarificationEndsAtTrick: 3,
      forced: false,
    };
    state.teamBySeat = { 0: "re", 1: "kontra", 2: "kontra", 3: "kontra" };
    state.currentSeat = 0;
    state.trick = [];
    state.trickIndex = 1;
    state.completedTricks = [];

    // Non-trump-led suit trick, but seat 0 (holder) wins.
    state.hands[0] = [{ id: "clubs-A-1", suit: "clubs", rank: "A", copy: 1 }];
    state.hands[1] = [{ id: "clubs-9-1", suit: "clubs", rank: "9", copy: 1 }];
    state.hands[2] = [{ id: "clubs-K-1", suit: "clubs", rank: "K", copy: 1 }];
    state.hands[3] = [{ id: "clubs-10-1", suit: "clubs", rank: "10", copy: 1 }];

    let step = reduce(
      state,
      { type: "PlayCard", seat: 0, cardId: "clubs-A-1" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 1, cardId: "clubs-9-1" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 2, cardId: "clubs-K-1" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 3, cardId: "clubs-10-1" },
      ruleset,
    );

    expect(step.state.completedTricks).toHaveLength(1);
    expect(step.state.completedTricks[0].winner).toBe(0);

    expect(step.state.gameMode.kind).toBe("marriage");
    if (step.state.gameMode.kind !== "marriage")
      throw new Error("expected marriage");
    expect(step.state.gameMode.partnerSeat).toBeNull();
    expect(step.state.gameMode.forced).toBe(false);
  });

  test("rank solos have no Dulle and no Schweine", () => {
    const dulle = {
      id: "hearts-10-0",
      suit: "hearts",
      rank: "10",
      copy: 0,
    } as const;
    const ace = {
      id: "diamonds-A-0",
      suit: "diamonds",
      rank: "A",
      copy: 0,
    } as const;
    const ruleset = {
      ...rulesetStandard(),
      schweine: { mode: "announce_while_playing", announce: "auto" } as const,
      schweineInSolo: true,
    };

    const soloTypes = ["jack", "queen", "queen_jack", "fleischlos"] as const;
    for (const soloType of soloTypes) {
      const mode = { kind: "solo" as const, soloSeat: 0 as const, soloType };
      expect(getTrumpSuit(mode)).toBeNull();
      expect(isTrump(dulle, mode)).toBe(false);
      expect(isTrump(ace, mode, 0, ruleset)).toBe(false);
    }
  });

  test("forced Hochzeit follows regular Schweine rules", () => {
    const ruleset = {
      ...rulesetStandard(),
      schweine: { mode: "announce_while_playing", announce: "auto" } as const,
      schweineInSolo: false,
    };

    // Craft a state where seat 0 can announce Schweine, then flip to forced Hochzeit.
    const { state } = createEngine(424242, ruleset);
    state.phase = "playing";
    state.gameMode = { kind: "normal" };
    state.schweineHolderSeat = 0;
    state.schweineActiveSeat = null;
    state.hands[0] = [
      { id: "diamonds-A-0", suit: "diamonds", rank: "A", copy: 0 },
      { id: "diamonds-A-1", suit: "diamonds", rank: "A", copy: 1 },
      ...state.hands[0].slice(2),
    ];

    // Regular game: Schweine announce allowed.
    let step = reduce(state, { type: "AnnounceSchweine", seat: 0 }, ruleset);
    expect(step.events.some((e) => e.type === "SchweineAnnounced")).toBe(true);

    // Reset Schweine and switch into forced Hochzeit: still allowed, even with schweineInSolo=false.
    step.state.schweineActiveSeat = null;
    step.state.gameMode = {
      kind: "marriage",
      holderSeat: 0,
      partnerSeat: null,
      clarificationEndsAtTrick: 3,
      forced: true,
    };
    step = reduce(step.state, { type: "AnnounceSchweine", seat: 0 }, ruleset);
    expect(step.events.some((e) => e.type === "SchweineAnnounced")).toBe(true);
  });

  test("rejected Schweine play does not mutate state", () => {
    const ruleset = {
      ...rulesetStandard(),
      schweine: { mode: "announce_while_playing", announce: "auto" } as const,
    };
    const { state } = createEngine(5150, ruleset);
    state.phase = "playing";
    state.gameMode = { kind: "normal" };
    state.currentSeat = 0;
    state.schweineHolderSeat = 0;
    state.schweineActiveSeat = null;
    state.trick = [
      {
        seat: 3,
        card: { id: "clubs-A-0", suit: "clubs", rank: "A", copy: 0 },
        wasLegal: true,
      },
    ];
    state.hands[0] = [
      { id: "diamonds-A-0", suit: "diamonds", rank: "A", copy: 0 },
      { id: "diamonds-A-1", suit: "diamonds", rank: "A", copy: 1 },
      { id: "clubs-9-0", suit: "clubs", rank: "9", copy: 0 },
    ];

    const before = JSON.stringify(state);
    const step = reduce(
      state,
      { type: "PlayCard", seat: 0, cardId: "diamonds-A-0" },
      ruleset,
    );

    expect(step.events).toEqual([]);
    expect(JSON.stringify(step.state)).toBe(before);
  });

  test("poverty acceptance enforces phase and turn order", () => {
    const ruleset = rulesetStandard();
    const { state } = createEngine(734, ruleset);
    state.phase = "poverty_acceptance";
    state.gameMode = {
      kind: "poverty",
      povertySeat: 0,
      acceptedBySeat: null,
      exchangeCompleted: false,
    };
    state.currentSeat = 1;

    const before = JSON.stringify(state);
    let step = reduce(state, { type: "AcceptPoverty", seat: 2 }, ruleset);
    expect(step.events).toEqual([]);
    expect(JSON.stringify(step.state)).toBe(before);

    state.phase = "playing";
    state.currentSeat = 1;
    const wrongPhase = JSON.stringify(state);
    step = reduce(state, { type: "AcceptPoverty", seat: 1 }, ruleset);
    expect(step.events).toEqual([]);
    expect(JSON.stringify(step.state)).toBe(wrongPhase);
  });

  test("poverty exchange requires poverty seat to give all trumps", () => {
    const ruleset = rulesetStandard();
    const { state } = createEngine(123, ruleset);

    // Force an initial poverty exchange state (no tricks yet).
    state.phase = "poverty_exchange";
    state.gameMode = {
      kind: "poverty",
      povertySeat: 0,
      acceptedBySeat: 1,
      exchangeCompleted: false,
    };
    state.currentSeat = 0;
    state.trick = [];
    state.completedTricks = [];
    state.schweineActiveSeat = null;

    // Poverty seat has 2 trumps and must give both.
    state.hands[0] = [
      { id: "diamonds-A-0", suit: "diamonds", rank: "A", copy: 0 },
      { id: "hearts-10-0", suit: "hearts", rank: "10", copy: 0 },
      { id: "clubs-9-0", suit: "clubs", rank: "9", copy: 0 },
      { id: "spades-9-0", suit: "spades", rank: "9", copy: 0 },
      { id: "clubs-K-0", suit: "clubs", rank: "K", copy: 0 },
      { id: "spades-K-0", suit: "spades", rank: "K", copy: 0 },
      { id: "hearts-K-0", suit: "hearts", rank: "K", copy: 0 },
      { id: "clubs-A-0", suit: "clubs", rank: "A", copy: 0 },
      { id: "spades-A-0", suit: "spades", rank: "A", copy: 0 },
      { id: "hearts-A-0", suit: "hearts", rank: "A", copy: 0 },
      { id: "clubs-10-0", suit: "clubs", rank: "10", copy: 0 },
      { id: "spades-10-0", suit: "spades", rank: "10", copy: 0 },
    ];
    state.hands[1] = [
      { id: "clubs-A-0", suit: "clubs", rank: "A", copy: 0 },
      { id: "spades-A-0", suit: "spades", rank: "A", copy: 0 },
      { id: "hearts-A-0", suit: "hearts", rank: "A", copy: 0 },
      { id: "clubs-9-1", suit: "clubs", rank: "9", copy: 1 },
      { id: "spades-9-1", suit: "spades", rank: "9", copy: 1 },
      { id: "hearts-9-1", suit: "hearts", rank: "9", copy: 1 },
      { id: "clubs-K-1", suit: "clubs", rank: "K", copy: 1 },
      { id: "spades-K-1", suit: "spades", rank: "K", copy: 1 },
      { id: "hearts-K-1", suit: "hearts", rank: "K", copy: 1 },
      { id: "clubs-10-1", suit: "clubs", rank: "10", copy: 1 },
      { id: "spades-10-1", suit: "spades", rank: "10", copy: 1 },
      { id: "hearts-10-1", suit: "hearts", rank: "10", copy: 1 },
    ];

    const before0 = state.hands[0].map((c) => c.id);
    const before1 = state.hands[1].map((c) => c.id);

    // Cheating attempt: give only non-trumps from poverty seat.
    let step = reduce(
      state,
      {
        type: "ExchangePovertyCards",
        povertySeat: 0,
        acceptedBySeat: 1,
        fromPovertyCardIds: ["clubs-9-0", "spades-9-0", "clubs-K-0"],
        fromAcceptedCardIds: ["clubs-A-0", "spades-A-0", "hearts-A-0"],
      },
      ruleset,
    );

    expect(step.state.phase).toBe("poverty_exchange");
    expect(step.state.gameMode.kind).toBe("poverty");
    if (step.state.gameMode.kind !== "poverty")
      throw new Error("Expected poverty");
    expect(step.state.gameMode.exchangeCompleted).toBe(false);
    expect(step.state.hands[0].map((c) => c.id)).toEqual(before0);
    expect(step.state.hands[1].map((c) => c.id)).toEqual(before1);

    // A missing acceptor card must not partially remove the poverty cards.
    step = reduce(
      step.state,
      {
        type: "ExchangePovertyCards",
        povertySeat: 0,
        acceptedBySeat: 1,
        fromPovertyCardIds: ["diamonds-A-0", "hearts-10-0", "clubs-9-0"],
        fromAcceptedCardIds: ["clubs-A-0", "spades-A-0", "missing-card"],
      },
      ruleset,
    );

    expect(step.events).toEqual([]);
    expect(step.state.hands[0].map((c) => c.id)).toEqual(before0);
    expect(step.state.hands[1].map((c) => c.id)).toEqual(before1);

    // Valid exchange: includes all trumps from poverty seat (A♦ and 10♥).
    step = reduce(
      step.state,
      {
        type: "ExchangePovertyCards",
        povertySeat: 0,
        acceptedBySeat: 1,
        fromPovertyCardIds: ["diamonds-A-0", "hearts-10-0", "clubs-9-0"],
        fromAcceptedCardIds: ["clubs-A-0", "spades-A-0", "hearts-A-0"],
      },
      ruleset,
    );

    expect(step.state.phase).toBe("playing");
    expect(step.state.gameMode.kind).toBe("poverty");
    if (step.state.gameMode.kind !== "poverty")
      throw new Error("Expected poverty");
    expect(step.state.gameMode.exchangeCompleted).toBe(true);
  });

  test("forced marriage counts all tricks toward the deadline", () => {
    const ruleset = {
      ...rulesetStandard(),
      announcements: { mode: "disabled" as const },
    };
    const { state } = createEngine(123456, ruleset);

    state.phase = "playing";
    state.gameMode = {
      kind: "marriage",
      holderSeat: 0,
      partnerSeat: null,
      clarificationEndsAtTrick: 3,
      forced: false,
    };
    state.teamBySeat = { 0: "re", 1: "kontra", 2: "kontra", 3: "kontra" };
    state.currentSeat = 0;
    state.trick = [];
    state.trickIndex = 1;
    state.completedTricks = [];

    state.hands[0] = [
      { id: "diamonds-9-0", suit: "diamonds", rank: "9", copy: 0 },
      { id: "diamonds-K-0", suit: "diamonds", rank: "K", copy: 0 },
      { id: "hearts-10-0", suit: "hearts", rank: "10", copy: 0 },
      { id: "clubs-A-0", suit: "clubs", rank: "A", copy: 0 },
      { id: "spades-A-0", suit: "spades", rank: "A", copy: 0 },
      { id: "hearts-A-0", suit: "hearts", rank: "A", copy: 0 },
    ];
    state.hands[1] = [
      { id: "clubs-K-1", suit: "clubs", rank: "K", copy: 1 },
      { id: "spades-K-1", suit: "spades", rank: "K", copy: 1 },
      { id: "hearts-K-1", suit: "hearts", rank: "K", copy: 1 },
      { id: "clubs-9-0", suit: "clubs", rank: "9", copy: 0 },
      { id: "spades-9-0", suit: "spades", rank: "9", copy: 0 },
      { id: "hearts-9-0", suit: "hearts", rank: "9", copy: 0 },
    ];
    state.hands[2] = [
      { id: "clubs-10-0", suit: "clubs", rank: "10", copy: 0 },
      { id: "spades-10-0", suit: "spades", rank: "10", copy: 0 },
      { id: "hearts-K-0", suit: "hearts", rank: "K", copy: 0 },
      { id: "clubs-9-1", suit: "clubs", rank: "9", copy: 1 },
      { id: "spades-9-1", suit: "spades", rank: "9", copy: 1 },
      { id: "hearts-9-1", suit: "hearts", rank: "9", copy: 1 },
    ];
    state.hands[3] = [
      { id: "clubs-10-1", suit: "clubs", rank: "10", copy: 1 },
      { id: "spades-10-1", suit: "spades", rank: "10", copy: 1 },
      { id: "clubs-K-0", suit: "clubs", rank: "K", copy: 0 },
      { id: "clubs-A-1", suit: "clubs", rank: "A", copy: 1 },
      { id: "spades-A-1", suit: "spades", rank: "A", copy: 1 },
      { id: "hearts-A-1", suit: "hearts", rank: "A", copy: 1 },
    ];

    // 3 trump-led tricks: cannot find a partner, but still consume the 3-trick deadline.
    let step = reduce(
      state,
      { type: "PlayCard", seat: 0, cardId: "diamonds-9-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 1, cardId: "clubs-K-1" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 2, cardId: "clubs-10-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 3, cardId: "clubs-10-1" },
      ruleset,
    );

    step = reduce(
      step.state,
      { type: "PlayCard", seat: 0, cardId: "diamonds-K-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 1, cardId: "spades-K-1" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 2, cardId: "spades-10-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 3, cardId: "spades-10-1" },
      ruleset,
    );

    step = reduce(
      step.state,
      { type: "PlayCard", seat: 0, cardId: "hearts-10-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 1, cardId: "hearts-K-1" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 2, cardId: "hearts-K-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 3, cardId: "clubs-K-0" },
      ruleset,
    );

    expect(step.state.gameMode.kind).toBe("solo");
    if (step.state.gameMode.kind !== "solo") throw new Error("expected solo");
    expect(step.state.gameMode.soloSeat).toBe(0);
    expect(step.state.gameMode.soloType).toBe("diamonds");
    expect(step.state.completedTricks).toHaveLength(3);
  });

  test("announcements are blocked until marriage resolves, then windows shift later", () => {
    const ruleset = rulesetStandard();
    const { state } = createEngine(987654, ruleset);

    state.phase = "playing";
    state.gameMode = {
      kind: "marriage",
      holderSeat: 0,
      partnerSeat: null,
      clarificationEndsAtTrick: 3,
      forced: false,
    };
    state.teamBySeat = { 0: "re", 1: "kontra", 2: "kontra", 3: "kontra" };
    state.currentSeat = 0;
    state.trick = [];
    state.trickIndex = 1;
    state.completedTricks = [];
    state.announcementTrickOffset = 0;

    // Unresolved: cannot announce even at full hand.
    state.hands[0] = [
      { id: "clubs-A-0", suit: "clubs", rank: "A", copy: 0 },
      { id: "clubs-9-0", suit: "clubs", rank: "9", copy: 0 },
      { id: "clubs-10-0", suit: "clubs", rank: "10", copy: 0 },
      { id: "spades-A-0", suit: "spades", rank: "A", copy: 0 },
      { id: "spades-9-0", suit: "spades", rank: "9", copy: 0 },
      { id: "spades-10-0", suit: "spades", rank: "10", copy: 0 },
      { id: "hearts-A-0", suit: "hearts", rank: "A", copy: 0 },
      { id: "hearts-9-0", suit: "hearts", rank: "9", copy: 0 },
      { id: "hearts-10-0", suit: "hearts", rank: "10", copy: 0 },
      { id: "diamonds-9-0", suit: "diamonds", rank: "9", copy: 0 },
      { id: "diamonds-K-0", suit: "diamonds", rank: "K", copy: 0 },
      { id: "diamonds-A-0", suit: "diamonds", rank: "A", copy: 0 },
    ];
    const blocked = reduce(
      state,
      { type: "Announce", seat: 0, declaration: "Re" },
      ruleset,
    );
    expect(blocked.events.some((e) => e.type === "AnnouncementMade")).toBe(
      false,
    );

    // Simulate forcing after 6 tricks: offset should let us still announce.
    // We don't need to replay full trick logic here; just set the resolved state shape.
    blocked.state.completedTricks = Array.from({ length: 6 }, (_, i) => ({
      index: i + 1,
      plays: [],
      winner: 0 as const,
      points: 0,
    }));
    blocked.state.hands[0] = blocked.state.hands[0].slice(0, 6);
    if (blocked.state.gameMode.kind !== "marriage") {
      throw new Error("expected marriage");
    }
    blocked.state.gameMode = { ...blocked.state.gameMode, forced: true };
    blocked.state.announcementTrickOffset = 6;

    const allowed = reduce(
      blocked.state,
      { type: "Announce", seat: 0, declaration: "Re" },
      ruleset,
    );
    expect(allowed.events.some((e) => e.type === "AnnouncementMade")).toBe(
      true,
    );
  });

  test("allows chained announcements (No60 implies No90) when all windows are still open", () => {
    const ruleset = rulesetStandard();
    const started = advancePastSoloSelection(createEngine(7, ruleset), ruleset);
    const state = started.state;

    state.phase = "playing";
    state.finished = false;
    state.gameMode = { kind: "normal" };
    state.currentSeat = 0;
    state.trick = [];
    state.trickIndex = 1;
    state.completedTricks = [];
    state.announcementTrickOffset = 0;
    state.announcements = [];
    state.teamBySeat = { 0: "re", 1: "re", 2: "kontra", 3: "kontra" };

    // Declaring No60 should implicitly include Re + No90 (all still within window at full hand).
    const step = reduce(
      state,
      { type: "Announce", seat: 0, declaration: "No60" },
      ruleset,
    );
    const made = step.events.filter((e) => e.type === "AnnouncementMade");
    expect(made).toHaveLength(3);
    expect(step.state.announcements.map((a) => a.declaration)).toEqual([
      "Re",
      "No90",
      "No60",
    ]);
  });

  test("does not allow chaining if an implied step is out of its window", () => {
    const ruleset = rulesetStandard();
    const started = advancePastSoloSelection(createEngine(9, ruleset), ruleset);
    const state = started.state;

    state.phase = "playing";
    state.finished = false;
    state.gameMode = { kind: "normal" };
    state.currentSeat = 0;
    state.trick = [];
    state.trickIndex = 5;
    state.completedTricks = [];
    state.announcementTrickOffset = 0;
    state.announcements = [];
    state.teamBySeat = { 0: "re", 1: "re", 2: "kontra", 3: "kontra" };

    // Base already announced earlier, but we "forgot" No90 until it's too late.
    state.announcements.push({
      seat: 0,
      team: "re",
      declaration: "Re",
      trickIndex: 1,
    });
    // Only 9 cards left: No60 window is open, but No90 window is closed -> chaining must fail.
    state.hands[0] = state.hands[0].slice(0, 9);

    const blocked = reduce(
      state,
      { type: "Announce", seat: 0, declaration: "No60" },
      ruleset,
    );
    expect(blocked.events.some((e) => e.type === "AnnouncementMade")).toBe(
      false,
    );

    // If No90 was actually announced earlier, No60 is still allowed at 9 cards.
    blocked.state.announcements.push({
      seat: 0,
      team: "re",
      declaration: "No90",
      trickIndex: 2,
    });
    const allowed = reduce(
      blocked.state,
      { type: "Announce", seat: 0, declaration: "No60" },
      ruleset,
    );
    expect(allowed.events.some((e) => e.type === "AnnouncementMade")).toBe(
      true,
    );
    expect(allowed.state.announcements.map((a) => a.declaration)).toContain(
      "No60",
    );
  });

  test("winning threshold: 120:120 goes to Kontra by default", () => {
    const ruleset = rulesetStandard();
    const { state } = createEngine(111, ruleset);

    state.gameMode = { kind: "normal" };
    state.teamBySeat = { 0: "re", 1: "re", 2: "kontra", 3: "kontra" };
    state.announcements = [];
    state.specialCallouts = [];

    // Re: 10xA (110) + 10 (10) = 120
    state.capturedBySeat = {
      0: [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `re-A-${i}`,
          suit: "spades" as const,
          rank: "A" as const,
          copy: 0 as const,
        })),
        { id: "re-10-0", suit: "hearts", rank: "10", copy: 0 },
      ],
      1: [],
      2: [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `ko-A-${i}`,
          suit: "clubs" as const,
          rank: "A" as const,
          copy: 0 as const,
        })),
        { id: "ko-10-0", suit: "spades", rank: "10", copy: 0 },
      ],
      3: [],
    };

    const finished = finishStubbedHand(state, ruleset);
    expect(finished.cardPointsRe).toBe(120);
    expect(finished.cardPointsKontra).toBe(120);
    expect(finished.winningTeam).toBe("kontra");
    expect(finished.scoreKontra.gamePoints).toBe(2); // + (win + "against elders")
    expect(finished.scoreRe.gamePoints).toBe(-2);
  });

  test("announcements do not change the 120:120 winner", () => {
    const ruleset = rulesetStandard();
    const { state } = createEngine(222, ruleset);

    state.gameMode = { kind: "normal" };
    state.teamBySeat = { 0: "re", 1: "re", 2: "kontra", 3: "kontra" };
    state.specialCallouts = [];

    // Keep it 120:120.
    state.capturedBySeat = {
      0: [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `re2-A-${i}`,
          suit: "spades" as const,
          rank: "A" as const,
          copy: 0 as const,
        })),
        { id: "re2-10-0", suit: "hearts", rank: "10", copy: 0 },
      ],
      1: [],
      2: [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `ko2-A-${i}`,
          suit: "clubs" as const,
          rank: "A" as const,
          copy: 0 as const,
        })),
        { id: "ko2-10-0", suit: "spades", rank: "10", copy: 0 },
      ],
      3: [],
    };

    state.announcements = [
      { seat: 2, team: "kontra", declaration: "Kontra", trickIndex: 1 },
    ];
    const kontraOnly = finishStubbedHand(state, ruleset);
    expect(kontraOnly.winningTeam).toBe("kontra");

    // Reset and add Re as well.
    const { state: state2 } = createEngine(223, ruleset);
    state2.gameMode = { kind: "normal" };
    state2.teamBySeat = { 0: "re", 1: "re", 2: "kontra", 3: "kontra" };
    state2.specialCallouts = [];
    state2.capturedBySeat = {
      0: [...state.capturedBySeat[0]],
      1: [],
      2: [...state.capturedBySeat[2]],
      3: [],
    };
    state2.announcements = [
      { seat: 0, team: "re", declaration: "Re", trickIndex: 1 },
      { seat: 2, team: "kontra", declaration: "Kontra", trickIndex: 1 },
    ];
    const both = finishStubbedHand(state2, ruleset);
    expect(both.winningTeam).toBe("kontra");
  });

  test("Sonderpunkte are netted against each other (Normalspiel)", () => {
    const ruleset = rulesetStandard();
    const { state } = createEngine(333, ruleset);

    state.gameMode = { kind: "normal" };
    state.teamBySeat = { 0: "re", 1: "re", 2: "kontra", 3: "kontra" };
    state.announcements = [];

    // Re: 121 points (10A=110 + K=4 + Q=3 + 2J=4)
    const rePile = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `re3-A-${i}`,
        suit: "spades" as const,
        rank: "A" as const,
        copy: 0 as const,
      })),
      {
        id: "re3-K-0",
        suit: "hearts" as const,
        rank: "K" as const,
        copy: 0 as const,
      },
      {
        id: "re3-Q-0",
        suit: "clubs" as const,
        rank: "Q" as const,
        copy: 0 as const,
      },
      {
        id: "re3-J-0",
        suit: "spades" as const,
        rank: "J" as const,
        copy: 0 as const,
      },
      {
        id: "re3-J-1",
        suit: "hearts" as const,
        rank: "J" as const,
        copy: 1 as const,
      },
    ];

    // Kontra: 119 points, including a caught fox (A♦) that originally belonged to Re.
    const fox = {
      id: "diamonds-A-fox",
      suit: "diamonds",
      rank: "A",
      copy: 0,
    } as const;
    state.originalOwnerByCardId[fox.id] = 0;
    const kontraPile = [
      fox,
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `ko3-A-${i}`,
        suit: "clubs" as const,
        rank: "A" as const,
        copy: 0 as const,
      })),
      {
        id: "ko3-10-0",
        suit: "spades" as const,
        rank: "10" as const,
        copy: 0 as const,
      },
      {
        id: "ko3-10-1",
        suit: "hearts" as const,
        rank: "10" as const,
        copy: 1 as const,
      },
    ];

    state.capturedBySeat = { 0: rePile, 1: [], 2: kontraPile, 3: [] };
    state.specialCallouts = [
      { kind: "Doppelkopf", seat: 0, text: "Doppelkopf!" },
      { kind: "Karlchen", seat: 2, text: "Karlchen!" },
    ];

    const finished = finishStubbedHand(state, ruleset);
    expect(finished.winningTeam).toBe("re");
    // Base win (+1) + doppelkopf (+1) - (fox (+1) + karlchen (+1)) = 0.
    expect(finished.scoreRe.gamePoints).toBe(0);
    expect(finished.scoreKontra.gamePoints).toBe(0);
  });

  test("solos use solo settlement and do not score Sonderpunkte", () => {
    const ruleset = rulesetStandard();
    const { state } = createEngine(334, ruleset);

    state.gameMode = { kind: "solo", soloSeat: 0, soloType: "hearts" };
    state.teamBySeat = { 0: "re", 1: "kontra", 2: "kontra", 3: "kontra" };
    state.announcements = [];

    // Re: 121 points.
    const rePile = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `re3s-A-${i}`,
        suit: "spades" as const,
        rank: "A" as const,
        copy: 0 as const,
      })),
      {
        id: "re3s-K-0",
        suit: "hearts" as const,
        rank: "K" as const,
        copy: 0 as const,
      },
      {
        id: "re3s-Q-0",
        suit: "clubs" as const,
        rank: "Q" as const,
        copy: 0 as const,
      },
      {
        id: "re3s-J-0",
        suit: "spades" as const,
        rank: "J" as const,
        copy: 0 as const,
      },
      {
        id: "re3s-J-1",
        suit: "hearts" as const,
        rank: "J" as const,
        copy: 1 as const,
      },
    ];

    // Kontra: 119 points including A♦ originally owned by Re.
    const fox = {
      id: "diamonds-A-fox-solo",
      suit: "diamonds",
      rank: "A",
      copy: 0,
    } as const;
    state.originalOwnerByCardId[fox.id] = 0;
    const kontraPile = [
      fox,
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `ko3s-A-${i}`,
        suit: "clubs" as const,
        rank: "A" as const,
        copy: 0 as const,
      })),
      {
        id: "ko3s-10-0",
        suit: "spades" as const,
        rank: "10" as const,
        copy: 0 as const,
      },
      {
        id: "ko3s-10-1",
        suit: "hearts" as const,
        rank: "10" as const,
        copy: 1 as const,
      },
    ];

    state.capturedBySeat = { 0: rePile, 1: [], 2: kontraPile, 3: [] };
    state.specialCallouts = [{ kind: "Karlchen", seat: 2, text: "Karlchen!" }];

    const finished = finishStubbedHand(state, ruleset);
    expect(finished.winningTeam).toBe("re");
    expect(finished.scoreRe.gamePoints).toBe(3); // +3× (solo win)
    expect(finished.scoreKontra.gamePoints).toBe(-1); // defenders get -1×
    expect(
      finished.scoreKontra.details.some((d) => d.includes("Fox caught")),
    ).toBe(false);
  });

  test("solos do not emit fox caught callouts", () => {
    const ruleset = rulesetStandard();
    const { state } = createEngine(335, ruleset);

    state.phase = "playing";
    state.finished = false;
    state.trickIndex = 1;
    state.completedTricks = [];
    state.trick = [];
    state.currentSeat = 0;
    state.gameMode = { kind: "solo", soloSeat: 0, soloType: "hearts" };
    state.teamBySeat = { 0: "re", 1: "kontra", 2: "kontra", 3: "kontra" };
    state.specialCallouts = [];

    const fox = {
      id: "diamonds-A-live-fox-solo",
      suit: "diamonds" as const,
      rank: "A" as const,
      copy: 0 as const,
    };
    state.hands[0] = [
      { id: "clubs-9-live-0", suit: "clubs", rank: "9", copy: 0 },
    ];
    state.hands[1] = [fox];
    state.hands[2] = [
      { id: "spades-9-live-0", suit: "spades", rank: "9", copy: 0 },
    ];
    state.hands[3] = [
      { id: "clubs-A-live-0", suit: "clubs", rank: "A", copy: 0 },
    ];
    state.originalOwnerByCardId[fox.id] = 0;

    let step = reduce(
      state,
      { type: "PlayCard", seat: 0, cardId: "clubs-9-live-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 1, cardId: fox.id },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 2, cardId: "spades-9-live-0" },
      ruleset,
    );
    step = reduce(
      step.state,
      { type: "PlayCard", seat: 3, cardId: "clubs-A-live-0" },
      ruleset,
    );

    const foxCallout = step.events.find(
      (event) =>
        event.type === "SpecialCallout" &&
        event.callout.kind === "FuchsGefangen",
    );
    expect(foxCallout).toBeUndefined();
  });

  test("Punktespiel: failed Absage awards stake + overbid penalty", () => {
    const ruleset = rulesetStandard();
    const { state } = createEngine(444, ruleset);

    state.gameMode = { kind: "normal" };
    state.teamBySeat = { 0: "re", 1: "re", 2: "kontra", 3: "kontra" };
    state.specialCallouts = [];

    // 120:120.
    state.capturedBySeat = {
      0: [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `re4-A-${i}`,
          suit: "spades" as const,
          rank: "A" as const,
          copy: 0 as const,
        })),
        { id: "re4-10-0", suit: "hearts", rank: "10", copy: 0 },
      ],
      1: [],
      2: [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `ko4-A-${i}`,
          suit: "clubs" as const,
          rank: "A" as const,
          copy: 0 as const,
        })),
        { id: "ko4-10-0", suit: "spades", rank: "10", copy: 0 },
      ],
      3: [],
    };

    // Re declares Re + No90, but Kontra wins 120:120; No90 is failed and also "overbid" by one tier (>=120).
    state.announcements = [
      { seat: 0, team: "re", declaration: "Re", trickIndex: 1 },
      { seat: 0, team: "re", declaration: "No90", trickIndex: 1 },
    ];

    const finished = finishStubbedHand(state, ruleset);
    expect(finished.winningTeam).toBe("kontra");
    // win (+1) + elders (+1) + Re announced (+2) + No90 failed (+1) + overbid (+1)
    expect(finished.scoreKontra.gamePoints).toBe(6);
    expect(finished.scoreRe.gamePoints).toBe(-6);
  });
});
