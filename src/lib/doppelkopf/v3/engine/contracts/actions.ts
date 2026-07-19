import type { CardId } from "./core";

export type ReservationAction =
  | { type: "reservation_pass" }
  | { type: "throw" } // To be sharpened by ENG3-007 (may need payload)
  | { type: "hochzeit" }
  | { type: "armut" }
  | { type: "solo"; family: string };

export type PovertyAcceptanceAction =
  | { type: "poverty_accept" }
  | { type: "poverty_reject" };

export type PovertyExchangeAction =
  | { type: "poverty_offer"; cards: readonly CardId[] }
  | { type: "poverty_return"; cards: readonly CardId[] };

export type MetaAction =
  | { type: "meta_pass" }
  | {
      type: "announce";
      announcement: "re" | "kontra" | "no_90" | "no_60" | "no_30" | "schwarz";
    }
  | { type: "declare_schweine" }
  | { type: "declare_superschweine" };

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
