import type { CardId, Seat } from "./core";
import type { GamePhaseV3 } from "./state";
import type { ReservationAction } from "./actions";

export type PublicGameEvent =
  | { type: "phase_changed"; phase: GamePhaseV3 }
  | { type: "reservation"; seat: Seat; action: ReservationAction["type"] }
  | { type: "card_played"; seat: Seat; card: CardId }
  | { type: "trick_completed"; winner: Seat; cards: readonly CardId[] }
  | { type: "announcement"; seat: Seat; announcement: string }
  | { type: "poverty_accepted"; seat: Seat }
  | { type: "poverty_rejected"; seat: Seat }
  | { type: "poverty_returned"; seat: Seat }
  | { type: "meta_pass"; seat: Seat }
  | {
      type: "schweine_declared";
      seat: Seat;
      schweineType: "schweine" | "superschweine";
    };

export type PrivateGameEvent =
  | { type: "cards_dealt"; cards: readonly CardId[] }
  | { type: "cards_received"; cards: readonly CardId[] }
  | { type: "cards_given"; cards: readonly CardId[] };
