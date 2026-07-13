import {
  pickBotCard as heuristicPickV1,
  pickBotSolo as heuristicPickSolo,
} from "./bots/heuristic-v1";
import { pickBotCardV2 as heuristicPickV2 } from "./bots/heuristic-v2";
import { pickMlBotCardAsync, pickMlBotSoloAsync } from "./bots/ml-bots";
import type {
  BotView,
  Card,
  GameAction,
  GameMode,
  GameState,
  Seat,
} from "./types";
import { isTrump, SUIT_RANK_POWER, trumpPower } from "./rules";
import type { Ruleset } from "./ruleset";

export type BotType =
  | "heuristic-v1"
  | "heuristic-v2"
  | "ml-v1"
  | "ml-v2"
  | "random-mix";

export function getBotType(): BotType {
  if (typeof localStorage === "undefined") return "heuristic-v2";
  const raw = localStorage.getItem("dkhub_prefs");
  if (!raw) return "heuristic-v2";
  try {
    const prefs = JSON.parse(raw);
    return prefs.botType === "heuristic-v1" ? "heuristic-v1" : "heuristic-v2";
  } catch {
    return "heuristic-v2";
  }
}

export async function pickBotCardAsync(view: BotView): Promise<string> {
  const type = getBotType();
  return pickBotCardByTypeAsync(view, type);
}

export async function pickBotCardByTypeAsync(
  view: BotView,
  type: BotType,
): Promise<string> {
  if (type === "ml-v1" || type === "ml-v2") {
    try {
      return await pickMlBotCardAsync(view, type);
    } catch (e) {
      console.error(
        "[Doppelkopf] ML bot card failed, falling back to heuristic",
        e,
      );
      return heuristicPickV1(view);
    }
  }
  if (type === "heuristic-v2") {
    return heuristicPickV2(view);
  }
  return heuristicPickV1(view);
}

export async function pickBotSoloByTypeAsync(
  view: BotView,
  type: BotType,
): Promise<GameAction> {
  if (type === "ml-v1" || type === "ml-v2") {
    try {
      return await pickMlBotSoloAsync(view, type);
    } catch (e) {
      console.error(
        "[Doppelkopf] ML bot solo failed, falling back to heuristic",
        e,
      );
    }
  }

  // Heuristic (v1 and v2 use same solo logic for now)
  const solo = heuristicPickSolo(view);
  if (solo === "throw") return { type: "ThrowCards", seat: view.seat };
  if (solo)
    return { type: "ChooseSolo", seat: view.seat, soloType: solo as any };
  return { type: "PassSolo", seat: view.seat };
}

/**
 * Shared heuristic for Poverty card exchange.
 * Centralizes the tactical logic:
 * - Poverty seat gives all trumps (up to 3).
 * - Acceptor seat gives back points (10s, then Kings) for smearing,
 *   keeps trick-winning Aces for control, and keeps trumps.
 */
export function pickHeuristicPovertyExchange(
  hands: Record<Seat, Card[]>,
  povertySeat: Seat,
  acceptedBySeat: Seat,
  gameMode: GameMode,
  schweineActiveSeat: Seat | null,
  ruleset: Ruleset,
): GameAction {
  const pHand = hands[povertySeat];
  const aHand = hands[acceptedBySeat];

  // 1. Poverty seat gives all trumps
  const pTrumps = pHand.filter((c) =>
    isTrump(c, gameMode, schweineActiveSeat, ruleset),
  );
  const pNon = pHand
    .filter((c) => !isTrump(c, gameMode, schweineActiveSeat, ruleset))
    .sort((a, b) => SUIT_RANK_POWER[a.rank] - SUIT_RANK_POWER[b.rank]);
  const fromPovertyCardIds = [...pTrumps, ...pNon]
    .slice(0, 3)
    .map((c) => c.id) as [string, string, string];

  // 2. Acceptor seat gives tactical support
  const aTrumps = aHand.filter((c) =>
    isTrump(c, gameMode, schweineActiveSeat, ruleset),
  );
  const aNon = aHand.filter(
    (c) => !isTrump(c, gameMode, schweineActiveSeat, ruleset),
  );

  const sortedNon = [...aNon].sort((a, b) => {
    const getPri = (c: Card) => {
      if (c.rank === "10") return 0; // High point smear
      if (c.rank === "K") return 1; // Low point smear (partner can smear)
      if (c.rank === "9") return 2; // Junk (keep instead of points)
      return 3; // Aces: keep for control
    };
    const priA = getPri(a);
    const priB = getPri(b);
    if (priA !== priB) return priA - priB;
    return (SUIT_RANK_POWER[a.rank] ?? 0) - (SUIT_RANK_POWER[b.rank] ?? 0);
  });

  const fromAcceptedCardIds = [
    ...sortedNon,
    ...aTrumps.sort(
      (a, b) =>
        trumpPower(a, schweineActiveSeat, acceptedBySeat, ruleset, gameMode) -
        trumpPower(b, schweineActiveSeat, acceptedBySeat, ruleset, gameMode),
    ),
  ]
    .slice(0, 3)
    .map((c) => c.id) as [string, string, string];

  return {
    type: "ExchangePovertyCards",
    povertySeat,
    acceptedBySeat,
    fromPovertyCardIds,
    fromAcceptedCardIds,
  };
}

export function pickBotPovertyAcceptance(view: BotView): GameAction {
  const hand = view.hand;
  const trumps = hand.filter((c) =>
    isTrump(c, view.gameMode, view.schweineActiveSeat, view.ruleset),
  ).length;
  const aces = hand.filter((c) => c.rank === "A").length;

  const mode = view.gameMode;
  if (mode.kind !== "poverty")
    return { type: "RejectPoverty", seat: view.seat };

  const nextSeat = (s: Seat) => ((s + 1) % 4) as Seat;
  const isLast = nextSeat(view.seat) === mode.povertySeat;

  // Rule of thumb: accept if 5+ trumps OR 4 trumps + 2 aces.
  if (trumps >= 5 || (trumps === 4 && aces >= 2)) {
    return { type: "AcceptPoverty", seat: view.seat };
  }

  // If we are last, we are slightly more desperate to accept to avoid redeal,
  // but only if we have at least SOME trumps.
  if (isLast && trumps >= 4) {
    return { type: "AcceptPoverty", seat: view.seat };
  }

  return { type: "RejectPoverty", seat: view.seat };
}

/**
 * High-level entry for poverty actions.
 */
export async function pickBotPovertyActionAsync(
  view: BotView,
  _type: BotType,
): Promise<GameAction> {
  // Currently we only have heuristic for poverty acceptance
  if (view.phase === "poverty_acceptance") {
    return pickBotPovertyAcceptance(view);
  }

  // Note: poverty_exchange requires more than BotView (it needs both hands).
  // Callers should use pickHeuristicPovertyExchange directly.
  throw new Error(
    `pickBotPovertyActionAsync called for unhandled phase ${view.phase}`,
  );
}

// Legacy support for synchronous picking (heuristic only)
export { pickBotCard, pickBotSolo } from "./bots/heuristic-v1";
