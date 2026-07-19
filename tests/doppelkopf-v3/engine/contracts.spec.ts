import { test, expect } from "@playwright/test";
import type {
  GamePhaseV3,
  GameStateV3,
  GameActionV3,
  AgentObservationV3,
  TransitionResult,
  PartyState,
} from "../../../src/lib/doppelkopf/v3/engine";

// Compile-time exhaustive checks for unions
test("compile-time exhaustive phase check", () => {
  const check = (phase: GamePhaseV3) => {
    switch (phase) {
      case "reservations":
      case "poverty_acceptance":
      case "poverty_exchange":
      case "play":
      case "completed":
        break;
      default:
        const _exhaustiveCheck: never = phase;
        return _exhaustiveCheck;
    }
  };
  expect(check).toBeDefined();
});

test("compile-time exhaustive state check", () => {
  const check = (state: GameStateV3) => {
    switch (state.phase) {
      case "reservations":
      case "poverty_acceptance":
      case "poverty_exchange":
      case "play":
      case "completed":
        break;
      default:
        const _exhaustiveCheck: never = state;
        return _exhaustiveCheck;
    }
  };
  expect(check).toBeDefined();
});

test("compile-time exhaustive action check", () => {
  const check = (action: GameActionV3) => {
    switch (action.type) {
      case "reservation_pass":
      case "throw":
      case "hochzeit":
      case "armut":
      case "solo":
      case "poverty_accept":
      case "poverty_reject":
      case "poverty_offer":
      case "poverty_return":
      case "meta_pass":
      case "announce":
      case "declare_schweine":
      case "declare_superschweine":
      case "play_card":
        break;
      default:
        const _exhaustiveCheck: never = action;
        return _exhaustiveCheck;
    }
  };
  expect(check).toBeDefined();
});

test("negative type assertions separating observation from authoritative state", () => {
  // Ensure AgentObservationV3 cannot be accidentally assigned to GameStateV3
  // By requiring a typescript error when attempting to assign observation to state
  type IsAssignable<T, U> = T extends U ? true : false;

  const isObsState: IsAssignable<AgentObservationV3, GameStateV3> = false;
  expect(isObsState).toBe(false);

  // observation has no parties field
  type HasParties<T> = "parties" extends keyof T ? true : false;
  const obsHasParties: HasParties<AgentObservationV3> = false;
  expect(obsHasParties).toBe(false);

  // observation has no activeSeat field
  type HasActiveSeat<T> = "activeSeat" extends keyof T ? true : false;
  const obsHasActiveSeat: HasActiveSeat<AgentObservationV3> = false;
  expect(obsHasActiveSeat).toBe(false);
});

test("unresolved hochzeit is a contingent party state", () => {
  const contingentParty: PartyState = {
    type: "contingent",
    hochzeitSeat: 0,
  };
  expect(contingentParty.type).toBe("contingent");
});

test("transition result is discriminated", () => {
  const result: TransitionResult = {
    accepted: false,
    state: {} as any,
    reason: "wrong_phase",
  };
  if (!result.accepted) {
    expect(result.reason).toBe("wrong_phase");
  }
});
