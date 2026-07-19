export type Seat = 0 | 1 | 2 | 3;
export type RelativeSeat = 0 | 1 | 2 | 3; // 0 = self

export type CardId = string; // Canonical format, e.g., "HA", "T9"

export type EngineSchemaV3 = "doko-engine-v3";
export type ReplaySchemaV3 = "doko-replay-v3";
export type ObservationSchemaV3 = "doko-observation-v3";

export type SeatUtility = Readonly<Record<Seat, number>>;

// Compile-time representation of rule configuration.
export interface RulesetV3 {
  hash: string;
  [key: string]: unknown; // To be sharpened by ENG3-004
}

export interface GameDefinition {
  engineSchema: EngineSchemaV3;
  rulesetId: string;
  rulesetHash: string;
  rules: RulesetV3;
  seed: number;
  dealer: Seat;
}

export type IllegalActionReason =
  | "wrong_seat"
  | "wrong_phase"
  | "unknown_action"
  | "malformed_action"
  | "rule_violation";

export type HandContextV3 = unknown; // PROVISIONAL - subject to change until V3.0a
export type PrngDescriptor = unknown; // PROVISIONAL - subject to change until V3.0a
