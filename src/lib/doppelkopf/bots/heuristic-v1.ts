import { cardPoints } from "../deck";
import {
  getTrumpSuit,
  isTrump,
  SUIT_RANK_POWER,
  trumpPower,
  countTrumps,
} from "../rules";
import {
  type BotView,
  type Card,
  type GameMode,
  type Seat,
  type Team,
  type TrickPlay,
} from "../types";
import type { Ruleset } from "../ruleset";
import { computeHardTeamEvidence } from "../team-evidence";

function compareSameTrack(
  challenger: { card: Card; seat: Seat },
  current: { card: Card; seat: Seat },
  trickIndex: number,
  schweineActiveSeat: Seat | null,
  ruleset: Ruleset,
  gameMode: GameMode,
): boolean {
  const challengerCard = challenger.card;
  const currentCard = current.card;

  // Dulle rule usually only applies in normal/suit games
  const isSuitGame =
    gameMode.kind !== "solo" ||
    ["clubs", "spades", "hearts", "diamonds"].includes(gameMode.soloType);

  if (
    isSuitGame &&
    ruleset.dulleBeatsDulle !== "disabled" &&
    challengerCard.suit === "hearts" &&
    challengerCard.rank === "10" &&
    currentCard.suit === "hearts" &&
    currentCard.rank === "10"
  ) {
    if (ruleset.dulleBeatsDulle === "always") return true;
    if (ruleset.dulleBeatsDulle === "except_last_trick" && trickIndex < 12)
      return true;
    return false;
  }

  const challengerPower = trumpPower(
    challengerCard,
    schweineActiveSeat,
    challenger.seat,
    ruleset,
    gameMode,
  );
  const currentPower = trumpPower(
    currentCard,
    schweineActiveSeat,
    current.seat,
    ruleset,
    gameMode,
  );

  if (challengerPower > currentPower) return true;
  if (challengerPower < currentPower) return false;

  // Identical power: earlier card wins.
  return false;
}

export function getKnownTeams(
  view: BotView,
): Record<Seat, Team | "unknown" | "likely_re"> {
  const hardEvidence = computeHardTeamEvidence(view);
  const teams: Record<Seat, Team | "unknown" | "likely_re"> = {
    0: hardEvidence.merged[0],
    1: hardEvidence.merged[1],
    2: hardEvidence.merged[2],
    3: hardEvidence.merged[3],
  };

  // Soft Inference (The "Defensive/Aggressive" hint)
  const trumpLeadsBySeat: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const unresolvedMarriage =
    view.gameMode.kind === "marriage" && view.gameMode.partnerSeat === null;
  for (const trick of view.completedTricks) {
    if (
      trick.plays.length > 0 &&
      isTrump(
        trick.plays[0].card,
        view.gameMode,
        view.schweineActiveSeat,
        view.ruleset,
      )
    ) {
      // In an unresolved marriage, trump leads don't reveal the partner,
      // but the holder might still lead trumps. It's safer to skip this inference in unresolved marriage.
      if (!unresolvedMarriage) {
        trumpLeadsBySeat[trick.plays[0].seat]++;
      }
    }
  }

  for (const s of [0, 1, 2, 3] as Seat[]) {
    if (teams[s] === "unknown" && trumpLeadsBySeat[s] >= 2) {
      teams[s] = "likely_re";
    }
  }

  return teams;
}

function isCurrentlyWinning(
  view: BotView,
  card: Card,
): { winner: Seat; points: number; isWinning: boolean } {
  const schweineActiveSeat = view.schweineActiveSeat;

  if (view.currentTrick.length === 0)
    return { winner: view.seat, points: 0, isWinning: true };

  const lead = view.currentTrick[0].card;
  let winnerPlay: TrickPlay = view.currentTrick[0];

  for (let i = 1; i < view.currentTrick.length; i += 1) {
    const play = view.currentTrick[i];
    const playTrump = isTrump(
      play.card,
      view.gameMode,
      schweineActiveSeat,
      view.ruleset,
    );
    const winnerTrump = isTrump(
      winnerPlay.card,
      view.gameMode,
      schweineActiveSeat,
      view.ruleset,
    );

    if (playTrump && !winnerTrump) {
      winnerPlay = play;
      continue;
    }
    if (!playTrump && winnerTrump) continue;

    if (playTrump && winnerTrump) {
      if (
        compareSameTrack(
          play,
          winnerPlay,
          view.trickIndex,
          schweineActiveSeat,
          view.ruleset,
          view.gameMode,
        )
      ) {
        winnerPlay = play;
      }
      continue;
    }

    if (play.card.suit !== lead.suit) continue;
    if (
      SUIT_RANK_POWER[play.card.rank] > SUIT_RANK_POWER[winnerPlay.card.rank]
    ) {
      winnerPlay = play;
    }
  }

  const points = view.currentTrick.reduce(
    (sum, p) => sum + cardPoints(p.card.rank),
    0,
  );

  const candidateTrump = isTrump(
    card,
    view.gameMode,
    schweineActiveSeat,
    view.ruleset,
  );
  const winnerTrump = isTrump(
    winnerPlay.card,
    view.gameMode,
    schweineActiveSeat,
    view.ruleset,
  );

  let isWinning = false;
  if (candidateTrump && !winnerTrump) isWinning = true;
  else if (!candidateTrump && winnerTrump) isWinning = false;
  else if (candidateTrump && winnerTrump) {
    isWinning = compareSameTrack(
      { card, seat: view.seat },
      winnerPlay,
      view.trickIndex,
      schweineActiveSeat,
      view.ruleset,
      view.gameMode,
    );
  } else if (card.suit === lead.suit) {
    isWinning =
      SUIT_RANK_POWER[card.rank] > SUIT_RANK_POWER[winnerPlay.card.rank];
  }

  return { winner: winnerPlay.seat, points, isWinning };
}

function scoreCandidate(
  view: BotView,
  card: Card,
  teams: Record<Seat, Team | "unknown" | "likely_re">,
): number {
  const { winner, points, isWinning } = isCurrentlyWinning(view, card);
  const myTeam = teams[view.seat];
  const winnerTeam = teams[winner];
  const isLastPlayer = view.currentTrick.length === 3;
  const schweineActiveSeat = view.schweineActiveSeat;
  const lead = view.currentTrick[0]?.card;
  const trickIsTrump = lead
    ? isTrump(lead, view.gameMode, schweineActiveSeat, view.ruleset)
    : false;

  let score = 0;

  // Helper to check if two teams are effectively the same
  const isSameTeam = (t1: typeof myTeam, t2: typeof winnerTeam) => {
    if (t1 === "unknown" || t2 === "unknown") return false;
    if (t1 === "likely_re" && t2 === "re") return true;
    if (t1 === "re" && t2 === "likely_re") return true;
    return t1 === t2;
  };

  const isOpponent = (t1: typeof myTeam, t2: typeof winnerTeam) => {
    if (t1 === "re" || t1 === "likely_re") return t2 === "kontra";
    if (t1 === "kontra") return t2 === "re" || t2 === "likely_re";
    return false;
  };

  // 0. Schweine logic for card power
  const trumpSuit = getTrumpSuit(view.gameMode);
  const isSchwein =
    schweineActiveSeat === view.seat &&
    trumpSuit !== null &&
    card.suit === trumpSuit &&
    card.rank === "A";

  // 1. Conservation Cost: High-power cards are "expensive".
  const power =
    isTrump(card, view.gameMode, schweineActiveSeat, view.ruleset) || isSchwein
      ? trumpPower(
          card,
          schweineActiveSeat,
          view.seat,
          view.ruleset,
          view.gameMode,
        )
      : SUIT_RANK_POWER[card.rank];
  // Exponential penalty: low trumps are cheaper than Dulle.
  // Tuned to be smaller than the win bonus (15+).
  // 400 -> (400/220)^2 ~= 3.3 penalty.
  score -= Math.pow(power / 220, 2);

  if (view.currentTrick.length === 0) {
    // Leading
    if (isTrump(card, view.gameMode, schweineActiveSeat, view.ruleset)) {
      score += 2;
      // Dulle/Ace rewards only if they are actually high trumps in this mode
      if (
        card.rank === "A" &&
        card.suit === "diamonds" &&
        view.gameMode.kind !== "solo"
      )
        score += 3;
      if (
        card.rank === "10" &&
        card.suit === "hearts" &&
        isTrump(card, view.gameMode, schweineActiveSeat, view.ruleset)
      )
        score += 5;
    } else {
      score += card.rank === "A" ? 4 : 0;
      score += card.rank === "10" ? 2 : 0;
      score -= card.rank === "9" ? 2 : 0;
    }
  } else if (isWinning) {
    // We can win! Base win reward is higher now.
    score += 15;
    score += points * 0.8;

    // "Stechen" Bonus: if we are winning a color trick with a trump
    if (
      !trickIsTrump &&
      isTrump(card, view.gameMode, schweineActiveSeat, view.ruleset)
    ) {
      score += 10;
    }

    // Strategic win bonus: if there is a Dulle on the table, we MUST try to win it
    const dulleOnTable = view.currentTrick.some(
      (p) =>
        p.card.suit === "hearts" &&
        p.card.rank === "10" &&
        isTrump(p.card, view.gameMode, schweineActiveSeat, view.ruleset),
    );
    if (dulleOnTable) {
      score += 30; // Very high priority to win a Dulle trick
    }

    // Strategic win bonus for high cards
    score += cardPoints(card.rank) * 0.2;

    // Partner awareness:
    if (isSameTeam(myTeam, winnerTeam)) {
      if (isLastPlayer) {
        score -= 40; // Extremely high penalty for over-trumping partner at the end
      } else {
        if (points < 10) score -= 20;
        else score -= 10;
      }
    } else if (isOpponent(myTeam, winnerTeam)) {
      score += 15; // High priority to take points from opponents
    }
  } else {
    // Not winning
    const cardVal = cardPoints(card.rank);
    const isFuchs = card.suit === "diamonds" && card.rank === "A";

    if (isSameTeam(myTeam, winnerTeam)) {
      score += cardVal * 1.0;
      if (isFuchs) score += 15; // Good to smear Fuchs into partner's trick
    } else if (winnerTeam === "unknown") {
      score -= cardVal * 1.5;
      if (isFuchs) score -= 40; // High risk to drop Fuchs into unknown winner
    } else if (isOpponent(myTeam, winnerTeam)) {
      score -= cardVal * 2.5;
      if (isFuchs) score -= 80; // DO NOT give Fuchs to opponents
    }

    if (card.rank === "9") score += 8;
    if (isTrump(card, view.gameMode, schweineActiveSeat, view.ruleset))
      score -= 10;
  }

  // End game urgency: in final tricks, being "conservative" matters less.
  if (view.trickIndex >= 10) {
    score += power * 0.02; // Reduce the conservation penalty
  }

  return score;
}

export function pickBotCard(view: BotView): string {
  const teams = getKnownTeams(view);
  const [first] = view.legalCards;
  if (!first) throw new Error(`Bot at seat ${view.seat} has no legal cards.`);

  let best = first;
  let bestScore = -Infinity;

  for (const card of view.legalCards) {
    const score = scoreCandidate(view, card, teams);
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }

  return best.id;
}

export function pickBotSolo(view: BotView): string | null {
  const myHand = view.hand;
  const { ruleset } = view;

  if (
    ruleset.experienceMode === "oblivious" ||
    ruleset.solo.mode === "disabled"
  ) {
    return null;
  }

  // 1. Schmeißen (Throwing cards) check
  if (ruleset.schmeissen) {
    const kings = myHand.filter((c) => c.rank === "K").length;
    const nines = myHand.filter((c) => c.rank === "9").length;
    if (kings >= 5 || kings + nines >= 8) {
      return "throw";
    }
  }

  // 2. Always announce Marriage (Hochzeit) if allowed
  const clubQueens = myHand.filter((c) => c.suit === "clubs" && c.rank === "Q");
  if (clubQueens.length === 2) return "marriage";

  // 3. Always announce Poverty (Armut) if allowed
  if (countTrumps(myHand, null, ruleset) <= 3) return "poverty";

  // 4. Try choosing a real solo if hand is very strong
  if (ruleset.solo.mode === "enabled") {
    // Basic heuristic: bid a solo if you have an overwhelming number of high trumps for that mode.
    const allowed = ruleset.solo.allowed;

    // Queen Solo
    if (allowed.includes("queen")) {
      const queens = myHand.filter((c) => c.rank === "Q").length;
      if (queens >= 4) return "queen";
    }

    // Jack Solo
    if (allowed.includes("jack")) {
      const jacks = myHand.filter((c) => c.rank === "J").length;
      if (jacks >= 4) return "jack";
    }

    // Suit Solos (e.g. Clubs, Spades, Hearts)
    const suits = ["clubs", "spades", "hearts"] as const;
    for (const suit of suits) {
      if (allowed.includes(suit)) {
        const suitTrumps = myHand.filter(
          (c) =>
            c.rank === "Q" ||
            c.rank === "J" ||
            c.suit === suit ||
            (c.suit === "hearts" && c.rank === "10"),
        ).length;
        // Count top trumps
        const topTrumps = myHand.filter(
          (c) =>
            c.rank === "Q" ||
            c.rank === "J" ||
            (c.suit === "hearts" && c.rank === "10"),
        ).length;
        if (suitTrumps >= 8 && topTrumps >= 4) return suit;
      }
    }

    // Fleischlos
    if (allowed.includes("fleischlos")) {
      const acesAndTens = myHand.filter(
        (c) => c.rank === "A" || c.rank === "10",
      ).length;
      if (acesAndTens >= 8) return "fleischlos";
    }
  }

  // 5. Pass otherwise
  return null;
}
