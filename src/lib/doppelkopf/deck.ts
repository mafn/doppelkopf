import {
  type Card,
  type Rank,
  RANKS,
  type Seat,
  type Suit,
  SUITS,
} from "./types";
import { mulberry32 } from "../cards/rng";
import { shuffleInPlace } from "../cards/shuffle";

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      for (const copy of [0, 1] as const) {
        cards.push({
          id: `${suit}-${rank}-${copy}`,
          suit,
          rank,
          copy,
        });
      }
    }
  }
  return cards;
}

export function shuffleDeck(seed: number): Card[] {
  const rng = mulberry32(seed >>> 0);
  const deck = buildDeck();
  shuffleInPlace(deck, rng);
  return deck;
}

export function dealHands(deck: Card[]): Record<Seat, Card[]> {
  if (deck.length !== 48) {
    throw new Error(`Expected 48 cards, got ${deck.length}`);
  }

  return {
    0: deck.slice(0, 12),
    1: deck.slice(12, 24),
    2: deck.slice(24, 36),
    3: deck.slice(36, 48),
  };
}

export function cardPoints(rank: Rank): number {
  switch (rank) {
    case "A":
      return 11;
    case "10":
      return 10;
    case "K":
      return 4;
    case "Q":
      return 3;
    case "J":
      return 2;
    case "9":
      return 0;
    default:
      return 0;
  }
}

export function cardLabel(card: Card): string {
  const rankLabel: Record<Rank, string> = {
    A: "Ace",
    "10": "Ten",
    K: "King",
    Q: "Queen",
    J: "Jack",
    "9": "Nine",
  };
  const suitLabel: Record<Suit, string> = {
    clubs: "Clubs",
    spades: "Spades",
    hearts: "Hearts",
    diamonds: "Diamonds",
  };
  return `${rankLabel[card.rank]} of ${suitLabel[card.suit]}`;
}
