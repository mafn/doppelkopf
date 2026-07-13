import { cardPoints } from "./deck";
import {
  type Card,
  type GameMode,
  type Suit,
  type Seat,
  type Team,
  type TrickPlay,
} from "./types";
import type { Ruleset } from "./ruleset";
import { rulesetStandard } from "./ruleset";

export const TRUMP_ORDER = [
  "clubs-Q",
  "spades-Q",
  "hearts-Q",
  "diamonds-Q",
  "clubs-J",
  "spades-J",
  "hearts-J",
  "diamonds-J",
  "diamonds-A",
  "diamonds-10",
  "diamonds-K",
  "diamonds-9",
];

export const SUIT_RANK_POWER: Record<Card["rank"], number> = {
  A: 6,
  "10": 5,
  K: 4,
  Q: 3,
  J: 2,
  "9": 1,
};

export function getTrumpSuit(gameMode: GameMode): Suit | null {
  if (gameMode.kind === "solo") {
    if (["clubs", "spades", "hearts", "diamonds"].includes(gameMode.soloType)) {
      return gameMode.soloType as Suit;
    }
    return null;
  }
  return "diamonds";
}

export function isTrump(
  card: Card,
  gameMode: GameMode = { kind: "normal" },
  schweineActiveSeat: Seat | null = null,
  ruleset?: Ruleset,
): boolean {
  const trumpSuit = getTrumpSuit(gameMode);

  // If this card is an active Schwein, it is ALWAYS a trump
  if (
    ruleset &&
    ruleset.schweine.mode !== "disabled" &&
    schweineActiveSeat !== null &&
    card.suit === trumpSuit &&
    card.rank === "A"
  ) {
    // If it's a solo, check if allowed
    if (gameMode.kind !== "solo" || ruleset.schweineInSolo) {
      return true;
    }
  }

  if (gameMode.kind === "solo") {
    const { soloType } = gameMode;
    if (soloType === "jack") return card.rank === "J";
    if (soloType === "queen") return card.rank === "Q";
    if (soloType === "queen_jack")
      return card.rank === "Q" || card.rank === "J";
    if (soloType === "fleischlos") return false;

    // Farbsolo: Dulle + Queens + Jacks + the suit
    if (["clubs", "spades", "hearts", "diamonds"].includes(soloType)) {
      if (card.suit === "hearts" && card.rank === "10") return true;
      if (card.rank === "Q" || card.rank === "J") return true;
      return card.suit === soloType;
    }
  }

  // Normal / Marriage / Poverty
  if (card.suit === "hearts" && card.rank === "10") return true;
  if (card.rank === "Q" || card.rank === "J") return true;
  if (card.suit === "diamonds") return true;
  return false;
}

export function trumpPower(
  card: Card,
  schweineActiveSeat: Seat | null,
  ownerSeat: Seat,
  ruleset: Ruleset,
  gameMode: GameMode = { kind: "normal" },
): number {
  if (!isTrump(card, gameMode, schweineActiveSeat, ruleset)) return 0;

  const trumpSuit = getTrumpSuit(gameMode);

  // Schweine only possible in non-solo or diamond-solo/queen-jack solo?
  // Regional rules vary, but usually Schweine are disabled in special solos.
  if (
    (gameMode.kind !== "solo" || ruleset.schweineInSolo) &&
    ruleset.schweine.mode !== "disabled" &&
    schweineActiveSeat === ownerSeat &&
    card.suit === trumpSuit &&
    card.rank === "A"
  ) {
    return 500;
  }

  if (card.suit === "hearts" && card.rank === "10") return 400;

  if (gameMode.kind === "solo") {
    const { soloType } = gameMode;
    if (soloType === "jack") {
      const order = ["clubs-J", "spades-J", "hearts-J", "diamonds-J"];
      const idx = order.indexOf(`${card.suit}-${card.rank}`);
      return idx >= 0 ? 300 - idx : 0;
    }
    if (soloType === "queen") {
      const order = ["clubs-Q", "spades-Q", "hearts-Q", "diamonds-Q"];
      const idx = order.indexOf(`${card.suit}-${card.rank}`);
      return idx >= 0 ? 300 - idx : 0;
    }
    if (soloType === "queen_jack") {
      const order = [
        "clubs-Q",
        "spades-Q",
        "hearts-Q",
        "diamonds-Q",
        "clubs-J",
        "spades-J",
        "hearts-J",
        "diamonds-J",
      ];
      const idx = order.indexOf(`${card.suit}-${card.rank}`);
      return idx >= 0 ? 300 - idx : 0;
    }
    if (["clubs", "spades", "hearts", "diamonds"].includes(soloType)) {
      // Farbsolo power: Q > J > A..9 of suit (100+)
      const qjOrder = [
        "clubs-Q",
        "spades-Q",
        "hearts-Q",
        "diamonds-Q",
        "clubs-J",
        "spades-J",
        "hearts-J",
        "diamonds-J",
      ];
      const qjIdx = qjOrder.indexOf(`${card.suit}-${card.rank}`);
      if (qjIdx >= 0) return 300 - qjIdx;

      // Suit cards
      return 100 + SUIT_RANK_POWER[card.rank];
    }
  }

  const idx = TRUMP_ORDER.indexOf(`${card.suit}-${card.rank}`);
  return idx >= 0 ? 300 - idx : 0;
}

function hasCardInLeadKind(
  hand: Card[],
  lead: Card,
  gameMode: GameMode,
  schweineActiveSeat: Seat | null,
  ruleset: Ruleset,
): boolean {
  if (isTrump(lead, gameMode, schweineActiveSeat, ruleset)) {
    return hand.some((card) =>
      isTrump(card, gameMode, schweineActiveSeat, ruleset),
    );
  }

  return hand.some(
    (card) =>
      card.suit === lead.suit &&
      !isTrump(card, gameMode, schweineActiveSeat, ruleset),
  );
}

export function legalCardsForPlay(
  hand: Card[],
  trick: TrickPlay[],
  gameMode: GameMode = { kind: "normal" },
  schweineActiveSeat: Seat | null = null,
  ruleset: Ruleset = rulesetStandard(),
): Card[] {
  if (trick.length === 0) return [...hand];

  const lead = trick[0].card;
  const mustFollow = hasCardInLeadKind(
    hand,
    lead,
    gameMode,
    schweineActiveSeat,
    ruleset,
  );
  if (!mustFollow) return [...hand];

  if (isTrump(lead, gameMode, schweineActiveSeat, ruleset)) {
    return hand.filter((card) =>
      isTrump(card, gameMode, schweineActiveSeat, ruleset),
    );
  }

  return hand.filter(
    (card) =>
      card.suit === lead.suit &&
      !isTrump(card, gameMode, schweineActiveSeat, ruleset),
  );
}

export function isLegalPlay(
  hand: Card[],
  trick: TrickPlay[],
  cardId: string,
  gameMode: GameMode = { kind: "normal" },
  schweineActiveSeat: Seat | null = null,
  ruleset: Ruleset = rulesetStandard(),
): boolean {
  return legalCardsForPlay(
    hand,
    trick,
    gameMode,
    schweineActiveSeat,
    ruleset,
  ).some((card) => card.id === cardId);
}

function compareSameTrack(
  challenger: TrickPlay,
  current: TrickPlay,
  trickIndex: number,
  schweineActiveSeat: Seat | null,
  ruleset: Ruleset,
  gameMode: GameMode,
): TrickPlay {
  const challengerCard = challenger.card;
  const currentCard = current.card;

  // Dulle rule usually only applies in normal/suit games
  const isSuitGame =
    gameMode.kind !== "solo" ||
    ["clubs", "spades", "hearts", "diamonds"].includes(gameMode.soloType);

  if (
    isSuitGame &&
    ruleset.dulleBeatsDulle !== "disabled" &&
    challengerCard.suit === "hearts" &&
    challengerCard.rank === "10" &&
    currentCard.suit === "hearts" &&
    currentCard.rank === "10"
  ) {
    if (ruleset.dulleBeatsDulle === "always") return challenger;
    if (ruleset.dulleBeatsDulle === "except_last_trick" && trickIndex < 12)
      return challenger;
    return current;
  }

  const challengerPower = trumpPower(
    challengerCard,
    schweineActiveSeat,
    challenger.seat,
    ruleset,
    gameMode,
  );
  const currentPower = trumpPower(
    currentCard,
    schweineActiveSeat,
    current.seat,
    ruleset,
    gameMode,
  );

  if (challengerPower > currentPower) return challenger;
  if (challengerPower < currentPower) return current;

  if (
    challengerCard.suit === currentCard.suit &&
    challengerCard.rank === currentCard.rank
  ) {
    return current;
  }

  const challengerSuit = SUIT_RANK_POWER[challengerCard.rank];
  const currentSuit = SUIT_RANK_POWER[currentCard.rank];
  if (challengerSuit > currentSuit) return challenger;
  if (challengerSuit < currentSuit) return current;
  return current;
}

export function winnerOfTrick(
  plays: TrickPlay[],
  trickIndex: number,
  schweineActiveSeat: Seat | null,
  ruleset: Ruleset,
  gameMode: GameMode,
): TrickPlay {
  if (plays.length === 0) {
    throw new Error(`winnerOfTrick requires at least 1 play`);
  }

  const lead = plays[0].card;
  let winner = plays[0];

  for (let i = 1; i < plays.length; i += 1) {
    const challenger = plays[i];
    const challengerTrump = isTrump(
      challenger.card,
      gameMode,
      schweineActiveSeat,
      ruleset,
    );
    const winnerTrump = isTrump(
      winner.card,
      gameMode,
      schweineActiveSeat,
      ruleset,
    );

    if (challengerTrump && !winnerTrump) {
      winner = challenger;
      continue;
    }
    if (!challengerTrump && winnerTrump) {
      continue;
    }

    if (challengerTrump && winnerTrump) {
      winner = compareSameTrack(
        challenger,
        winner,
        trickIndex,
        schweineActiveSeat,
        ruleset,
        gameMode,
      );
      continue;
    }

    if (challenger.card.suit !== lead.suit) {
      continue;
    }

    const challengerPower = SUIT_RANK_POWER[challenger.card.rank];
    const winnerPower = SUIT_RANK_POWER[winner.card.rank];
    if (challengerPower > winnerPower) {
      winner = challenger;
      continue;
    }

    if (
      challengerPower === winnerPower &&
      challenger.card.rank === winner.card.rank &&
      challenger.card.suit === winner.card.suit
    ) {
      // Identical copy loses against the earlier card.
      continue;
    }
  }

  return winner;
}

function wouldChallengerBeatCurrent(
  challenger: TrickPlay,
  current: TrickPlay,
  lead: Card,
  trickIndex: number,
  schweineActiveSeat: Seat | null,
  ruleset: Ruleset,
  gameMode: GameMode,
): boolean {
  const challengerTrump = isTrump(
    challenger.card,
    gameMode,
    schweineActiveSeat,
    ruleset,
  );
  const currentTrump = isTrump(
    current.card,
    gameMode,
    schweineActiveSeat,
    ruleset,
  );

  if (challengerTrump && !currentTrump) return true;
  if (!challengerTrump && currentTrump) return false;

  if (challengerTrump && currentTrump) {
    return (
      compareSameTrack(
        challenger,
        current,
        trickIndex,
        schweineActiveSeat,
        ruleset,
        gameMode,
      ) === challenger
    );
  }

  if (challenger.card.suit !== lead.suit) return false;
  if (current.card.suit !== lead.suit) return true;

  const challengerPower = SUIT_RANK_POWER[challenger.card.rank];
  const currentPower = SUIT_RANK_POWER[current.card.rank];
  if (challengerPower > currentPower) return true;
  if (challengerPower < currentPower) return false;

  if (
    challenger.card.rank === current.card.rank &&
    challenger.card.suit === current.card.suit
  ) {
    return false;
  }

  return false;
}

export function wouldWinTrickIfPlayed(
  trick: TrickPlay[],
  candidate: { seat: Seat; card: Card },
  trickIndex: number,
  schweineActiveSeat: Seat | null,
  ruleset: Ruleset,
  gameMode: GameMode,
): boolean {
  if (trick.length === 0) return true;

  const lead = trick[0].card;
  let winner = trick[0];

  for (let i = 1; i < trick.length; i += 1) {
    const challenger = trick[i];
    if (
      wouldChallengerBeatCurrent(
        challenger,
        winner,
        lead,
        trickIndex,
        schweineActiveSeat,
        ruleset,
        gameMode,
      )
    ) {
      winner = challenger;
    }
  }

  const candidatePlay: TrickPlay = {
    seat: candidate.seat,
    card: candidate.card,
    wasLegal: true,
  };

  return wouldChallengerBeatCurrent(
    candidatePlay,
    winner,
    lead,
    trickIndex,
    schweineActiveSeat,
    ruleset,
    gameMode,
  );
}

export function computeTeamsByQueens(
  hands: Record<Seat, Card[]>,
): Record<Seat, Team> {
  const hasClubQueen = (seat: Seat) =>
    hands[seat].some((card) => card.suit === "clubs" && card.rank === "Q");

  return {
    0: hasClubQueen(0) ? "re" : "kontra",
    1: hasClubQueen(1) ? "re" : "kontra",
    2: hasClubQueen(2) ? "re" : "kontra",
    3: hasClubQueen(3) ? "re" : "kontra",
  };
}

export function findSchweinSeat(
  hands: Record<Seat, Card[]>,
  gameMode: GameMode = { kind: "normal" },
): Seat | null {
  const suit = getTrumpSuit(gameMode);
  if (!suit) return null;
  const seats: Seat[] = [0, 1, 2, 3];
  for (const seat of seats) {
    const pigs = hands[seat].filter(
      (card) => card.suit === suit && card.rank === "A",
    );
    if (pigs.length === 2) return seat;
  }
  return null;
}

export function findMarriageSeat(hands: Record<Seat, Card[]>): Seat | null {
  const seats: Seat[] = [0, 1, 2, 3];
  for (const seat of seats) {
    const queensOfClubs = hands[seat].filter(
      (card) => card.suit === "clubs" && card.rank === "Q",
    );
    if (queensOfClubs.length === 2) return seat;
  }
  return null;
}

export function countTrumps(
  hand: Card[],
  schweineActiveSeat: Seat | null,
  ruleset: Ruleset,
  gameMode: GameMode = { kind: "normal" },
): number {
  return hand.filter((card) =>
    isTrump(card, gameMode, schweineActiveSeat, ruleset),
  ).length;
}

export function findPovertySeat(
  hands: Record<Seat, Card[]>,
  ruleset: Ruleset,
): Seat | null {
  const seats: Seat[] = [0, 1, 2, 3];
  for (const seat of seats) {
    if (countTrumps(hands[seat], null, ruleset) <= 3) return seat;
  }
  return null;
}

export function trickPoints(plays: TrickPlay[]): number {
  return plays.reduce((sum, play) => sum + cardPoints(play.card.rank), 0);
}
