export const CANONICAL_SUITS: Suit[] = [
  "clubs",
  "spades",
  "hearts",
  "diamonds",
];
export const CANONICAL_RANKS: Rank[] = ["A", "10", "K", "Q", "J", "9"];

import type { Suit, Rank } from "../types";

export interface CanonicalCard {
  id: string;
  suit: Suit;
  rank: Rank;
  copy: 0 | 1;
  index: number; // 0-47
}

export const CANONICAL_DECK: CanonicalCard[] = [];
export const CARD_ID_TO_INDEX = new Map<string, number>();

let idx = 0;
for (const suit of CANONICAL_SUITS) {
  for (const rank of CANONICAL_RANKS) {
    for (const copy of [0, 1] as const) {
      const id = `${suit}-${rank}-${copy}`;
      const card = { id, suit, rank, copy, index: idx };
      CANONICAL_DECK.push(card);
      CARD_ID_TO_INDEX.set(id, idx);
      idx++;
    }
  }
}

export function getCardIndex(cardId: string): number {
  const i = CARD_ID_TO_INDEX.get(cardId);
  if (i === undefined) throw new Error(`Unknown card ID: ${cardId}`);
  return i;
}

export function getCardFromIndex(index: number): CanonicalCard {
  const c = CANONICAL_DECK[index];
  if (!c) throw new Error(`Invalid card index: ${index}`);
  return c;
}

// --- Meta Action Space ---
// 0: Pass / Reject
// 1: Solo Queen
// 2: Solo Jack
// 3: Solo Clubs
// 4: Solo Spades
// 5: Solo Hearts
// 6: Solo Diamonds
// 7: Solo Fleischlos
// 8: Solo Marriage (Wait, Marriage is announced by playing?) No, in selection.
// 9: Accept Armut
// 10: Announce Re
// 11: Announce Kontra
// ...
export const META_ACTIONS = [
  "Pass",
  "ThrowCards",
  "Solo:queen",
  "Solo:jack",
  "Solo:queen_jack",
  "Solo:clubs",
  "Solo:spades",
  "Solo:hearts",
  "Solo:diamonds",
  "Solo:fleischlos",
  "Solo:marriage",
  "Solo:poverty",
  "AcceptPoverty",
  "RejectPoverty",
  "Announce:Re",
  "Announce:Kontra",
  "Announce:No90",
  "Announce:No60",
  "Announce:No30",
  "Announce:Schwarz",
] as const;

export function getMetaActionIndex(type: string): number {
  const i = META_ACTIONS.indexOf(type as any);
  return i; // -1 if not found
}

// --- Feature Sizes ---
// New training schema (2026-02): see `src/lib/doppelkopf/ml/feature-schema.ts`.
import { FEATURE_SIZE_V1, FEATURE_SIZE_V2 } from "./feature-schema";
export { FEATURE_SIZE_V1, FEATURE_SIZE_V2 };

// Legacy schemas (kept for offline experiments / old datasets).
export const FEATURE_SIZE_V0 = 579;
export const FEATURE_SIZE_V0_2 = FEATURE_SIZE_V0 + 4 * 48;

// Back-compat alias: treat the latest schema as default.
export const FEATURE_SIZE = FEATURE_SIZE_V2;
