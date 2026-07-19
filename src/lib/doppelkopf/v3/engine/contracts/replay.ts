import type { ReplaySchemaV3, GameDefinition } from "./core";
import type { GameActionV3 } from "./actions";

export interface ReplayV3 {
  replaySchema: ReplaySchemaV3;
  engineVersion: string;
  definition: GameDefinition;
  actions: readonly GameActionV3[];
  finalStateHash: string;
}
