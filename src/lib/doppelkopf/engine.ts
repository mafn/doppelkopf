import { cardLabel, cardPoints, dealHands, shuffleDeck } from "./deck";
import {
  computeTeamsByQueens,
  findSchweinSeat,
  countTrumps,
  getTrumpSuit,
  isTrump,
  isLegalPlay,
  legalCardsForPlay,
  trickPoints,
  winnerOfTrick,
} from "./rules";
import {
  type Card,
  type AnnouncementDeclaration,
  type AnnouncementRecord,
  type EngineEvent,
  type EngineStep,
  type GameAction,
  type GameMode,
  type GameState,
  type Seat,
  type SoloType,
  type Team,
  type TeamScore,
  type TeamTotals,
} from "./types";
import type { Ruleset } from "./ruleset";
import { rulesetStandard } from "./ruleset";
import { randomSeed32 } from "../cards/rng";
import { computeHardPublicTeamsFromState } from "./team-evidence";

const SEATS: Seat[] = [0, 1, 2, 3];

function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % 4) as Seat;
}

function findCardIndex(cards: Card[], cardId: string): number {
  return cards.findIndex((card) => card.id === cardId);
}

function blankTotals(): TeamTotals {
  return {
    cardPoints: 0,
    fuchsCaught: 0,
    doppelkopf: 0,
    karlchen: 0,
  };
}

function makeSoloTeams(soloSeat: Seat): Record<Seat, Team> {
  return {
    0: soloSeat === 0 ? "re" : "kontra",
    1: soloSeat === 1 ? "re" : "kontra",
    2: soloSeat === 2 ? "re" : "kontra",
    3: soloSeat === 3 ? "re" : "kontra",
  };
}

function getSoloPriority(type: SoloType): number {
  if (type === "marriage") return 1;
  if (type === "poverty") return 0;
  return 2; // Real solos have highest priority
}

function finishSoloSelection(
  state: GameState,
  ruleset: Ruleset,
  events: EngineEvent[],
): void {
  const highest = state.soloSelection.highestSolo;
  if (highest) {
    if (highest.soloType === "marriage") {
      // Hochzeit (announced marriage):
      // - The holder (seat with both Q♣) becomes provisional "Re" and can find a partner
      //   during the first `clarificationEndsAtTrick` tricks.
      // - Partner-finding is handled after each trick in `maybeResolveMarriageByTrick()`.
      // - If no partner is found by the deadline, the marriage is forced into 1v3 (holder vs rest).
      //
      // Note: A "silent marriage" is represented as a normal game where one seat holds both Q♣;
      //       in that case `computeTeamsByQueens()` already yields a 1v3 team split and there is
      //       no partner-finding phase.
      state.gameMode = {
        kind: "marriage",
        holderSeat: highest.seat,
        partnerSeat: null,
        clarificationEndsAtTrick: 3,
        forced: false,
      };
      state.teamBySeat = makeSoloTeams(highest.seat);
      state.phase = "playing";
      state.currentSeat = nextSeat(state.soloSelection.dealerSeat);
    } else if (highest.soloType === "poverty") {
      state.gameMode = {
        kind: "poverty",
        povertySeat: highest.seat,
        acceptedBySeat: null,
        exchangeCompleted: false,
      };
      state.teamBySeat = computeTeamsByQueens(state.hands);
      state.phase = "poverty_acceptance";
      state.currentSeat = nextSeat(highest.seat);
    } else {
      // PROPER SOLO: Player chose a real solo (Queens, Jacks, Suit, Fleischlos)
      state.gameMode = {
        kind: "solo",
        soloSeat: highest.seat,
        soloType: highest.soloType,
      };
      state.teamBySeat = makeSoloTeams(highest.seat);
      state.phase = "playing";
      // SOLO LEAD RULE: The solo player leads the first trick.
      state.currentSeat = highest.seat;
    }
  } else {
    // Everyone passed.
    state.gameMode = { kind: "normal" };
    state.teamBySeat = computeTeamsByQueens(state.hands);
    state.phase = "playing";
    state.currentSeat = nextSeat(state.soloSelection.dealerSeat);
  }

  // Re-evaluate Schweine holder based on the final game mode (e.g. Ace of Hearts in Heart Solo)
  state.schweineHolderSeat = findSchweinSeat(state.hands, state.gameMode);

  events.push({ type: "SoloSelectionFinished", gameMode: state.gameMode });
}

function redeal(
  state: GameState,
  _ruleset: Ruleset,
  cause: "poverty_rejected" | "no_solo_passed" | "cards_thrown",
  events: EngineEvent[],
): void {
  const newSeed = (state.seed * 1664525 + 1013904223) >>> 0;
  const newState = buildInitialState(newSeed, state.soloSelection.dealerSeat);
  Object.assign(state, newState);
  events.push({ type: "RedealRequired", cause });
}

/**
 * Handles the "Schmeißen" (throwing cards) house rule.
 * - This is an explicit baseline house rule, enabled by default in `standard` mode.
 * - Triggers an immediate redeal if a player holds 5 Kings or 8 Kings+Nines.
 */
function throwCards(
  state: GameState,
  seat: Seat,
  ruleset: Ruleset,
): EngineStep {
  // Can only throw during solo selection (before anything else)
  if (state.phase !== "solo_selection") return { state, events: [] };
  if (!ruleset.schmeissen) return { state, events: [] };
  if (seat !== state.soloSelection.currentSeat) return { state, events: [] };

  const hand = state.hands[seat];
  const kings = hand.filter((c) => c.rank === "K").length;
  const nines = hand.filter((c) => c.rank === "9").length;
  const kingsAndNines = kings + nines;

  let canThrow = false;
  let reason = "";
  if (kings >= 5) {
    canThrow = true;
    reason = "5 Kings";
  } else if (kingsAndNines >= 8) {
    canThrow = true;
    reason = "8 Kings and Nines";
  }

  if (!canThrow) return { state, events: [] };

  const events: EngineEvent[] = [{ type: "CardsThrown", seat, reason }];
  redeal(state, ruleset, "cards_thrown", events);

  return { state, events };
}

function passSolo(state: GameState, seat: Seat, ruleset: Ruleset): EngineStep {
  if (
    state.phase !== "solo_selection" ||
    state.soloSelection.currentSeat !== seat
  ) {
    return { state, events: [] };
  }

  const events: EngineEvent[] = [{ type: "SoloPassed", seat }];
  state.soloSelection.passedSeats.add(seat);

  const startSeat = nextSeat(state.soloSelection.dealerSeat);
  if (nextSeat(seat) === startSeat) {
    finishSoloSelection(state, ruleset, events);
  } else {
    state.soloSelection.currentSeat = nextSeat(seat);
  }

  return { state, events };
}

/**
 * Handles a player declaring a Solo, Marriage, or Poverty.
 * - In `oblivious` mode (`solo.mode === "disabled"`), this also suppresses marriage and poverty declarations.
 * - A silent marriage (holding 2x Q♣) without declaring will still naturally fall through to a 1v3 split.
 */
function chooseSolo(
  state: GameState,
  seat: Seat,
  soloType: SoloType,
  ruleset: Ruleset,
): EngineStep {
  if (
    state.phase !== "solo_selection" ||
    state.soloSelection.currentSeat !== seat
  ) {
    return { state, events: [] };
  }

  if (ruleset.solo.mode === "disabled") return { state, events: [] };
  // Check if soloType is in allowed list, but always allow marriage/poverty if they were triggered
  if (
    !ruleset.solo.allowed.includes(soloType as any) &&
    !["marriage", "poverty"].includes(soloType)
  ) {
    return { state, events: [] };
  }

  // Eligibility checks for special modes
  if (soloType === "marriage") {
    const clubQueens = state.hands[seat].filter(
      (c) => c.suit === "clubs" && c.rank === "Q",
    ).length;
    if (clubQueens !== 2) {
      return { state, events: [] };
    }
  }
  if (soloType === "poverty") {
    if (countTrumps(state.hands[seat], null, ruleset) > 3) {
      return { state, events: [] };
    }
  }

  const newPriority = getSoloPriority(soloType);
  const currentHighest = state.soloSelection.highestSolo;

  if (
    !currentHighest ||
    newPriority > getSoloPriority(currentHighest.soloType)
  ) {
    state.soloSelection.highestSolo = { seat, soloType };
  }

  const events: EngineEvent[] = [{ type: "SoloChosen", seat, soloType }];
  const startSeat = nextSeat(state.soloSelection.dealerSeat);
  state.soloSelection.currentSeat = nextSeat(seat);

  if (nextSeat(seat) === startSeat) {
    finishSoloSelection(state, ruleset, events);
  }

  return { state, events };
}

function buildInitialState(seed: number, dealerSeat: Seat = 3): GameState {
  const deck = shuffleDeck(seed);
  const hands = dealHands(deck);
  // Initially, we don't know the game mode until solo selection is done.
  // We use a dummy mode for now.
  const gameMode: GameMode = { kind: "normal" };
  const teamBySeat = computeTeamsByQueens(hands);
  const schweineHolderSeat = findSchweinSeat(hands);

  const originalOwnerByCardId: Record<string, Seat> = {};
  for (const seat of SEATS) {
    for (const card of hands[seat]) {
      originalOwnerByCardId[card.id] = seat;
    }
  }

  return {
    seed,
    phase: "solo_selection",
    announcementTrickOffset: 0,
    soloSelection: {
      dealerSeat,
      currentSeat: nextSeat(dealerSeat),
      highestSolo: null,
      passedSeats: new Set<Seat>(),
    },
    gameMode,
    schweineHolderSeat,
    schweineActiveSeat: null,
    hands,
    trick: [],
    trickIndex: 1,
    completedTricks: [],
    capturedBySeat: { 0: [], 1: [], 2: [], 3: [] },
    teamBySeat,
    currentSeat: 0,
    finished: false,
    forfeitSeat: null,
    renonceRecords: [],
    announcements: [],
    specialCallouts: [],
    seenCards: new Set<string>(),
    originalOwnerByCardId,
    scoreRe: null,
    scoreKontra: null,
  };
}

function getTeamPoints(state: GameState): Record<Team, TeamTotals> {
  const totals: Record<Team, TeamTotals> = {
    re: blankTotals(),
    kontra: blankTotals(),
  };

  for (const seat of SEATS) {
    const team = state.teamBySeat[seat];
    for (const card of state.capturedBySeat[seat]) {
      totals[team].cardPoints += cardPoints(card.rank);

      // Calculate Fuchs points directly from captured cards (Authoritative).
      // Solos do not have fox scoring.
      if (
        state.gameMode.kind !== "solo" &&
        card.suit === "diamonds" &&
        card.rank === "A"
      ) {
        const ownerSeat = state.originalOwnerByCardId[card.id];
        const ownerTeam = state.teamBySeat[ownerSeat];
        if (ownerTeam !== team) {
          totals[team].fuchsCaught += 1;
        }
      }
    }
  }

  for (const callout of state.specialCallouts) {
    const team = state.teamBySeat[callout.seat];
    // FuchsGefangen callouts are now UI-only hints and might include 'false positives' (friendly captures not yet known)
    // So we do NOT sum them here. We used the authoritative card check above.
    if (callout.kind === "Doppelkopf") totals[team].doppelkopf += 1;
    if (callout.kind === "Karlchen") totals[team].karlchen += 1;
  }

  return totals;
}

function seatHasBothTrumpAces(hand: Card[], gameMode: GameMode): boolean {
  const suit = getTrumpSuit(gameMode);
  if (!suit) return false;
  let count = 0;
  for (const card of hand) {
    if (card.suit === suit && card.rank === "A") count += 1;
  }
  return count === 2;
}

function isSoloLikeNormalGame(state: GameState): boolean {
  if (state.gameMode.kind !== "normal") return false;
  let reCount = 0;
  let kontraCount = 0;
  for (const seat of SEATS) {
    if (state.teamBySeat[seat] === "re") reCount += 1;
    else kontraCount += 1;
  }
  return reCount === 1 || kontraCount === 1;
}

function computePublicTeamBySeat(state: GameState): Record<Seat, Team | null> {
  const evidence = computeHardPublicTeamsFromState(state);
  return {
    0: evidence[0] === "unknown" ? null : evidence[0],
    1: evidence[1] === "unknown" ? null : evidence[1],
    2: evidence[2] === "unknown" ? null : evidence[2],
    3: evidence[3] === "unknown" ? null : evidence[3],
  };
}

function canAnnounceSchweine(
  state: GameState,
  ruleset: Ruleset,
  seat: Seat,
): boolean {
  if (ruleset.schweine.mode === "disabled") return false;
  const isSoloForSchweine =
    state.gameMode.kind === "solo" || isSoloLikeNormalGame(state);
  if (isSoloForSchweine && !ruleset.schweineInSolo) return false;
  if (state.schweineActiveSeat !== null) return false;
  if (state.schweineHolderSeat === null) return false;
  if (seat !== state.schweineHolderSeat) return false;
  if (!seatHasBothTrumpAces(state.hands[seat], state.gameMode)) return false;
  if (ruleset.schweine.mode !== "announce_while_playing") return false;
  return (
    state.phase === "playing" && seat === state.currentSeat && !state.finished
  );
}

function announceSchweine(
  state: GameState,
  ruleset: Ruleset,
  seat: Seat,
  timing: "during",
  events: EngineEvent[],
): void {
  if (!canAnnounceSchweine(state, ruleset, seat)) return;

  state.schweineActiveSeat = seat;
  events.push({ type: "SchweineAnnounced", seat, timing });

  if (ruleset.enableCallouts) {
    const callout = {
      kind: "Schweine" as const,
      seat,
      text: `PIGLETS! Seat ${seat + 1}.`,
    };
    state.specialCallouts.push(callout);
    events.push({ type: "SpecialCallout", callout });
  }
}

function canAnnounceDeclaration(
  state: GameState,
  ruleset: Ruleset,
  seat: Seat,
  declaration: AnnouncementDeclaration,
): boolean {
  // Announcement rules (project-specific simplification):
  // - Only during `playing`, only on your turn, and never once `finished`.
  // - Blocked until an unresolved marriage is resolved (unless forced).
  // - Re/Kontra must match your team.
  // - "No" announcements are sequential *unless* they are declared as a valid chain (see `canAnnounceChain()`).
  // - Timing window is approximated by cards remaining in hand (with marriage offset support).
  if (ruleset.announcements.mode !== "enabled") return false;
  if (!ruleset.announcements.declarations.includes(declaration)) return false;
  if (state.finished) return false;
  if (state.phase !== "playing") return false;
  if (seat !== state.currentSeat) return false;

  // House rule: no announcements until a marriage is resolved.
  if (
    state.gameMode.kind === "marriage" &&
    !state.gameMode.forced &&
    state.gameMode.partnerSeat === null
  ) {
    return false;
  }

  const team = state.teamBySeat[seat];
  if (declaration === "Re" && team !== "re") return false;
  if (declaration === "Kontra" && team !== "kontra") return false;

  // Check if announcement already made by team
  if (
    state.announcements.some(
      (entry) => entry.team === team && entry.declaration === declaration,
    )
  )
    return false;

  // Announcement requirements (number of cards remaining in hand)
  const effectiveCardsInHand = announcementCardsInHand(state, seat);
  // Standard rules:
  // Re/Kontra: 11 cards
  // No 90: 10 cards
  // No 60: 9 cards
  // No 30: 8 cards
  // Schwarz: 7 cards
  // But wait, Re/Kontra can be announced when playing the FIRST card (so 12 cards in hand, or 11 after playing).
  // Standard DDV:
  // Re/Kontra: until 1st card of 1st trick is played (12 cards) or until 1st card of 2nd trick if you are NOT the lead.
  // For simplicity:
  if (
    (declaration === "Re" || declaration === "Kontra") &&
    effectiveCardsInHand < 11
  )
    return false;
  if (declaration === "No90" && effectiveCardsInHand < 10) return false;
  if (declaration === "No60" && effectiveCardsInHand < 9) return false;
  if (declaration === "No30" && effectiveCardsInHand < 8) return false;
  if (declaration === "Schwarz" && effectiveCardsInHand < 7) return false;

  // Also declarations must be in order
  const hasTeamDecl = (decl: AnnouncementDeclaration): boolean =>
    state.announcements.some((a) => a.team === team && a.declaration === decl);
  const teamBase: AnnouncementDeclaration = team === "re" ? "Re" : "Kontra";

  if (declaration === "No90" && !hasTeamDecl(teamBase)) return false;
  if (declaration === "No60" && !hasTeamDecl("No90")) return false;
  if (declaration === "No30" && !hasTeamDecl("No60")) return false;
  if (declaration === "Schwarz" && !hasTeamDecl("No30")) return false;

  return true;
}

function announcementCardsInHand(state: GameState, seat: Seat): number {
  const cardsInHand = state.hands[seat].length;
  return state.gameMode.kind === "marriage"
    ? Math.min(12, cardsInHand + state.announcementTrickOffset)
    : cardsInHand;
}

function minCardsForDeclaration(
  declaration: AnnouncementDeclaration,
): number | null {
  if (declaration === "Re" || declaration === "Kontra") return 11;
  if (declaration === "No90") return 10;
  if (declaration === "No60") return 9;
  if (declaration === "No30") return 8;
  if (declaration === "Schwarz") return 7;
  return null;
}

function declarationChainFor(
  team: Team,
  target: AnnouncementDeclaration,
): AnnouncementDeclaration[] {
  const base: AnnouncementDeclaration = team === "re" ? "Re" : "Kontra";
  if (target === "Re" || target === "Kontra") return [target];
  if (target === "No90") return [base, "No90"];
  if (target === "No60") return [base, "No90", "No60"];
  if (target === "No30") return [base, "No90", "No60", "No30"];
  if (target === "Schwarz") return [base, "No90", "No60", "No30", "Schwarz"];
  return [target];
}

function canAnnounceChain(
  state: GameState,
  ruleset: Ruleset,
  seat: Seat,
  target: AnnouncementDeclaration,
): boolean {
  if (ruleset.announcements.mode !== "enabled") return false;
  if (!ruleset.announcements.declarations.includes(target)) return false;

  if (state.finished) return false;
  if (state.phase !== "playing") return false;
  if (seat !== state.currentSeat) return false;

  // House rule: no announcements until a marriage is resolved.
  if (
    state.gameMode.kind === "marriage" &&
    !state.gameMode.forced &&
    state.gameMode.partnerSeat === null
  ) {
    return false;
  }

  const team = state.teamBySeat[seat];
  const already = (decl: AnnouncementDeclaration): boolean =>
    state.announcements.some((a) => a.team === team && a.declaration === decl);
  if (already(target)) return false;

  const chain = declarationChainFor(team, target);
  const effectiveCardsInHand = announcementCardsInHand(state, seat);

  for (const decl of chain) {
    if (already(decl)) continue;
    if (!ruleset.announcements.declarations.includes(decl)) return false;
    if (decl === "Re" && team !== "re") return false;
    if (decl === "Kontra" && team !== "kontra") return false;

    const minCards = minCardsForDeclaration(decl);
    if (minCards === null) return false;
    if (effectiveCardsInHand < minCards) return false;
  }

  return true;
}

function announceDeclaration(
  state: GameState,
  ruleset: Ruleset,
  seat: Seat,
  declaration: AnnouncementDeclaration,
): EngineStep {
  if (!canAnnounceDeclaration(state, ruleset, seat, declaration)) {
    return { state, events: [] };
  }

  const team = state.teamBySeat[seat];
  const record = {
    seat,
    team,
    declaration,
    trickIndex: state.trickIndex,
  } as const;
  state.announcements.push(record);

  const events: EngineEvent[] = [
    {
      type: "AnnouncementMade",
      seat,
      team,
      declaration,
      trickIndex: state.trickIndex,
    },
  ];
  return { state, events };
}

function announceDeclarationWithChaining(
  state: GameState,
  ruleset: Ruleset,
  seat: Seat,
  declaration: AnnouncementDeclaration,
): EngineStep {
  if (declaration === "Re" || declaration === "Kontra") {
    return announceDeclaration(state, ruleset, seat, declaration);
  }
  if (!canAnnounceChain(state, ruleset, seat, declaration)) {
    return { state, events: [] };
  }

  const team = state.teamBySeat[seat];
  const chain = declarationChainFor(team, declaration);
  const trickIndex = state.trickIndex;

  const already = (decl: AnnouncementDeclaration): boolean =>
    state.announcements.some((a) => a.team === team && a.declaration === decl);

  const events: EngineEvent[] = [];
  for (const decl of chain) {
    if (already(decl)) continue;
    const record = {
      seat,
      team,
      declaration: decl,
      trickIndex,
    } as const;
    state.announcements.push(record);
    events.push({
      type: "AnnouncementMade",
      seat,
      team,
      declaration: decl,
      trickIndex,
    });
  }

  return { state, events };
}

function maybeResolveMarriageByTrick(
  state: GameState,
  winnerSeat: Seat,
  justFinishedTrick: number,
  ruleset: Ruleset,
  events: EngineEvent[],
): void {
  // Hochzeit partner finding + forcing (simplified house rules):
  // - Only applicable while in `gameMode.kind === "marriage"` with `partnerSeat === null` and `forced === false`.
  // - A partner can only be found on a NON-trump-led trick, and only if the winner is NOT the holder.
  // - The "deadline" is the first `clarificationEndsAtTrick` tricks, regardless of what was led.
  //   (Trump-led tricks still consume time; they just cannot find a partner.)
  // - Once resolved (partner found OR forced), announcement windows are shifted by `announcementTrickOffset`
  //   so that players aren't punished for the period where announcements are blocked.
  if (state.gameMode.kind !== "marriage") return;
  if (state.gameMode.partnerSeat !== null) return;
  if (state.gameMode.forced) return;

  // House rule: partner finding only occurs on "Fehlstiche" (non-trump led tricks).
  // Trump-led tricks do not "find" a partner even if another seat wins them.
  const completed = state.completedTricks[state.completedTricks.length - 1];
  const leadCard =
    completed?.index === justFinishedTrick ? completed.plays[0]?.card : null;
  if (!leadCard) return;
  const leadIsTrump = isTrump(
    leadCard,
    state.gameMode,
    state.schweineActiveSeat,
    ruleset,
  );

  const holderSeat = state.gameMode.holderSeat;
  if (!leadIsTrump && winnerSeat !== holderSeat) {
    if (state.announcementTrickOffset === 0) {
      state.announcementTrickOffset = state.completedTricks.length;
    }
    state.gameMode = {
      ...state.gameMode,
      partnerSeat: winnerSeat,
    };
    state.teamBySeat = {
      0: 0 === holderSeat || 0 === winnerSeat ? "re" : "kontra",
      1: 1 === holderSeat || 1 === winnerSeat ? "re" : "kontra",
      2: 2 === holderSeat || 2 === winnerSeat ? "re" : "kontra",
      3: 3 === holderSeat || 3 === winnerSeat ? "re" : "kontra",
    };
    events.push({
      type: "MarriagePartnerFound",
      holderSeat,
      partnerSeat: winnerSeat,
      trickIndex: justFinishedTrick,
    });
    return;
  }

  // Deadline: the first N tricks count, regardless of whether they were trump-led.
  // (Only non-trump-led tricks can *find* a partner, see above.)
  const tricksSoFar = state.completedTricks.length;
  if (tricksSoFar >= state.gameMode.clarificationEndsAtTrick) {
    if (state.announcementTrickOffset === 0) {
      state.announcementTrickOffset = state.completedTricks.length;
    }
    state.teamBySeat = makeSoloTeams(holderSeat);
    // "Hochzeit ohne Klärung": the holder continues alone as a Diamonds solo (trump structure unchanged).
    state.gameMode = {
      kind: "solo",
      soloSeat: holderSeat,
      soloType: "diamonds",
    };
    events.push({
      type: "MarriageForced",
      holderSeat,
      trickIndex: justFinishedTrick,
    });
  }
}

function canAcceptPoverty(state: GameState, seat: Seat): boolean {
  if (state.finished) return false;
  if (state.phase !== "poverty_acceptance") return false;
  if (state.currentSeat !== seat) return false;
  if (state.trick.length > 0 || state.completedTricks.length > 0) return false;
  if (state.gameMode.kind !== "poverty") return false;
  if (state.gameMode.acceptedBySeat !== null) return false;
  if (state.gameMode.povertySeat === seat) return false;
  return true;
}

function acceptPoverty(state: GameState, seat: Seat): EngineStep {
  if (!canAcceptPoverty(state, seat)) return { state, events: [] };
  if (state.gameMode.kind !== "poverty") return { state, events: [] };

  const povertySeat = state.gameMode.povertySeat;
  state.gameMode = {
    ...state.gameMode,
    acceptedBySeat: seat,
  };
  // In Poverty, the poverty seat and the accepting seat are partners (Re),
  // regardless of who holds the club queens.
  state.teamBySeat = {
    0: 0 === povertySeat || 0 === seat ? "re" : "kontra",
    1: 1 === povertySeat || 1 === seat ? "re" : "kontra",
    2: 2 === povertySeat || 2 === seat ? "re" : "kontra",
    3: 3 === povertySeat || 3 === seat ? "re" : "kontra",
  };
  state.phase = "poverty_exchange";
  state.currentSeat = povertySeat; // Start exchange with poverty seat giving cards

  return {
    state,
    events: [{ type: "PovertyAccepted", povertySeat, acceptedBySeat: seat }],
  };
}

function rejectPoverty(
  state: GameState,
  seat: Seat,
  ruleset: Ruleset,
): EngineStep {
  if (state.phase !== "poverty_acceptance" || state.currentSeat !== seat) {
    return { state, events: [] };
  }
  if (state.gameMode.kind !== "poverty") return { state, events: [] };

  const events: EngineEvent[] = [{ type: "PovertyRejected", seat }];
  const povertySeat = state.gameMode.povertySeat;
  const next = nextSeat(seat);

  if (next === povertySeat) {
    // Everyone rejected! Redeal.
    redeal(state, ruleset, "poverty_rejected", events);
  } else {
    state.currentSeat = next;
  }

  return { state, events };
}

function cardsByIds(hand: Card[], ids: readonly string[]): Card[] | null {
  const taken: Card[] = [];
  const indexById = new Map<string, number>();
  for (let i = 0; i < hand.length; i += 1) {
    indexById.set(hand[i].id, i);
  }
  for (const id of ids) {
    const idx = indexById.get(id);
    if (idx === undefined) return null;
    taken.push(hand[idx]);
  }
  return taken;
}

function removeCardsByIds(hand: Card[], ids: readonly string[]): void {
  const takenIds = new Set(ids);
  for (let i = hand.length - 1; i >= 0; i -= 1) {
    if (takenIds.has(hand[i].id)) hand.splice(i, 1);
  }
}

function exchangePovertyCards(
  state: GameState,
  povertySeat: Seat,
  acceptedBySeat: Seat,
  fromPovertyCardIds: [string, string, string],
  fromAcceptedCardIds: [string, string, string],
  ruleset: Ruleset,
): EngineStep {
  if (state.finished) return { state, events: [] };
  if (state.trick.length > 0 || state.completedTricks.length > 0)
    return { state, events: [] };
  if (state.gameMode.kind !== "poverty") return { state, events: [] };
  if (state.gameMode.povertySeat !== povertySeat) return { state, events: [] };
  if (state.gameMode.acceptedBySeat !== acceptedBySeat)
    return { state, events: [] };
  if (state.gameMode.exchangeCompleted) return { state, events: [] };

  const povertyHand = state.hands[povertySeat];
  const acceptedHand = state.hands[acceptedBySeat];

  // Anti-cheat: poverty seat must always give all trumps (<=3 by eligibility).
  const povertyTrumps = povertyHand.filter((card) =>
    isTrump(card, state.gameMode, state.schweineActiveSeat, ruleset),
  );
  const povertyOutSet = new Set(fromPovertyCardIds);
  if (povertyOutSet.size !== 3) return { state, events: [] };
  for (const trump of povertyTrumps) {
    if (!povertyOutSet.has(trump.id)) return { state, events: [] };
  }

  const acceptedOutSet = new Set(fromAcceptedCardIds);
  if (acceptedOutSet.size !== 3) return { state, events: [] };

  const povertyOut = cardsByIds(povertyHand, fromPovertyCardIds);
  const acceptedOut = cardsByIds(acceptedHand, fromAcceptedCardIds);
  if (!povertyOut || !acceptedOut) return { state, events: [] };

  removeCardsByIds(povertyHand, fromPovertyCardIds);
  removeCardsByIds(acceptedHand, fromAcceptedCardIds);

  const trumpsBackToPoverty = acceptedOut.filter((card) =>
    isTrump(card, state.gameMode),
  ).length;

  povertyHand.push(...acceptedOut);
  acceptedHand.push(...povertyOut);

  state.gameMode = {
    ...state.gameMode,
    exchangeCompleted: true,
  };

  state.teamBySeat = {
    0: 0 === povertySeat || 0 === acceptedBySeat ? "re" : "kontra",
    1: 1 === povertySeat || 1 === acceptedBySeat ? "re" : "kontra",
    2: 2 === povertySeat || 2 === acceptedBySeat ? "re" : "kontra",
    3: 3 === povertySeat || 3 === acceptedBySeat ? "re" : "kontra",
  };

  state.phase = "playing";
  state.currentSeat = nextSeat(state.soloSelection.dealerSeat);

  // After the exchange, Schweine may become possible (or move seats).
  state.schweineHolderSeat = findSchweinSeat(state.hands, state.gameMode);

  const events: EngineEvent[] = [
    {
      type: "PovertyExchanged",
      povertySeat,
      acceptedBySeat,
      cardsEachWay: 3,
      trumpsBackToPoverty,
    },
  ];

  return {
    state,
    events,
  };
}

function otherTeam(team: Team): Team {
  return team === "re" ? "kontra" : "re";
}

function determineWinningTeam(
  totals: Record<Team, TeamTotals>,
  announcements: AnnouncementRecord[],
): Team {
  // Default: Re needs 121 to win (so 120:120 goes to Kontra).
  void announcements;
  return totals.re.cardPoints > 120 ? "re" : "kontra";
}

function absageLimit(decl: AnnouncementDeclaration): number | null {
  if (decl === "No90") return 90;
  if (decl === "No60") return 60;
  if (decl === "No30") return 30;
  if (decl === "Schwarz") return 0;
  return null;
}

function absageStage(decl: AnnouncementDeclaration): number {
  if (decl === "No90") return 1;
  if (decl === "No60") return 2;
  if (decl === "No30") return 3;
  if (decl === "Schwarz") return 4;
  return 0;
}

function absageStageLabel(stage: number): AnnouncementDeclaration {
  if (stage === 1) return "No90";
  if (stage === 2) return "No60";
  if (stage === 3) return "No30";
  return "Schwarz";
}

function buildPunktespielScores(
  state: GameState,
  totals: Record<Team, TeamTotals>,
  winningTeam: Team,
): { scoreRe: TeamScore; scoreKontra: TeamScore } {
  const scores: Record<Team, { points: number; details: string[] }> = {
    re: { points: 0, details: [] },
    kontra: { points: 0, details: [] },
  };

  const add = (team: Team, pts: number, detail: string): void => {
    if (pts <= 0) return;
    scores[team].points += pts;
    scores[team].details.push(`${detail} (+${pts})`);
  };

  // Base: winner gets +1.
  add(winningTeam, 1, "Game won");

  const seatsOnTeam: Record<Team, Seat[]> = { re: [], kontra: [] };
  for (const seat of SEATS) seatsOnTeam[state.teamBySeat[seat]].push(seat);
  const soloLike =
    state.gameMode.kind === "solo" ||
    seatsOnTeam.re.length === 1 ||
    seatsOnTeam.kontra.length === 1;

  const allowSonderpunkte = !soloLike;

  // Sonderpunkt: Kontra gets +1 for winning against the elders (Normalspiel only).
  if (allowSonderpunkte && winningTeam === "kontra") {
    const isNormalOrMarriageOrPoverty =
      state.gameMode.kind === "normal" ||
      state.gameMode.kind === "poverty" ||
      (state.gameMode.kind === "marriage" &&
        state.gameMode.partnerSeat !== null);
    if (isNormalOrMarriageOrPoverty) add("kontra", 1, "Won against elders");
  }

  // Sonderpunkte (Normalspiel only; can benefit the losing side too).
  if (allowSonderpunkte) {
    for (const team of ["re", "kontra"] as const) {
      const mine = totals[team];
      if (mine.fuchsCaught > 0)
        add(team, mine.fuchsCaught, `Fox caught x${mine.fuchsCaught}`);
      if (mine.doppelkopf > 0)
        add(team, mine.doppelkopf, `Doppelkopf x${mine.doppelkopf}`);
      if (mine.karlchen > 0)
        add(team, mine.karlchen, `Karlchen x${mine.karlchen}`);
    }
  }

  // Under-X points for the winner (regardless of announcements).
  const loserTeam = otherTeam(winningTeam);
  const loserPoints = totals[loserTeam].cardPoints;
  if (loserPoints < 90) add(winningTeam, 1, "Opponent under 90");
  if (loserPoints < 60) add(winningTeam, 1, "Opponent under 60");
  if (loserPoints < 30) add(winningTeam, 1, "Opponent under 30");
  if (loserPoints === 0) add(winningTeam, 1, "Opponent schwarz");

  // Announcement points (stakes).
  // We interpret announcements as "at stake" points that are awarded based on success/failure:
  // - Re / Kontra: worth +2; success means declaring team wins the hand.
  // - Absagen: worth +1 each; success means the declaring team held the opponent under the limit.
  //
  // Chained announcements create multiple records; within a team, each declaration is unique.
  const unique = new Map<string, AnnouncementRecord>();
  for (const a of state.announcements)
    unique.set(`${a.team}:${a.declaration}`, a);

  for (const a of unique.values()) {
    if (a.declaration === "Re" || a.declaration === "Kontra") {
      const awarded = a.team === winningTeam ? a.team : otherTeam(a.team);
      add(awarded, 2, `${a.declaration} announced`);
      continue;
    }

    const limit = absageLimit(a.declaration);
    if (limit === null) continue;

    const opp = otherTeam(a.team);
    const oppPts = totals[opp].cardPoints;
    const success = a.declaration === "Schwarz" ? oppPts === 0 : oppPts < limit;
    const awarded = success ? a.team : opp;
    add(awarded, 1, `${a.declaration} ${success ? "made" : "failed"}`);
  }

  // "Gegen die Absage" points:
  // If an absage chain is missed by at least one full "tier" (30 points),
  // the opponent receives +1 per achieved tier.
  for (const team of ["re", "kontra"] as const) {
    const declared = Array.from(unique.values())
      .filter((a) => a.team === team)
      .reduce((max, a) => Math.max(max, absageStage(a.declaration)), 0);
    if (declared <= 0) continue;

    const opp = otherTeam(team);
    const oppPts = totals[opp].cardPoints;

    for (let stage = 1; stage <= declared; stage += 1) {
      const threshold = 120 - (stage - 1) * 30;
      if (oppPts >= threshold) {
        add(opp, 1, `Overbid: missed ${absageStageLabel(stage)}`);
      }
    }
  }

  let finalRe = scores.re.points;
  let finalKo = scores.kontra.points;

  const handValue = scores[winningTeam].points - scores[loserTeam].points;

  if (soloLike) {
    // Solo-style settlement:
    // - Soloist gets triple (±3×value)
    // - Each opponent gets single opposite (∓1×value)
    //
    // In this codebase, all solo-like games are represented as 1v3 teams (incl. silent marriage and
    // "Hochzeit ohne Klärung"). We surface per-player points via the team buckets:
    // - `scoreRe.gamePoints`: soloist points (since soloist team is Re in our conventions)
    // - `scoreKontra.gamePoints`: defender points (per defender)
    //
    // (If `handValue` ever becomes 0, the hand is a 0-point hand for everyone.)
    const soloTeam = seatsOnTeam.re.length === 1 ? "re" : "kontra";
    const defendersTeam = otherTeam(soloTeam);
    const soloSign = winningTeam === soloTeam ? 1 : -1;
    const defSign = winningTeam === defendersTeam ? 1 : -1;

    const soloPerPlayer = soloSign * 3 * handValue;
    const defPerPlayer = defSign * handValue;

    finalRe = soloTeam === "re" ? soloPerPlayer : defPerPlayer;
    finalKo = soloTeam === "kontra" ? soloPerPlayer : defPerPlayer;
  } else {
    const winnerPerPlayer = handValue;
    const loserPerPlayer = handValue === 0 ? 0 : -handValue;
    finalRe = winningTeam === "re" ? winnerPerPlayer : loserPerPlayer;
    finalKo = winningTeam === "kontra" ? winnerPerPlayer : loserPerPlayer;
  }

  if (Object.is(finalRe, -0)) finalRe = 0;
  if (Object.is(finalKo, -0)) finalKo = 0;

  return {
    scoreRe: {
      team: "re",
      gamePoints: finalRe,
      details: scores.re.details,
    },
    scoreKontra: {
      team: "kontra",
      gamePoints: finalKo,
      details: scores.kontra.details,
    },
  };
}

function resolveHand(state: GameState): EngineEvent {
  const totals = getTeamPoints(state);

  if (state.forfeitSeat !== null) {
    const losingTeam = state.teamBySeat[state.forfeitSeat];
    const winningTeam: Team = losingTeam === "re" ? "kontra" : "re";

    const seatsOnTeam: Record<Team, number> = { re: 0, kontra: 0 };
    for (const seat of SEATS) seatsOnTeam[state.teamBySeat[seat]] += 1;
    const soloLike =
      state.gameMode.kind === "solo" ||
      seatsOnTeam.re === 1 ||
      seatsOnTeam.kontra === 1;

    // Fixed settlement value for proven renege forfeits.
    const handValue = 3;

    const detailsWin = ["Win by renege forfeit"];
    const detailsLoss = ["Forfeit due to renege"];

    if (soloLike) {
      const soloTeam = seatsOnTeam.re === 1 ? "re" : "kontra";
      const defendersTeam = otherTeam(soloTeam);
      const soloSign = winningTeam === soloTeam ? 1 : -1;
      const defSign = winningTeam === defendersTeam ? 1 : -1;

      const soloPerPlayer = soloSign * 3 * handValue;
      const defPerPlayer = defSign * handValue;

      state.scoreRe = {
        team: "re",
        gamePoints: soloTeam === "re" ? soloPerPlayer : defPerPlayer,
        details: winningTeam === "re" ? detailsWin : detailsLoss,
      };
      state.scoreKontra = {
        team: "kontra",
        gamePoints: soloTeam === "kontra" ? soloPerPlayer : defPerPlayer,
        details: winningTeam === "kontra" ? detailsWin : detailsLoss,
      };
    } else {
      state.scoreRe = {
        team: "re",
        gamePoints: winningTeam === "re" ? handValue : -handValue,
        details: winningTeam === "re" ? detailsWin : detailsLoss,
      };
      state.scoreKontra = {
        team: "kontra",
        gamePoints: winningTeam === "kontra" ? handValue : -handValue,
        details: winningTeam === "kontra" ? detailsWin : detailsLoss,
      };
    }

    state.finished = true;
    return {
      type: "HandFinished",
      winningTeam,
      scoreRe: state.scoreRe,
      scoreKontra: state.scoreKontra,
      cardPointsRe: totals.re.cardPoints,
      cardPointsKontra: totals.kontra.cardPoints,
      forfeitSeat: state.forfeitSeat,
    };
  }

  const winningTeam = determineWinningTeam(totals, state.announcements);
  const scores = buildPunktespielScores(state, totals, winningTeam);
  state.scoreRe = scores.scoreRe;
  state.scoreKontra = scores.scoreKontra;
  state.finished = true;

  return {
    type: "HandFinished",
    winningTeam,
    scoreRe: state.scoreRe,
    scoreKontra: state.scoreKontra,
    cardPointsRe: totals.re.cardPoints,
    cardPointsKontra: totals.kontra.cardPoints,
    forfeitSeat: null,
  };
}

function evaluateRenonceProofs(
  state: GameState,
  playedCardId: string,
  events: EngineEvent[],
): void {
  for (const record of state.renonceRecords) {
    if (record.proved) continue;
    if (!record.legalCardIdsAtTime.includes(playedCardId)) continue;

    record.proved = true;
    record.provedAtTrickIndex = state.trickIndex;
    state.forfeitSeat = record.seat;

    const text = `Renege proved: Seat ${record.seat + 1} ignored obligation in trick ${record.trickIndex}.`;

    events.push({
      type: "RenonceProved",
      seat: record.seat,
      trickIndex: record.trickIndex,
      proofTrickIndex: state.trickIndex,
      text,
    });
  }
}

function evaluateSpecialCallouts(
  state: GameState,
  winnerSeat: Seat,
  events: EngineEvent[],
  emitCallouts: boolean,
): void {
  const plays = state.trick;
  const winnerTeam = state.teamBySeat[winnerSeat];

  const points = trickPoints(plays);
  if (points >= 40) {
    const callout = {
      kind: "Doppelkopf" as const,
      seat: winnerSeat,
      text: `Doppelkopf! Seat ${winnerSeat + 1} captured ${points} points in one trick.`,
    };
    state.specialCallouts.push(callout);
    if (emitCallouts) events.push({ type: "SpecialCallout", callout });
  }

  if (state.gameMode.kind !== "solo") {
    for (const play of plays) {
      if (play.card.suit !== "diamonds" || play.card.rank !== "A") continue;

      const ownerSeat = state.originalOwnerByCardId[play.card.id];
      if (ownerSeat === winnerSeat) continue; // Caught by self is never a capture

      // Logic: Always show "Fuchs caught" if it goes to another player,
      // UNLESS we publicly know they are partners.
      // This preserves the ambiguity/bluff if I play Fuchs to my secret partner.
      const realTeamMatch = state.teamBySeat[ownerSeat] === winnerTeam;
      const publicTeam = computePublicTeamBySeat(state);
      const publiclyKnownFriendly =
        publicTeam[ownerSeat] !== null &&
        publicTeam[winnerSeat] !== null &&
        publicTeam[ownerSeat] === publicTeam[winnerSeat];

      // If it's a friendly capture AND we know it's friendly -> Don't show (it's safe).
      // Otherwise (Hostile OR Friendly-but-secret) -> Show "Caught!"
      if (realTeamMatch && publiclyKnownFriendly) continue;

      const callout = {
        kind: "FuchsGefangen" as const,
        seat: winnerSeat,
        text: `Fox caught: Seat ${winnerSeat + 1} caught ${cardLabel(play.card)}.`,
      };
      state.specialCallouts.push(callout);
      if (emitCallouts) events.push({ type: "SpecialCallout", callout });
    }
  }

  if (state.trickIndex === 12) {
    const winningPlay = plays.find((play) => play.seat === winnerSeat);
    if (
      winningPlay &&
      winningPlay.card.suit === "clubs" &&
      winningPlay.card.rank === "J"
    ) {
      const callout = {
        kind: "Karlchen" as const,
        seat: winnerSeat,
        text: `Last Jack! Seat ${winnerSeat + 1} wins the final trick with Jack of Clubs.`,
      };
      state.specialCallouts.push(callout);
      if (emitCallouts) events.push({ type: "SpecialCallout", callout });
    }
  }
}

function playCard(
  state: GameState,
  seat: Seat,
  cardId: string,
  ruleset: Ruleset,
): EngineStep {
  if (state.finished || state.phase !== "playing") {
    return { state, events: [] };
  }
  if (state.gameMode.kind === "poverty" && !state.gameMode.exchangeCompleted) {
    return { state, events: [] };
  }
  if (seat !== state.currentSeat) {
    return { state, events: [] };
  }

  const events: EngineEvent[] = [];

  const hand = state.hands[seat];
  const cardIndex = findCardIndex(hand, cardId);
  if (cardIndex < 0) {
    return { state, events: [] };
  }

  const card = hand[cardIndex];

  const legal = isLegalPlay(
    hand,
    state.trick,
    cardId,
    state.gameMode,
    state.schweineActiveSeat,
    ruleset,
  );
  if (!legal && !ruleset.allowIllegalPlays) {
    return { state, events: [] };
  }

  // House rule: "Schweine announced while playing them" (no pre-announce needed).
  // This must happen after legality validation so a rejected action is atomic.
  if (
    ruleset.schweine.mode === "announce_while_playing" &&
    ruleset.schweine.announce === "auto"
  ) {
    const trumpSuit = getTrumpSuit(state.gameMode);
    const isPigCard =
      trumpSuit !== null && card.suit === trumpSuit && card.rank === "A";
    if (isPigCard) {
      announceSchweine(state, ruleset, seat, "during", events);
    }
  }
  // ... rest of function

  hand.splice(cardIndex, 1);

  if (!legal) {
    const legalCardIdsAtTime = legalCardsForPlay(
      [...hand, card],
      state.trick,
      state.gameMode,
      state.schweineActiveSeat,
      ruleset,
    ).map((entry) => entry.id);
    const lead = state.trick[0]?.card ?? null;
    state.renonceRecords.push({
      seat,
      trickIndex: state.trickIndex,
      leadKind:
        lead && isTrump(lead, state.gameMode, state.schweineActiveSeat, ruleset)
          ? "trump"
          : "suit",
      leadSuit: lead?.suit ?? null,
      legalCardIdsAtTime,
      proved: false,
      provedAtTrickIndex: null,
    });

    events.push({
      type: "IllegalPlayRecorded",
      seat,
      trickIndex: state.trickIndex,
    });
  }

  state.trick.push({ seat, card, wasLegal: legal });
  state.seenCards.add(card.id);
  events.push({ type: "CardPlayed", seat, cardId: card.id, wasLegal: legal });

  evaluateRenonceProofs(state, card.id, events);

  if (state.trick.length < 4) {
    state.currentSeat = nextSeat(seat);
    return { state, events };
  }

  const winnerPlay = winnerOfTrick(
    state.trick,
    state.trickIndex,
    state.schweineActiveSeat,
    ruleset,
    state.gameMode,
  );
  const points = trickPoints(state.trick);

  state.completedTricks.push({
    index: state.trickIndex,
    plays: [...state.trick],
    winner: winnerPlay.seat,
    points,
  });

  state.capturedBySeat[winnerPlay.seat].push(
    ...state.trick.map((play) => play.card),
  );

  events.push({
    type: "TrickWon",
    trickIndex: state.trickIndex,
    winner: winnerPlay.seat,
    points,
  });

  maybeResolveMarriageByTrick(
    state,
    winnerPlay.seat,
    state.trickIndex,
    ruleset,
    events,
  );
  evaluateSpecialCallouts(
    state,
    winnerPlay.seat,
    events,
    ruleset.enableCallouts,
  );

  state.trick = [];
  state.currentSeat = winnerPlay.seat;
  state.trickIndex += 1;

  if (state.completedTricks.length === 12) {
    events.push(resolveHand(state));
  }

  return { state, events };
}

/**
 * Creates a new Doppelkopf engine state.
 *
 * Engine Intent & Invariants:
 * - The engine supports Marriage (Hochzeit), Poverty (Armut), and Schmeißen as baseline house rules.
 * - `ruleset.experienceMode === "oblivious"` suppresses meta-systems (chosen solos, poverty declarations,
 *   schmeißen, announcements) rather than implementing a different ruleset. A silent marriage
 *   (holding 2x Q♣ without declaring) still naturally produces a 1v3 team split and solo settlement.
 * - Scoring follows the documented DDV TSR-style model (with our explicit house rules), not raw tournament
 *   settlement.
 */
export function createEngine(
  seed?: number,
  _ruleset: Ruleset = rulesetStandard(),
  dealerSeat: Seat = 3,
): EngineStep {
  const resolvedSeed = seed ?? randomSeed32();
  const state = buildInitialState(resolvedSeed, dealerSeat);
  const events: EngineEvent[] = [
    { type: "HandStarted", seed: resolvedSeed },
    { type: "GameModeInitialized", mode: state.gameMode },
  ];

  return { state, events };
}

export function reduce(
  state: GameState,
  action: GameAction,
  ruleset: Ruleset = rulesetStandard(),
): EngineStep {
  if (action.type === "StartHand") {
    return createEngine(action.seed, ruleset);
  }

  if (action.type === "PassSolo") {
    return passSolo(state, action.seat, ruleset);
  }

  if (action.type === "ThrowCards") {
    return throwCards(state, action.seat, ruleset);
  }

  if (action.type === "ChooseSolo") {
    return chooseSolo(state, action.seat, action.soloType, ruleset);
  }

  if (action.type === "AnnounceSchweine") {
    const events: EngineEvent[] = [];
    announceSchweine(state, ruleset, action.seat, "during", events);
    return { state, events };
  }

  if (action.type === "Announce") {
    return announceDeclarationWithChaining(
      state,
      ruleset,
      action.seat,
      action.declaration,
    );
  }

  if (action.type === "AcceptPoverty") {
    return acceptPoverty(state, action.seat);
  }

  if (action.type === "RejectPoverty") {
    return rejectPoverty(state, action.seat, ruleset);
  }

  if (action.type === "ExchangePovertyCards") {
    return exchangePovertyCards(
      state,
      action.povertySeat,
      action.acceptedBySeat,
      action.fromPovertyCardIds,
      action.fromAcceptedCardIds,
      ruleset,
    );
  }

  if (action.type === "PlayCard") {
    return playCard(state, action.seat, action.cardId, ruleset);
  }

  return { state, events: [] };
}

export function legalMoves(
  state: GameState,
  seat: Seat,
  ruleset: Ruleset = rulesetStandard(),
): string[] {
  if (state.finished || seat !== state.currentSeat) return [];
  if (state.phase !== "playing") return [];

  // Cannot play cards during Poverty exchange phase
  if (state.gameMode.kind === "poverty" && !state.gameMode.exchangeCompleted) {
    return [];
  }

  return legalCardsForPlay(
    state.hands[seat],
    state.trick,
    state.gameMode,
    state.schweineActiveSeat,
    ruleset,
  ).map((card) => card.id);
}

export function legalAnnouncements(
  state: GameState,
  seat: Seat,
  ruleset: Ruleset = rulesetStandard(),
): AnnouncementDeclaration[] {
  if (ruleset.announcements.mode !== "enabled") return [];
  return ruleset.announcements.declarations.filter((decl) => {
    if (
      decl === "No90" ||
      decl === "No60" ||
      decl === "No30" ||
      decl === "Schwarz"
    ) {
      return canAnnounceChain(state, ruleset, seat, decl);
    }
    return canAnnounceDeclaration(state, ruleset, seat, decl);
  });
}

export function publicTeamBySeat(
  state: GameState,
): Record<Seat, Team | "unknown"> {
  const computed = computePublicTeamBySeat(state);
  return {
    0: computed[0] ?? "unknown",
    1: computed[1] ?? "unknown",
    2: computed[2] ?? "unknown",
    3: computed[3] ?? "unknown",
  };
}

export function computePublicScore(state: GameState): Record<Team, TeamTotals> {
  return getTeamPoints(state);
}
