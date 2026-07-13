import { cardPoints } from "../deck";
import {
  getTrumpSuit,
  isTrump,
  SUIT_RANK_POWER,
  trumpPower,
  wouldWinTrickIfPlayed,
  winnerOfTrick,
} from "../rules";
import {
  type BotView,
  type Card,
  type GameMode,
  type Seat,
  type Team,
} from "../types";
import { getCardIndex } from "../ml/canonical-cards";
import { getKnownTeams, pickBotSolo } from "./heuristic-v1";

function isFox(card: Card): boolean {
  return card.suit === "diamonds" && card.rank === "A";
}

function isDulle(card: Card, gameMode: GameMode): boolean {
  return (
    card.suit === "hearts" && card.rank === "10" && isTrump(card, gameMode)
  );
}

function getCardWasteScore(
  card: Card,
  view: BotView,
): { power: number; points: number; index: number } {
  return {
    power: trumpPower(
      card,
      view.schweineActiveSeat,
      view.seat,
      view.ruleset,
      view.gameMode,
    ),
    points: cardPoints(card.rank),
    index: getCardIndex(card.id),
  };
}

function compareWaste(
  a: { power: number; points: number; index: number },
  b: { power: number; points: number; index: number },
): number {
  if (a.power !== b.power) return a.power - b.power;
  if (a.points !== b.points) return a.points - b.points;
  return a.index - b.index;
}

export function pickBotCardV2(view: BotView): string {
  const teams = getKnownTeams(view);
  const myTeam = teams[view.seat];
  const { legalCards, currentTrick, trickIndex, gameMode, ruleset } = view;

  if (legalCards.length === 0) throw new Error("No legal cards");
  if (legalCards.length === 1) return legalCards[0].id;

  // --- 1. Second Dulle Strategy (Part 1: Response) ---
  const lead = currentTrick[0]?.card;
  if (lead && isDulle(lead, gameMode)) {
    const myDulle = legalCards.find((c) => isDulle(c, gameMode));
    if (myDulle) {
      const leaderSeat = currentTrick[0].seat;
      const leaderTeam = teams[leaderSeat];
      const isPartnerLeading =
        myTeam === "re" || myTeam === "likely_re"
          ? leaderTeam === "re" || leaderTeam === "likely_re"
          : myTeam === "kontra"
            ? leaderTeam === "kontra"
            : false;

      const isOpponentLeading =
        myTeam === "re" || myTeam === "likely_re"
          ? leaderTeam === "kontra"
          : myTeam === "kontra"
            ? leaderTeam === "re" || leaderTeam === "likely_re"
            : false;

      // Rule: If opponent leads 1st Dulle, play 2nd Dulle if it beats it.
      if (
        isOpponentLeading &&
        ruleset.dulleBeatsDulle !== "disabled" &&
        (ruleset.dulleBeatsDulle === "always" ||
          (ruleset.dulleBeatsDulle === "except_last_trick" && trickIndex < 12))
      ) {
        return myDulle.id;
      }
      // Rule: If partner leads 1st Dulle, do NOT overtrump with 2nd Dulle.
      if (isPartnerLeading) {
        const others = legalCards.filter((c) => c.id !== myDulle.id);
        if (others.length > 0) {
          // Play the lowest scoring alternative instead of falling through to potentially pick Dulle anyway
          return others.sort(
            (a, b) =>
              scoreCandidateV2(view, b, teams) -
              scoreCandidateV2(view, a, teams),
          )[0].id;
        }
      }
    }
  }

  // --- 2. 4th-Seat Efficiency ---
  if (currentTrick.length === 3) {
    const currentWinner = winnerOfTrick(
      currentTrick,
      trickIndex,
      view.schweineActiveSeat,
      ruleset,
      gameMode,
    );
    const winnerTeam = teams[currentWinner.seat];
    const isPartnerWinning =
      myTeam === "re" || myTeam === "likely_re"
        ? winnerTeam === "re" || winnerTeam === "likely_re"
        : myTeam === "kontra"
          ? winnerTeam === "kontra"
          : false;

    const isOpponentWinning =
      myTeam === "re" || myTeam === "likely_re"
        ? winnerTeam === "kontra"
        : myTeam === "kontra"
          ? winnerTeam === "re" || winnerTeam === "likely_re"
          : false;

    if (isOpponentWinning || winnerTeam === "unknown") {
      const winningCards = legalCards.filter((card) =>
        wouldWinTrickIfPlayed(
          currentTrick,
          { seat: view.seat, card },
          trickIndex,
          view.schweineActiveSeat,
          ruleset,
          gameMode,
        ),
      );

      if (winningCards.length > 0) {
        // Minimize waste
        const sorted = winningCards
          .map((c) => ({ card: c, waste: getCardWasteScore(c, view) }))
          .sort((a, b) => compareWaste(a.waste, b.waste));

        // Exception: Avoid Fox or Dulle if cheaper winning trump exists
        const preferred = sorted.find(
          (s) => !isFox(s.card) && !isDulle(s.card, gameMode),
        );
        if (preferred) return preferred.card.id;
        return sorted[0].card.id;
      }
    }
  }

  // --- 3. Partner Protection / Feeding ---
  if (currentTrick.length > 0) {
    const currentWinner = winnerOfTrick(
      currentTrick,
      trickIndex,
      view.schweineActiveSeat,
      ruleset,
      gameMode,
    );
    const winnerTeam = teams[currentWinner.seat];
    const isPartnerWinning =
      myTeam === "re" || myTeam === "likely_re"
        ? winnerTeam === "re" || winnerTeam === "likely_re"
        : myTeam === "kontra"
          ? winnerTeam === "kontra"
          : false;

    if (isPartnerWinning) {
      const leadCard = currentTrick[0].card;
      const isLeadTrump = isTrump(
        leadCard,
        gameMode,
        view.schweineActiveSeat,
        ruleset,
      );
      const canFollowSuit = legalCards.some((c) => {
        if (isLeadTrump)
          return isTrump(c, gameMode, view.schweineActiveSeat, ruleset);
        return (
          c.suit === leadCard.suit &&
          !isTrump(c, gameMode, view.schweineActiveSeat, ruleset)
        );
      });

      if (!canFollowSuit) {
        const nonTrumps = legalCards.filter(
          (c) => !isTrump(c, gameMode, view.schweineActiveSeat, ruleset),
        );
        if (nonTrumps.length > 0) {
          // Discard highest-point legal non-trump
          return [...nonTrumps].sort(
            (a, b) => cardPoints(b.rank) - cardPoints(a.rank),
          )[0].id;
        } else {
          // Play lowest-point legal trump
          return [...legalCards].sort(
            (a, b) => cardPoints(a.rank) - cardPoints(b.rank),
          )[0].id;
        }
      }
    }
  }

  // --- 4. Marriage Sabotage ---
  if (
    gameMode.kind === "marriage" &&
    gameMode.partnerSeat === null &&
    !gameMode.forced &&
    trickIndex < gameMode.clarificationEndsAtTrick
  ) {
    const trumpCount = legalCards.filter((c) =>
      isTrump(c, gameMode, view.schweineActiveSeat, ruleset),
    ).length;
    const isWeakHand = trumpCount <= 4;
    const isStrongHand = trumpCount >= 7;
    const isHolder = gameMode.holderSeat === view.seat;

    if (!isHolder) {
      if (currentTrick.length === 0) {
        // Leading as non-holder
        if (isWeakHand) {
          // Sabotage Lead: burn trick without finding partner
          const myTrumps = legalCards.filter((c) =>
            isTrump(c, gameMode, view.schweineActiveSeat, ruleset),
          );
          if (myTrumps.length > 0) {
            // Lead lowest trump
            return [...myTrumps].sort(
              (a, b) =>
                trumpPower(
                  a,
                  view.schweineActiveSeat,
                  view.seat,
                  ruleset,
                  gameMode,
                ) -
                trumpPower(
                  b,
                  view.schweineActiveSeat,
                  view.seat,
                  ruleset,
                  gameMode,
                ),
            )[0].id;
          }

          // Special Lead if holder is 4th
          if (gameMode.holderSeat === (view.seat + 3) % 4) {
            const nonTrumps = legalCards.filter(
              (c) => !isTrump(c, gameMode, view.schweineActiveSeat, ruleset),
            );
            if (nonTrumps.length > 0) {
              // Group by suit
              const bySuit: Record<string, Card[]> = {};
              for (const c of nonTrumps) {
                bySuit[c.suit] = bySuit[c.suit] || [];
                bySuit[c.suit].push(c);
              }
              const longestSuit = Object.values(bySuit).sort(
                (a, b) => b.length - a.length,
              )[0];
              // Avoid Aces/10s
              const safeOnes = longestSuit.filter(
                (c) => c.rank !== "A" && c.rank !== "10",
              );
              if (safeOnes.length > 0) return safeOnes[0].id;
              return longestSuit[0].id;
            }
          }
        }
      } else {
        // Not leading
        const leadCard = currentTrick[0].card;
        const isLeadTrump = isTrump(
          leadCard,
          gameMode,
          view.schweineActiveSeat,
          ruleset,
        );

        // Partner is only found on a non-trump lead trick. If it's a trump lead, winning doesn't make us partner.
        if (!isLeadTrump) {
          if (isWeakHand) {
            // Avoid Accidental Partnership: prefer lines that do not result in us winning
            const nonWinning = legalCards.filter(
              (card) =>
                !wouldWinTrickIfPlayed(
                  currentTrick,
                  { seat: view.seat, card },
                  trickIndex,
                  view.schweineActiveSeat,
                  ruleset,
                  gameMode,
                ),
            );
            if (nonWinning.length > 0) {
              return nonWinning[0].id;
            }
          } else if (isStrongHand) {
            // Intentional Partnership: actively attempt to win
            const winning = legalCards.filter((card) =>
              wouldWinTrickIfPlayed(
                currentTrick,
                { seat: view.seat, card },
                trickIndex,
                view.schweineActiveSeat,
                ruleset,
                gameMode,
              ),
            );
            if (winning.length > 0) {
              // Pick winning card
              return winning[0].id;
            }
          }
        }
      }
    }
  }

  // --- 5. Second Dulle Strategy (Part 2: Leading) ---
  if (
    currentTrick.length === 0 &&
    trickIndex < 3 &&
    ruleset.dulleBeatsDulle !== "disabled"
  ) {
    const myDulle = legalCards.find((c) => isDulle(c, gameMode));
    if (myDulle) {
      const hasBothDullen =
        legalCards.filter((c) => isDulle(c, gameMode)).length === 2;
      const isSolo = gameMode.kind === "solo";
      const isMarriageReveal =
        gameMode.kind === "marriage" &&
        gameMode.holderSeat === view.seat &&
        gameMode.partnerSeat === null;

      if (!hasBothDullen && !isSolo && !isMarriageReveal) {
        // Avoid leading Dulle in first 3 tricks
        const alternatives = legalCards.filter((c) => !isDulle(c, gameMode));
        if (alternatives.length > 0) {
          // Fall through to heuristic scoring
        }
      }
    }
  }

  // --- Fallback to Heuristic V1 logic ---
  // (We'll re-implement the scoring here or call scoreCandidate from heuristic-v1)
  // Since heuristic-v1's scoreCandidate is not exported, I'll just use a simplified version
  // or export it from heuristic-v1.
  // For better integration, I'll just implement a baseline here that respects the above choices.

  // Re-use logic from Heuristic V1 to ensure decent play
  let best = legalCards[0];
  let bestScore = -Infinity;

  for (const card of legalCards) {
    // Avoid Dulle lead if rule 5 triggered
    if (
      currentTrick.length === 0 &&
      trickIndex < 3 &&
      isDulle(card, gameMode) &&
      ruleset.dulleBeatsDulle !== "disabled"
    ) {
      const hasBothDullen =
        legalCards.filter((c) => isDulle(c, gameMode)).length === 2;
      const isSolo = gameMode.kind === "solo";
      const isMarriageReveal =
        gameMode.kind === "marriage" &&
        gameMode.holderSeat === view.seat &&
        gameMode.partnerSeat === null;
      if (!hasBothDullen && !isSolo && !isMarriageReveal) {
        continue;
      }
    }

    const score = scoreCandidateV2(view, card, teams);
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }

  return best.id;
}

// Simplified/Modified version of Heuristic V1's scoreCandidate
function scoreCandidateV2(
  view: BotView,
  card: Card,
  teams: Record<Seat, Team | "unknown" | "likely_re">,
): number {
  const {
    currentTrick,
    trickIndex,
    gameMode,
    ruleset,
    seat,
    schweineActiveSeat,
  } = view;
  const isWinning = wouldWinTrickIfPlayed(
    currentTrick,
    { seat, card },
    trickIndex,
    schweineActiveSeat,
    ruleset,
    gameMode,
  );
  const myTeam = teams[seat];

  const currentWinner =
    currentTrick.length > 0
      ? winnerOfTrick(
          currentTrick,
          trickIndex,
          schweineActiveSeat,
          ruleset,
          gameMode,
        )
      : null;
  const winnerTeam = currentWinner ? teams[currentWinner.seat] : null;
  const pointsOnTable = currentTrick.reduce(
    (sum, p) => sum + cardPoints(p.card.rank),
    0,
  );

  const isPartnerWinning =
    currentWinner &&
    (myTeam === "re" || myTeam === "likely_re"
      ? winnerTeam === "re" || winnerTeam === "likely_re"
      : myTeam === "kontra"
        ? winnerTeam === "kontra"
        : false);

  const isOpponentWinning =
    currentWinner &&
    (myTeam === "re" || myTeam === "likely_re"
      ? winnerTeam === "kontra"
      : myTeam === "kontra"
        ? winnerTeam === "re" || winnerTeam === "likely_re"
        : false);

  let score = 0;

  // Conservation penalty
  const power = isTrump(card, gameMode, schweineActiveSeat, ruleset)
    ? trumpPower(card, schweineActiveSeat, seat, ruleset, gameMode)
    : SUIT_RANK_POWER[card.rank];
  score -= Math.pow(power / 220, 2);

  if (currentTrick.length === 0) {
    // Leading
    if (isTrump(card, gameMode, schweineActiveSeat, ruleset)) {
      score += 2;
      if (card.rank === "A" && card.suit === "diamonds") score += 3;
      if (isDulle(card, gameMode)) score += 5;
    } else {
      score += card.rank === "A" ? 4 : 0;
      score += card.rank === "10" ? 2 : 0;
      score -= card.rank === "9" ? 2 : 0;
    }
  } else if (isWinning) {
    score += 15;
    score += pointsOnTable * 0.8;

    if (isDulle(card, gameMode)) score += 10; // Value winning with a Dulle

    if (isOpponentWinning) score += 15;
    if (isPartnerWinning) {
      if (currentTrick.length === 3)
        score -= 40; // Avoid overtrumping partner
      else score -= 10;
    }
  } else {
    // Smearing / Throwing away
    const val = cardPoints(card.rank);
    if (isPartnerWinning) {
      score += val * 1.2;
      if (isFox(card)) score += 20;
    } else if (isOpponentWinning) {
      score -= val * 2.5;
      if (isFox(card)) score -= 80;
    }

    if (card.rank === "9") score += 8;
  }

  return score;
}

export function pickBotSoloV2(view: BotView): string | null {
  return pickBotSolo(view);
}
