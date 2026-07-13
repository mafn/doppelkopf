export const SUITS = ["clubs", "spades", "hearts", "diamonds"] as const;
export const RANKS = ["A", "10", "K", "Q", "J", "9"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type Seat = 0 | 1 | 2 | 3;
export type Team = "re" | "kontra";
export type AnnouncementDeclaration =
  | "Re"
  | "Kontra"
  | "No90"
  | "No60"
  | "No30"
  | "Schwarz";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  copy: 0 | 1;
}

export interface TrickPlay {
  seat: Seat;
  card: Card;
  wasLegal: boolean;
}

export interface TrickResult {
  index: number;
  plays: TrickPlay[];
  winner: Seat;
  points: number;
}

export interface RenonceRecord {
  seat: Seat;
  trickIndex: number;
  leadKind: "trump" | "suit";
  leadSuit: Suit | null;
  legalCardIdsAtTime: string[];
  proved: boolean;
  provedAtTrickIndex: number | null;
}

export interface TeamTotals {
  cardPoints: number;
  fuchsCaught: number;
  doppelkopf: number;
  karlchen: number;
}

export interface TeamScore {
  team: Team;
  gamePoints: number;
  details: string[];
}

export interface SpecialCallout {
  kind: "Schweine" | "FuchsGefangen" | "Doppelkopf" | "Karlchen";
  seat: Seat;
  text: string;
}

export type SoloType =
  | "queen_jack"
  | "jack"
  | "queen"
  | "clubs"
  | "spades"
  | "hearts"
  | "diamonds"
  | "fleischlos"
  | "marriage"
  | "poverty";

export type GameMode =
  | { kind: "normal" }
  | {
      kind: "marriage";
      holderSeat: Seat;
      partnerSeat: Seat | null;
      clarificationEndsAtTrick: number;
      forced: boolean;
    }
  | {
      kind: "poverty";
      povertySeat: Seat;
      acceptedBySeat: Seat | null;
      exchangeCompleted: boolean;
    }
  | {
      kind: "solo";
      soloSeat: Seat;
      soloType: SoloType;
    };

export interface AnnouncementRecord {
  seat: Seat;
  team: Team;
  declaration: AnnouncementDeclaration;
  trickIndex: number;
}

export type EngineEvent =
  | { type: "HandStarted"; seed: number }
  | { type: "SoloPassed"; seat: Seat }
  | { type: "SoloChosen"; seat: Seat; soloType: SoloType }
  | { type: "SoloSelectionFinished"; gameMode: GameMode }
  | { type: "GameModeInitialized"; mode: GameMode }
  | { type: "CardsThrown"; seat: Seat; reason: string }
  | {
      type: "RedealRequired";
      cause: "poverty_rejected" | "no_solo_passed" | "cards_thrown";
    }
  | {
      type: "MarriagePartnerFound";
      holderSeat: Seat;
      partnerSeat: Seat;
      trickIndex: number;
    }
  | { type: "MarriageForced"; holderSeat: Seat; trickIndex: number }
  | { type: "PovertyAccepted"; povertySeat: Seat; acceptedBySeat: Seat }
  | { type: "PovertyRejected"; seat: Seat }
  | {
      type: "PovertyExchanged";
      povertySeat: Seat;
      acceptedBySeat: Seat;
      cardsEachWay: number;
      trumpsBackToPoverty: number;
    }
  | {
      type: "AnnouncementMade";
      seat: Seat;
      team: Team;
      declaration: AnnouncementDeclaration;
      trickIndex: number;
    }
  | { type: "SchweineAnnounced"; seat: Seat; timing: "during" }
  | { type: "CardPlayed"; seat: Seat; cardId: string; wasLegal: boolean }
  | { type: "IllegalPlayRecorded"; seat: Seat; trickIndex: number }
  | {
      type: "RenonceProved";
      seat: Seat;
      trickIndex: number;
      proofTrickIndex: number;
      text: string;
    }
  | {
      type: "TrickWon";
      trickIndex: number;
      winner: Seat;
      points: number;
    }
  | {
      type: "SpecialCallout";
      callout: SpecialCallout;
    }
  | {
      type: "HandFinished";
      winningTeam: Team;
      scoreRe: TeamScore;
      scoreKontra: TeamScore;
      cardPointsRe: number;
      cardPointsKontra: number;
      forfeitSeat: Seat | null;
    };

export type GameAction =
  | { type: "StartHand"; seed?: number }
  | { type: "ChooseSolo"; seat: Seat; soloType: SoloType }
  | { type: "PassSolo"; seat: Seat }
  | { type: "ThrowCards"; seat: Seat }
  | { type: "Announce"; seat: Seat; declaration: AnnouncementDeclaration }
  | { type: "AcceptPoverty"; seat: Seat }
  | { type: "RejectPoverty"; seat: Seat }
  | {
      type: "ExchangePovertyCards";
      povertySeat: Seat;
      acceptedBySeat: Seat;
      fromPovertyCardIds: [string, string, string];
      fromAcceptedCardIds: [string, string, string];
    }
  | { type: "AnnounceSchweine"; seat: Seat }
  | { type: "PlayCard"; seat: Seat; cardId: string };

export interface GameState {
  seed: number;
  phase:
    | "solo_selection"
    | "poverty_acceptance"
    | "poverty_exchange"
    | "playing"
    | "finished";
  /**
   * House rule support: if announcements are blocked for the opening tricks
   * (e.g. until a marriage is resolved), we shift the announcement timing windows
   * later by this number of completed tricks.
   */
  announcementTrickOffset: number;
  soloSelection: {
    dealerSeat: Seat;
    currentSeat: Seat;
    highestSolo: { seat: Seat; soloType: SoloType } | null;
    passedSeats: Set<Seat>;
  };
  gameMode: GameMode;
  schweineHolderSeat: Seat | null;
  schweineActiveSeat: Seat | null;
  hands: Record<Seat, Card[]>;
  trick: TrickPlay[];
  trickIndex: number;
  completedTricks: TrickResult[];
  capturedBySeat: Record<Seat, Card[]>;
  teamBySeat: Record<Seat, Team>;
  currentSeat: Seat;
  finished: boolean;
  forfeitSeat: Seat | null;
  renonceRecords: RenonceRecord[];
  announcements: AnnouncementRecord[];
  specialCallouts: SpecialCallout[];
  seenCards: Set<string>;
  originalOwnerByCardId: Record<string, Seat>;
  scoreRe: TeamScore | null;
  scoreKontra: TeamScore | null;
}

export interface EngineStep {
  state: GameState;
  events: EngineEvent[];
}

import type { Ruleset } from "./ruleset";

export interface BotView {
  seat: Seat;
  phase: GameState["phase"];
  hand: Card[];
  currentTrick: TrickPlay[];
  completedTricks: TrickResult[];
  legalCards: Card[];
  trickIndex: number;
  gameMode: GameMode;
  announcements: AnnouncementRecord[];
  specialCallouts: SpecialCallout[];
  schweineActiveSeat: Seat | null;
  ruleset: Ruleset;
}
