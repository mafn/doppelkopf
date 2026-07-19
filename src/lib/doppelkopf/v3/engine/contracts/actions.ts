import type { CardId } from "./core";

// PROVISIONAL - subject to change until V3.0a
export type ReservationAction =
  | { type: "reservation_pass" }
  | { type: "throw" } // To be sharpened by ENG3-007 (may need payload)
  | { type: "hochzeit" }
  | { type: "armut" }
  | { type: "solo"; family: string };

// PROVISIONAL - subject to change until V3.0a
export type PovertyAcceptanceAction =
  | { type: "poverty_accept" }
  | { type: "poverty_reject" };

// PROVISIONAL - subject to change until V3.0a
export type PovertyExchangeAction =
  | { type: "poverty_offer"; cards: readonly CardId[] }
  | { type: "poverty_return"; cards: readonly CardId[] };

// PROVISIONAL - subject to change until V3.0a
export type MetaAction =
  | { type: "meta_pass" }
  | {
      type: "announce";
      announcement: "re" | "kontra" | "no_90" | "no_60" | "no_30" | "schwarz";
    }
  | { type: "declare_schweine" }
  | { type: "declare_superschweine" };

// PROVISIONAL - subject to change until V3.0a
export type PlayAction = { type: "play_card"; card: CardId };

export type GameActionV3 =
  | ReservationAction
  | PovertyAcceptanceAction
  | PovertyExchangeAction
  | MetaAction
  | PlayAction;

export interface LegalActionV3 {
  actionId: string;
  action: GameActionV3;
}

export type actionEquivalenceKey = string; // PROVISIONAL - subject to change until V3.0a
