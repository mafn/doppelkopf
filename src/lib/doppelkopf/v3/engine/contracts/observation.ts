import type { ObservationSchemaV3, RelativeSeat } from "./core";
import type { GamePhaseV3 } from "./state";
import type { PublicGameEvent, PrivateGameEvent } from "./events";

export interface PublicObservationV3 {
  history: readonly PublicGameEvent[];
}

export interface PrivateObservationV3 {
  hand: readonly string[];
  exchangeMemory: readonly PrivateGameEvent[];
}

export interface AgentObservationV3 {
  schema: ObservationSchemaV3;
  rulesetId: string;
  actor: RelativeSeat; // always self = 0
  decisionId: string;
  phase: GamePhaseV3;
  public: PublicObservationV3;
  private: PrivateObservationV3;
}
