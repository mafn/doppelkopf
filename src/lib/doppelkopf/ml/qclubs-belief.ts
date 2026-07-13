import type { BotView, Seat } from "../types";
import { cardPoints } from "../deck";
import { trumpPower, winnerOfTrick } from "../rules";
import { computeHardTeamEvidence } from "../team-evidence";

type Hypothesis = { a: Seat; b: Seat }; // Q♣ owners (two copies), a <= b

function mod4(n: number): 0 | 1 | 2 | 3 {
  return (((n % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

function hypotheses10(): Hypothesis[] {
  const hs: Hypothesis[] = [];
  const seats: Seat[] = [0, 1, 2, 3];
  for (const a of seats) {
    for (const b of seats) {
      if (b < a) continue;
      hs.push({ a, b });
    }
  }
  // Seats 0..3 => 4 doubles + 6 splits = 10.
  if (hs.length !== 10)
    throw new Error(`Unexpected hypothesis count: ${hs.length}`);
  return hs;
}

function countQclubsInHand(view: BotView): number {
  return view.hand.filter((c) => c.suit === "clubs" && c.rank === "Q").length;
}

function countQclubsPlayedBySeat(view: BotView): Record<Seat, number> {
  const out: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const trick of view.completedTricks) {
    for (const p of trick.plays) {
      if (p.wasLegal && p.card.suit === "clubs" && p.card.rank === "Q")
        out[p.seat] += 1;
    }
  }
  for (const p of view.currentTrick) {
    if (p.wasLegal && p.card.suit === "clubs" && p.card.rank === "Q")
      out[p.seat] += 1;
  }
  // Clamp (there are only 2 copies total).
  for (const s of [0, 1, 2, 3] as Seat[]) out[s] = Math.min(2, out[s]);
  return out;
}

function seatQclubsCount(h: Hypothesis, seat: Seat): 0 | 1 | 2 {
  if (h.a === seat && h.b === seat) return 2;
  if (h.a === seat || h.b === seat) return 1;
  return 0;
}

export type QclubsBelief = {
  // Self-relative seat order: [self, next, opposite, prev].
  pRe: [number, number, number, number];
  certainty: [number, number, number, number];
  // Normalized entropy over hypotheses in [0,1] (0 = certain, 1 = maximally uncertain).
  entropy: number;
  // Debug: hypotheses (abs seats) and probabilities.
  hypotheses: Array<{ a: Seat; b: Seat; p: number }>;
};

/**
 * Computes a public-information belief over who is Re by tracking the latent distribution of the
 * two Q♣ cards across seats (10 hypotheses: 6 splits + 4 doubles).
 *
 * This is rules-consistent for normal games where "seat is Re iff seat holds >= 1 Q♣".
 * For modes where teams are explicitly defined (solo/poverty/marriage), returns a simple
 * public proxy belief rather than a Q♣-based belief.
 */
export function computeQclubsBelief(view: BotView): QclubsBelief {
  // Modes with explicit / non-Q♣ team semantics.
  if (view.gameMode.kind === "solo") {
    const pAbs: number[] = [0, 0, 0, 0];
    pAbs[view.gameMode.soloSeat] = 1;
    const pRel = [0, 0, 0, 0] as any;
    for (let rel = 0; rel < 4; rel++) pRel[rel] = pAbs[mod4(view.seat + rel)];
    const certainty = pRel.map((p: number) => Math.max(p, 1 - p)) as any;
    return { pRe: pRel, certainty, entropy: 0, hypotheses: [] };
  }

  if (view.gameMode.kind === "poverty") {
    const pAbs: number[] = [0.5, 0.5, 0.5, 0.5];
    pAbs[view.gameMode.povertySeat] = 1;
    if (view.gameMode.acceptedBySeat !== null)
      pAbs[view.gameMode.acceptedBySeat] = 1;
    const pRel = [0, 0, 0, 0] as any;
    for (let rel = 0; rel < 4; rel++) pRel[rel] = pAbs[mod4(view.seat + rel)];
    const certainty = pRel.map((p: number) => Math.max(p, 1 - p)) as any;
    return { pRe: pRel, certainty, entropy: 1, hypotheses: [] };
  }

  if (view.gameMode.kind === "marriage") {
    // Public: holder is always Re; partner is unknown until found, then certain.
    const pAbs: number[] = [0, 0, 0, 0];
    const holderSeat = view.gameMode.holderSeat;
    pAbs[holderSeat] = 1;
    if (view.gameMode.forced) {
      // Forced marriage becomes 1v3: only the holder is Re.
    } else if (view.gameMode.partnerSeat !== null) {
      pAbs[view.gameMode.partnerSeat] = 1;
    } else {
      // One unknown partner among remaining 3 seats.
      const others = ([0, 1, 2, 3] as Seat[]).filter((s) => s !== holderSeat);
      for (const s of others) pAbs[s] = 1 / 3;
    }
    const pRel = [0, 0, 0, 0] as any;
    for (let rel = 0; rel < 4; rel++) pRel[rel] = pAbs[mod4(view.seat + rel)];
    const certainty = pRel.map((p: number) => Math.max(p, 1 - p)) as any;
    return { pRe: pRel, certainty, entropy: 1, hypotheses: [] };
  }

  // Q♣ belief (hard evidence only).
  const hs = hypotheses10();
  const qHand = countQclubsInHand(view);
  const qPlayed = countQclubsPlayedBySeat(view);
  const hardTeams = computeHardTeamEvidence(view).merged;

  const weights: number[] = new Array(hs.length).fill(0);
  const softLogits: number[] = new Array(hs.length).fill(0);

  // Soft evidence: points dumping, overtaking partner.
  const kPoints = 0.25; // Log-odds bonus for dumping points to partner.
  const kOvertake = -0.3; // Log-odds penalty for overtaking partner.

  for (let i = 0; i < hs.length; i++) {
    const h = hs[i]!;
    const isReAbs = (s: Seat) => s === h.a || s === h.b;

    // Own-hand constraint.
    const mine = seatQclubsCount(h, view.seat);
    if (qHand === 0 && mine !== 0) continue;
    if (qHand === 1 && mine !== 1) continue;
    if (qHand >= 2 && mine !== 2) continue;

    // Played evidence: cannot exceed actual copies in hypothesis.
    let ok = true;
    for (const s of [0, 1, 2, 3] as Seat[]) {
      const cnt = seatQclubsCount(h, s);
      if (qPlayed[s] > cnt) {
        ok = false;
        break;
      }
      const hard = hardTeams[s];
      if (hard === "re" && cnt === 0) {
        ok = false;
        break;
      }
      if (hard === "kontra" && cnt !== 0) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    weights[i] = 1;

    // Calculate soft evidence for this hypothesis.
    let logit = 0;
    for (const trick of view.completedTricks) {
      const winner = trick.winner;
      const winnerIsRe = isReAbs(winner);

      for (let j = 0; j < trick.plays.length; j++) {
        const p = trick.plays[j]!;
        if (p.seat === winner) continue;

        const pIsRe = isReAbs(p.seat);
        const sameTeam = pIsRe === winnerIsRe;
        const pts = cardPoints(p.card.rank);

        // Point dumping
        if (pts >= 10) {
          logit += sameTeam ? kPoints : -kPoints;
        }

        // Overtaking (very simplified: did a later player on same team take the lead from another?)
        if (sameTeam && j > 0) {
          const prevWinner =
            j === 0
              ? null
              : (() => {
                  const hypo = trick.plays.slice(0, j);
                  return winnerOfTrick(
                    hypo,
                    trick.index,
                    view.schweineActiveSeat,
                    view.ruleset,
                    view.gameMode,
                  );
                })();
          if (prevWinner && isReAbs(prevWinner.seat) === pIsRe) {
            const pow = trumpPower(
              p.card,
              view.schweineActiveSeat,
              p.seat,
              view.ruleset,
              view.gameMode,
            );
            const winPow = trumpPower(
              prevWinner.card,
              view.schweineActiveSeat,
              prevWinner.seat,
              view.ruleset,
              view.gameMode,
            );
            if (pow > winPow) {
              // Unnecessary overtake? (If opponent had already beaten it, it's not an overtake).
              // But we only care if p actually beats prevWinner.
              logit += kOvertake;
            }
          }
        }
      }
    }
    softLogits[i] = logit;
  }

  // Normalize logits into probabilities.
  let sum = 0;
  const expLogits: number[] = new Array(hs.length).fill(0);
  for (let i = 0; i < hs.length; i++) {
    if (weights[i]! > 0) {
      const e = Math.exp(softLogits[i]!);
      expLogits[i] = e;
      sum += e;
    }
  }
  const probs = expLogits.map((e) => (sum > 0 ? e / sum : 0));

  const pAbs = [0, 0, 0, 0];
  for (let i = 0; i < hs.length; i++) {
    const p = probs[i]!;
    if (p <= 0) continue;
    const h = hs[i]!;
    for (const s of [0, 1, 2, 3] as Seat[]) {
      if (seatQclubsCount(h, s) > 0) pAbs[s] += p;
    }
  }

  const pRel = [0, 0, 0, 0] as any;
  for (let rel = 0; rel < 4; rel++) pRel[rel] = pAbs[mod4(view.seat + rel)];

  const certainty = pRel.map((p: number) => Math.max(p, 1 - p)) as any;

  let ent = 0;
  let nonzero = 0;
  for (const p of probs) {
    if (p > 0) {
      ent += -p * Math.log(p);
      nonzero += 1;
    }
  }
  const entNorm = nonzero > 1 ? ent / Math.log(nonzero) : 0;

  return {
    pRe: pRel,
    certainty,
    entropy: entNorm,
    hypotheses: hs.map((h, i) => ({ ...h, p: probs[i]! })),
  };
}
