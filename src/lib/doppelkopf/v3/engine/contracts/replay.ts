import type { ReplaySchemaV3, GameDefinition } from "./core";
import type { GameActionV3 } from "./actions";

export interface ReplayStepV3 {
  replaySchema: ReplaySchemaV3;
  engineVersion: string;
  definition: GameDefinition;
  action: GameActionV3;
  priorStateHash: string;
  resultingStateHash: string;
}
