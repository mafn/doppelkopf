import type { BotView, Seat, Suit } from "../types";
import { cardPoints } from "../deck";
import { winnerOfTrick, trumpPower, isTrump } from "../rules";
import { getCardFromIndex, getCardIndex } from "./canonical-cards";
import { computeQclubsBelief } from "./qclubs-belief";
import {
  FEATURE_SCHEMA_V1,
  FEATURE_SCHEMA_V2,
  type FeatureSchema,
} from "./feature-schema";

function mod4(n: number): 0 | 1 | 2 | 3 {
  return (((n % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

function setRelSeatOneHot(
  buf: Float32Array,
  off: number,
  absSeat: Seat,
  self: Seat,
): void {
  buf[off + mod4(absSeat - self)] = 1.0;
}

function setRelSeatOneHotOrZero(
  buf: Float32Array,
  off: number,
  absSeat: Seat | null,
  self: Seat,
): void {
  if (absSeat === null) return;
  setRelSeatOneHot(buf, off, absSeat, self);
}

function writeCardOneHot(buf: Float32Array, off: number, cardId: string): void {
  const idx = getCardIndex(cardId);
  if (idx < 0 || idx >= 48) return;
  buf[off + idx] = 1.0;
}

function trickPointsSoFar(view: BotView): number {
  let pts = 0;
  for (const p of view.currentTrick) pts += cardPoints(p.card.rank);
  return pts;
}

function pointsCapturedBySeat(view: BotView): Record<Seat, number> {
  const out: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const t of view.completedTricks) out[t.winner] += t.points;
  return out;
}

function tricksWonBySeat(view: BotView): Record<Seat, number> {
  const out: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const t of view.completedTricks) out[t.winner] += 1;
  return out;
}

function lastCompletedTricks(view: BotView, k: number) {
  const n = view.completedTricks.length;
  if (n <= 0) return [];
  const start = Math.max(0, n - k);
  return view.completedTricks.slice(start, n);
}

type VoidInfo = {
  voidSuitAbs: number[][];
  voidTrumpAbs: number[];
};

function inferVoids(view: BotView): VoidInfo {
  const voidSuitAbs: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const voidTrumpAbs: number[] = [0, 0, 0, 0];
  const suitIndex: Record<Suit, number> = {
    clubs: 0,
    spades: 1,
    hearts: 2,
    diamonds: 3,
  };

  const allTricks = [...view.completedTricks, { plays: view.currentTrick }];
  for (const trick of allTricks) {
    const plays = trick.plays;
    if (!plays || plays.length < 2) continue;
    const lead = plays[0]!;
    const leadCard = lead.card;
    const leadIsTrump = isTrump(
      leadCard,
      view.gameMode,
      view.schweineActiveSeat,
      view.ruleset,
    );
    for (let k = 1; k < plays.length; k += 1) {
      const p = plays[k]!;
      if (!p.wasLegal) continue;
      const c = p.card;
      const s = p.seat;
      const cIsTrump = isTrump(
        c,
        view.gameMode,
        view.schweineActiveSeat,
        view.ruleset,
      );
      if (leadIsTrump) {
        if (!cIsTrump) voidTrumpAbs[s] = 1;
      } else {
        const follow = !cIsTrump && c.suit === leadCard.suit;
        if (!follow) voidSuitAbs[s]![suitIndex[leadCard.suit]] = 1;
      }
    }
  }

  return { voidSuitAbs, voidTrumpAbs };
}

function announcementSlotIndex(
  decl: BotView["announcements"][number]["declaration"],
): number {
  // 0 = none, then a fixed set.
  if (decl === "Re") return 1;
  if (decl === "Kontra") return 2;
  if (decl === "No90") return 3;
  if (decl === "No60") return 4;
  if (decl === "No30") return 5;
  if (decl === "Schwarz") return 6;
  return 0;
}

function lastAnnouncementBySeat(view: BotView): Record<Seat, number> {
  // Stores a single slot index (0..7).
  const out: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const lastIdx: Record<Seat, number> = { 0: -1, 1: -1, 2: -1, 3: -1 };
  for (let i = 0; i < view.announcements.length; i += 1) {
    const a = view.announcements[i]!;
    if (a.trickIndex < lastIdx[a.seat]) continue;
    lastIdx[a.seat] = a.trickIndex;
    out[a.seat] = announcementSlotIndex(a.declaration);
  }
  return out;
}

function lastAnnouncementTrickBySeat(view: BotView): Record<Seat, number> {
  const out: Record<Seat, number> = { 0: -1, 1: -1, 2: -1, 3: -1 };
  for (const a of view.announcements) {
    out[a.seat] = Math.max(out[a.seat], a.trickIndex);
  }
  return out;
}

export type FeaturizeV1Result = {
  features: Float32Array;
  legalMask: Uint8Array; // 48
};

/**
 * V1/V2 feature vector implementation.
 * - v1: last 6 completed tricks
 * - v2: last 12 completed tricks
 */
export function featurizeInternal(
  view: BotView,
  schema: FeatureSchema,
): FeaturizeV1Result {
  const buf = new Float32Array(schema.size);
  let off = 0;

  const self = view.seat;

  // --- Hand (48)
  const handIds = new Set<string>();
  for (const c of view.hand) {
    writeCardOneHot(buf, off, c.id);
    handIds.add(c.id);
  }
  off += 48;

  // --- Current trick cards (4*48)
  for (let i = 0; i < 4; i += 1) {
    const p = view.currentTrick[i];
    if (!p) continue;
    writeCardOneHot(buf, off + i * 48, p.card.id);
  }
  off += 4 * 48;

  // --- Completed tricks: leader(4) + plays(4*48)
  const nHist = schema.version === "v2" ? 12 : 6;
  const hist = lastCompletedTricks(view, nHist);
  const histPad = nHist - hist.length;
  const histSlotValid = new Array<number>(nHist).fill(0);
  const histSlotTrickIndexNorm = new Array<number>(nHist).fill(0);

  // Left-pad with zeros (early game).
  off += histPad * (4 + 4 * 48);
  for (let j = 0; j < hist.length; j += 1) {
    const t = hist[j]!;
    const slot = histPad + j;
    histSlotValid[slot] = 1;
    histSlotTrickIndexNorm[slot] = Math.max(0, Math.min(1, t.index / 12.0));

    const leaderSeat = t.plays[0]?.seat ?? self;
    setRelSeatOneHot(buf, off, leaderSeat, self);
    off += 4;
    for (let i = 0; i < 4; i += 1) {
      const p = t.plays[i];
      if (p) writeCardOneHot(buf, off + i * 48, p.card.id);
    }
    off += 4 * 48;
  }

  // --- Seen (48) (includes current trick)
  const seenIds = new Set<string>();
  for (const t of view.completedTricks) {
    for (const p of t.plays) seenIds.add(p.card.id);
  }
  for (const p of view.currentTrick) seenIds.add(p.card.id);
  for (const id of seenIds) writeCardOneHot(buf, off, id);
  off += 48;

  // --- Meta block (256)
  const metaStart = off;

  // 0: trickIndex (0..1)
  buf[off++] = Math.max(0, Math.min(1, view.trickIndex / 12.0));

  // 1..12: history slot valid bits (max 12)
  for (let i = 0; i < nHist; i += 1) buf[off + i] = histSlotValid[i] ?? 0;
  off += 12; // Always reserve 12 for alignment in the meta block even if only 6 are used by policy

  // 13..24: history slot trick indices (max 12)
  for (let i = 0; i < nHist; i += 1)
    buf[off + i] = histSlotTrickIndexNorm[i] ?? 0;
  off += 12;

  // leader: current leader (self-relative one-hot)
  const currentLeader =
    view.currentTrick.length > 0 ? view.currentTrick[0]!.seat : self;
  setRelSeatOneHot(buf, off, currentLeader, self);
  off += 4;

  // position-in-trick one-hot (0..3)
  const pos = Math.max(0, Math.min(3, view.currentTrick.length));
  buf[off + pos] = 1.0;
  off += 4;

  // gameMode one-hot
  if (view.gameMode.kind === "normal") buf[off + 0] = 1.0;
  if (view.gameMode.kind === "marriage") buf[off + 1] = 1.0;
  if (view.gameMode.kind === "poverty") buf[off + 2] = 1.0;
  if (view.gameMode.kind === "solo") buf[off + 3] = 1.0;
  off += 4;

  // soloType (only for solo games)
  if (view.gameMode.kind === "solo") {
    const st = view.gameMode.soloType;
    const order = [
      "queen_jack",
      "queen",
      "jack",
      "fleischlos",
      "clubs",
      "spades",
      "hearts",
      "diamonds",
    ] as const;
    const idx = order.indexOf(st as any);
    if (idx >= 0) buf[off + idx] = 1.0;
  }
  off += 8;

  // Role flags and special-mode fields
  const isSoloist =
    view.gameMode.kind === "solo" && view.gameMode.soloSeat === self;
  const isSoloDefender =
    view.gameMode.kind === "solo" && view.gameMode.soloSeat !== self;
  buf[off++] = isSoloist ? 1.0 : 0.0;
  buf[off++] = isSoloDefender ? 1.0 : 0.0;

  const isMarriageHolder =
    view.gameMode.kind === "marriage" && view.gameMode.holderSeat === self;
  const marriageForced =
    view.gameMode.kind === "marriage" && view.gameMode.forced;
  buf[off++] = isMarriageHolder ? 1.0 : 0.0;
  buf[off++] = marriageForced ? 1.0 : 0.0;
  buf[off++] =
    view.gameMode.kind === "marriage"
      ? Math.max(0, Math.min(1, view.gameMode.clarificationEndsAtTrick / 12.0))
      : 0.0;

  const isPovertySeat =
    view.gameMode.kind === "poverty" && view.gameMode.povertySeat === self;
  const povertyAcceptedKnown =
    view.gameMode.kind === "poverty" && view.gameMode.acceptedBySeat !== null;
  const isPovertyAcceptor =
    view.gameMode.kind === "poverty" && view.gameMode.acceptedBySeat === self;
  const povertyExchangeCompleted =
    view.gameMode.kind === "poverty" && view.gameMode.exchangeCompleted;
  buf[off++] = isPovertySeat ? 1.0 : 0.0;
  buf[off++] = povertyAcceptedKnown ? 1.0 : 0.0;
  buf[off++] = isPovertyAcceptor ? 1.0 : 0.0;
  buf[off++] = povertyExchangeCompleted ? 1.0 : 0.0;

  // Ruleset: dulle mode (3)
  buf[off + 0] = view.ruleset.dulleBeatsDulle === "disabled" ? 1.0 : 0.0;
  buf[off + 1] =
    view.ruleset.dulleBeatsDulle === "except_last_trick" ? 1.0 : 0.0;
  buf[off + 2] = view.ruleset.dulleBeatsDulle === "always" ? 1.0 : 0.0;
  off += 3;

  // Ruleset: schweine mode (3) off / solo / on
  buf[off + 0] = view.ruleset.schweine.mode === "disabled" ? 1.0 : 0.0;
  // Reserved (kept for backwards-compatible feature offsets; announce-at-start removed).
  buf[off + 1] = 0.0;
  buf[off + 2] =
    view.ruleset.schweine.mode === "announce_while_playing" ? 1.0 : 0.0;
  off += 3;

  // Ruleset: Schweine allowed in solo
  buf[off++] = view.ruleset.schweineInSolo ? 1.0 : 0.0;

  // Ruleset: schmeissen
  buf[off++] = view.ruleset.schmeissen ? 1.0 : 0.0;

  // Schweine active
  buf[off++] = view.schweineActiveSeat !== null ? 1.0 : 0.0;
  setRelSeatOneHotOrZero(buf, off, view.schweineActiveSeat, self);
  off += 4;

  // Announcements: per seat, last declaration slot (8 one-hot)
  const lastAnn = lastAnnouncementBySeat(view);
  const lastAnnTrick = lastAnnouncementTrickBySeat(view);
  for (let rel = 0; rel < 4; rel += 1) {
    const abs = mod4(self + rel);
    const slot = lastAnn[abs as Seat] ?? 0;
    if (slot >= 0 && slot <= 7) buf[off + rel * 8 + slot] = 1.0;
  }
  off += 32;

  // Announcements: per seat, when the last announcement happened (normalized trick index; 0 if none)
  for (let rel = 0; rel < 4; rel += 1) {
    const abs = mod4(self + rel) as Seat;
    const t = lastAnnTrick[abs] ?? -1;
    buf[off + rel] = t >= 0 ? Math.max(0, Math.min(1, t / 12.0)) : 0.0;
  }
  off += 4;

  // Progress: points/tricks by seat (self-relative)
  const ptsSeat = pointsCapturedBySeat(view);
  const tricksSeat = tricksWonBySeat(view);
  for (let rel = 0; rel < 4; rel += 1) {
    const abs = mod4(self + rel);
    buf[off + rel] = Math.max(
      0,
      Math.min(1, (tricksSeat[abs as Seat] ?? 0) / 12.0),
    );
  }
  off += 4;
  for (let rel = 0; rel < 4; rel += 1) {
    const abs = mod4(self + rel);
    buf[off + rel] = Math.max(
      0,
      Math.min(1, (ptsSeat[abs as Seat] ?? 0) / 120.0),
    );
  }
  off += 4;

  buf[off++] = Math.max(0, Math.min(1, trickPointsSoFar(view) / 120.0));

  // Current trick winner (5): none + 4 seats
  if (view.currentTrick.length === 0) {
    buf[off + 0] = 1.0;
  } else {
    const w = winnerOfTrick(
      view.currentTrick,
      view.trickIndex,
      view.schweineActiveSeat,
      view.ruleset,
      view.gameMode,
    );
    buf[off + 1 + mod4(w.seat - self)] = 1.0;
  }
  off += 5;

  // Current winning card power / points (0 if no cards)
  if (view.currentTrick.length > 0) {
    const w = winnerOfTrick(
      view.currentTrick,
      view.trickIndex,
      view.schweineActiveSeat,
      view.ruleset,
      view.gameMode,
    );
    const pow = trumpPower(
      w.card,
      view.schweineActiveSeat,
      w.seat,
      view.ruleset,
      view.gameMode,
    );
    buf[off++] = Math.max(0, Math.min(1, pow / 500.0));
    buf[off++] = Math.max(0, Math.min(1, cardPoints(w.card.rank) / 11.0));
  } else {
    buf[off++] = 0.0;
    buf[off++] = 0.0;
  }

  // Lead kind (6): none, trump, clubs, spades, hearts, diamonds
  if (view.currentTrick.length === 0) {
    buf[off + 0] = 1.0;
  } else {
    const lead = view.currentTrick[0]!.card;
    const leadIsTrump = isTrump(
      lead,
      view.gameMode,
      view.schweineActiveSeat,
      view.ruleset,
    );
    if (leadIsTrump) {
      buf[off + 1] = 1.0;
    } else {
      const suitOrder: Suit[] = ["clubs", "spades", "hearts", "diamonds"];
      const si = suitOrder.indexOf(lead.suit);
      if (si >= 0) buf[off + 2 + si] = 1.0;
    }
  }
  off += 6;

  // Voids (self-relative)
  const { voidSuitAbs, voidTrumpAbs } = inferVoids(view);
  for (let rel = 0; rel < 4; rel++) {
    const abs = mod4(self + rel);
    for (let si = 0; si < 4; si++) {
      buf[off + rel * 4 + si] = voidSuitAbs[abs]![si]!;
    }
  }
  off += 16;
  for (let rel = 0; rel < 4; rel++) {
    const abs = mod4(self + rel);
    buf[off + rel] = voidTrumpAbs[abs]!;
  }
  off += 4;

  // Max unseen trump power (public: based on seen + our hand)
  let maxUnseenTrumpPower = 0;
  for (let i = 0; i < 48; i += 1) {
    const card = getCardFromIndex(i);
    if (handIds.has(card.id)) continue;
    if (seenIds.has(card.id)) continue;
    let pow = trumpPower(
      card,
      view.schweineActiveSeat,
      self,
      view.ruleset,
      view.gameMode,
    );
    if (view.schweineActiveSeat !== null) {
      // Schweine power depends on who holds them; consider worst-case holder.
      pow = Math.max(
        pow,
        trumpPower(
          card,
          view.schweineActiveSeat,
          view.schweineActiveSeat,
          view.ruleset,
          view.gameMode,
        ),
      );
    }
    if (pow > maxUnseenTrumpPower) maxUnseenTrumpPower = pow;
  }
  buf[off++] = Math.max(0, Math.min(1, maxUnseenTrumpPower / 500.0));

  // Belief (Q♣ distribution hypothesis model)
  const belief = computeQclubsBelief(view);
  const pRe = belief.pRe;
  const cert = belief.certainty;
  const pSameTeamRel: number[] = [0, 0, 0, 0];
  if (belief.hypotheses.length > 0) {
    // Exact from hypothesis distribution (normal mode).
    for (const h of belief.hypotheses) {
      const p = h.p;
      if (p <= 0) continue;
      const isReAbs = (s: Seat) => s === h.a || s === h.b;
      const selfIsRe = isReAbs(self);
      for (let rel = 0; rel < 4; rel += 1) {
        const abs = mod4(self + rel) as Seat;
        const same = isReAbs(abs) === selfIsRe ? 1 : 0;
        pSameTeamRel[rel] += p * same;
      }
    }
  } else if (view.gameMode.kind === "solo") {
    const solo = view.gameMode.soloSeat;
    for (let rel = 0; rel < 4; rel += 1) {
      const abs = mod4(self + rel) as Seat;
      pSameTeamRel[rel] =
        abs === self ? 1 : abs === solo ? 0 : self === solo ? 0 : 1;
    }
  } else if (view.gameMode.kind === "poverty") {
    const a = view.gameMode.povertySeat;
    const b = view.gameMode.acceptedBySeat;
    if (b !== null) {
      const selfIsRe = self === a || self === b;
      for (let rel = 0; rel < 4; rel += 1) {
        const abs = mod4(self + rel) as Seat;
        const isRe = abs === a || abs === b;
        pSameTeamRel[rel] = isRe === selfIsRe ? 1 : 0;
      }
    } else {
      // Unknown acceptor.
      for (let rel = 0; rel < 4; rel += 1)
        pSameTeamRel[rel] = rel === 0 ? 1 : 0.5;
    }
  } else if (view.gameMode.kind === "marriage") {
    const holder = view.gameMode.holderSeat;
    const partner = view.gameMode.partnerSeat;
    if (partner !== null) {
      const selfIsRe = self === holder || self === partner;
      for (let rel = 0; rel < 4; rel += 1) {
        const abs = mod4(self + rel) as Seat;
        const isRe = abs === holder || abs === partner;
        pSameTeamRel[rel] = isRe === selfIsRe ? 1 : 0;
      }
    } else if (view.gameMode.forced) {
      const selfIsRe = self === holder;
      for (let rel = 0; rel < 4; rel += 1) {
        const abs = mod4(self + rel) as Seat;
        const isRe = abs === holder;
        pSameTeamRel[rel] = isRe === selfIsRe ? 1 : 0;
      }
    } else {
      // Partner uniform among remaining 3 seats.
      if (self === holder) {
        pSameTeamRel[0] = 1;
        for (let rel = 1; rel < 4; rel += 1) pSameTeamRel[rel] = 1 / 3;
      } else {
        // If we are not holder: we are partner with prob 1/3, else kontra.
        pSameTeamRel[0] = 1;
        // Holder is partner iff we are partner.
        pSameTeamRel[mod4(holder - self)] = 1 / 3;
        for (const s of [0, 1, 2, 3] as Seat[]) {
          if (s === self || s === holder) continue;
          // Another non-holder seat is partner iff we are not partner AND they are chosen as partner.
          pSameTeamRel[mod4(s - self)] = (2 / 3) * (1 / 2);
        }
      }
    }
  } else {
    // Fallback: treat uncertainty as 0.5 for others.
    for (let rel = 0; rel < 4; rel += 1)
      pSameTeamRel[rel] = rel === 0 ? 1 : 0.5;
  }

  for (let rel = 0; rel < 4; rel++)
    buf[off + rel] = Math.max(0, Math.min(1, pRe[rel]!));
  off += 4;
  for (let rel = 0; rel < 4; rel++)
    buf[off + rel] = Math.max(0, Math.min(1, cert[rel]!));
  off += 4;
  for (let rel = 0; rel < 4; rel++)
    buf[off + rel] = Math.max(0, Math.min(1, pSameTeamRel[rel]!));
  off += 4;
  buf[off++] = Math.max(0, Math.min(1, belief.entropy));

  // Expected team captured points (from pSameTeam + captured points)
  let expMine = 0;
  let expOther = 0;
  for (let rel = 0; rel < 4; rel++) {
    const abs = mod4(self + rel) as Seat;
    const pts = ptsSeat[abs] ?? 0;
    const pm = pSameTeamRel[rel]!;
    expMine += pm * pts;
    expOther += (1 - pm) * pts;
  }
  buf[off++] = Math.max(0, Math.min(1, expMine / 120.0));
  buf[off++] = Math.max(0, Math.min(1, expOther / 120.0));

  // Pad to the fixed meta block size.
  const metaUsed = off - metaStart;
  if (metaUsed > 256) {
    throw new Error(`Meta block overflow: used ${metaUsed} > 256`);
  }
  off = metaStart + 256;

  // --- Action-conditional per-card block
  const legalMask = new Uint8Array(48);
  const legalIds = new Set(view.legalCards.map((c) => c.id));

  const legalOff = schema.offsets.legalMask.start;
  if (off !== legalOff) {
    throw new Error(
      `Schema mismatch: expected legalMask at ${legalOff}, got ${off}`,
    );
  }

  const curHasWinner = view.currentTrick.length > 0;

  const isLeading = view.currentTrick.length === 0;
  const suitIndex: Record<Suit, number> = {
    clubs: 0,
    spades: 1,
    hearts: 2,
    diamonds: 3,
  };

  for (let i = 0; i < 48; i++) {
    const card = getCardFromIndex(i);
    const legal = legalIds.has(card.id);
    legalMask[i] = legal ? 1 : 0;
    buf[off + i] = legal ? 1.0 : 0.0;
  }
  off += 48;

  for (let i = 0; i < 48; i++) {
    const card = getCardFromIndex(i);
    buf[off + i] = isTrump(
      card,
      view.gameMode,
      view.schweineActiveSeat,
      view.ruleset,
    )
      ? 1.0
      : 0.0;
  }
  off += 48;

  const powerByIdx: number[] = new Array(48).fill(0);
  for (let i = 0; i < 48; i++) {
    const card = getCardFromIndex(i);
    const p = trumpPower(
      card,
      view.schweineActiveSeat,
      self,
      view.ruleset,
      view.gameMode,
    );
    powerByIdx[i] = p;
    buf[off + i] = Math.max(0, Math.min(1, p / 500.0));
  }
  off += 48;

  for (let i = 0; i < 48; i++) {
    const card = getCardFromIndex(i);
    buf[off + i] = Math.max(0, Math.min(1, cardPoints(card.rank) / 11.0));
  }
  off += 48;

  // beatsCurrentWinner (only meaningful if we are not leading)
  for (let i = 0; i < 48; i++) {
    if (!legalMask[i]) continue;
    if (!curHasWinner) {
      buf[off + i] = 0.0;
      continue;
    }
    const card = getCardFromIndex(i);
    const hypo = [...view.currentTrick, { seat: self, card, wasLegal: true }];
    const w = winnerOfTrick(
      hypo,
      view.trickIndex,
      view.schweineActiveSeat,
      view.ruleset,
      view.gameMode,
    );
    buf[off + i] = w.seat === self ? 1.0 : 0.0;
  }
  off += 48;

  // ruffRiskIfLead (based on proven voids; only meaningful if we lead)
  for (let i = 0; i < 48; i++) {
    const card = getCardFromIndex(i);
    if (isTrump(card, view.gameMode, view.schweineActiveSeat, view.ruleset)) {
      buf[off + i] = 0.0;
      continue;
    }
    const si = suitIndex[card.suit];
    let risk = 0;
    if (isLeading) {
      for (let rel = 1; rel < 4; rel++) {
        const abs = mod4(self + rel);
        if (voidSuitAbs[abs]![si]! > 0.5 && voidTrumpAbs[abs]! < 0.5) {
          risk = 1;
          break;
        }
      }
    }
    buf[off + i] = risk ? 1.0 : 0.0;
  }
  off += 48;

  // higherTrumpUnseenForCard (public upper bound)
  for (let i = 0; i < 48; i++) {
    const p = powerByIdx[i]!;
    buf[off + i] = p > 0 && maxUnseenTrumpPower > p ? 1.0 : 0.0;
  }
  off += 48;

  if (off !== schema.size) {
    throw new Error(
      `Feature size mismatch: wrote ${off}, expected ${schema.size}`,
    );
  }

  return { features: buf, legalMask };
}

export function featurizeV1(view: BotView): Float32Array {
  return featurizeInternal(view, FEATURE_SCHEMA_V1).features;
}

export function featurizeV2(view: BotView): Float32Array {
  return featurizeInternal(view, FEATURE_SCHEMA_V2).features;
}

// Convenience: default to V2.
export function featurize(view: BotView): Float32Array {
  return featurizeV2(view);
}
