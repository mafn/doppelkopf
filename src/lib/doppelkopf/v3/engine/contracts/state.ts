import type { GameDefinition, Seat, IllegalActionReason } from "./core";
import type { PublicGameEvent, PrivateGameEvent } from "./events";

export type GamePhaseV3 =
  | "reservations"
  | "poverty_acceptance"
  | "poverty_exchange"
  | "play"
  | "completed";

export type PartyState =
  | {
      type: "resolved";
      re: readonly Seat[];
      kontra: readonly Seat[];
      soloSeat?: Seat;
    }
  | { type: "contingent"; hochzeitSeat: Seat };

export type TrickState = unknown; // To be sharpened by ENG3-005

export interface BaseGameStateV3 {
  definition: GameDefinition;
  phase: GamePhaseV3;
  activeSeat: Seat | null;
  parties: PartyState;
  tricks: readonly TrickState[];
}

export interface ReservationPhaseState extends BaseGameStateV3 {
  phase: "reservations";
  activeSeat: Seat;
}

export interface PovertyAcceptancePhaseState extends BaseGameStateV3 {
  phase: "poverty_acceptance";
  activeSeat: Seat;
}

export interface PovertyExchangePhaseState extends BaseGameStateV3 {
  phase: "poverty_exchange";
  activeSeat: Seat;
}

export interface PlayPhaseState extends BaseGameStateV3 {
  phase: "play";
  activeSeat: Seat;
}

export interface CompletedPhaseState extends BaseGameStateV3 {
  phase: "completed";
  activeSeat: null;
}

export type GameStateV3 =
  | ReservationPhaseState
  | PovertyAcceptancePhaseState
  | PovertyExchangePhaseState
  | PlayPhaseState
  | CompletedPhaseState;

export type TransitionResult =
  | {
      accepted: true;
      state: GameStateV3;
      publicEvents: readonly PublicGameEvent[];
      privateEvents: Readonly<
        Partial<Record<Seat, readonly PrivateGameEvent[]>>
      >;
    }
  | {
      accepted: false;
      state: GameStateV3;
      reason: IllegalActionReason;
    };
