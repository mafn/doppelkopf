import type { GameDefinition } from "./core";

export interface ReplayStepV3 {
  actionId: string;
  stateHashBefore: string;
  stateHashAfter: string;
}

export interface AuthoritativeGameReplayV3 {
  replaySchema: "doko-replay-v3";
  engineVersion: string;
  definition: GameDefinition;
  steps: readonly ReplayStepV3[];
}
