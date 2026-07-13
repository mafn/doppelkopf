import type { BotView, Seat } from "../types";
import {
  getCardIndex,
  getCardFromIndex,
  FEATURE_SIZE_V0,
  FEATURE_SIZE_V0_2,
} from "./canonical-cards";
import { winnerOfTrick, trumpPower, isTrump, getTrumpSuit } from "../rules";

function mod4(n: number): 0 | 1 | 2 | 3 {
  return (((n % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

export function featurize(view: BotView): Float32Array {
  const buffer = new Float32Array(FEATURE_SIZE_V0);
  let offset = 0;

  // 1. Hand (48)
  const handIds = new Set<string>();
  for (const card of view.hand) {
    const cid = getCardIndex(card.id);
    if (cid >= 0 && cid < 48) buffer[offset + cid] = 1.0;
    handIds.add(card.id);
  }
  offset += 48;

  // 2. Trick (192)
  for (let i = 0; i < 4; i++) {
    const play = view.currentTrick[i];
    if (play) {
      const cid = getCardIndex(play.card.id);
      if (cid >= 0 && cid < 48) buffer[offset + i * 48 + cid] = 1.0;
    }
  }
  offset += 192;

  // 3. Seen (48)
  const seenIds = new Set<string>();
  for (const trick of view.completedTricks) {
    for (const play of trick.plays) {
      const cid = getCardIndex(play.card.id);
      if (cid >= 0 && cid < 48) buffer[offset + cid] = 1.0;
      seenIds.add(play.card.id);
    }
  }
  for (const play of view.currentTrick) seenIds.add(play.card.id);
  offset += 48;

  // 4. Metadata (18 reserved)
  buffer[offset++] = view.trickIndex / 12.0;
  // Avoid absolute seat ID (causes seat overfitting). Encode trick leader relative to self instead.
  const leadSeat =
    view.currentTrick.length > 0 ? view.currentTrick[0]!.seat : view.seat;
  buffer[offset++] = mod4(leadSeat - view.seat) / 3.0;
  buffer[offset++] = view.gameMode.kind === "solo" ? 1.0 : 0.0;
  buffer[offset++] = view.gameMode.kind === "poverty" ? 1.0 : 0.0;
  buffer[offset++] = view.gameMode.kind === "marriage" ? 1.0 : 0.0;
  buffer[offset++] = view.gameMode.kind === "normal" ? 1.0 : 0.0;
  // Padding (12): we use this to add rule flags without changing feature size.
  {
    const pad = offset;
    const dulleMode = view.ruleset.dulleBeatsDulle;
    buffer[pad + 0] = dulleMode === "disabled" ? 1.0 : 0.0;
    buffer[pad + 1] = dulleMode === "except_last_trick" ? 1.0 : 0.0;
    buffer[pad + 2] = dulleMode === "always" ? 1.0 : 0.0;

    const schweineEnabled = view.ruleset.schweine.mode !== "disabled";
    buffer[pad + 3] = schweineEnabled ? 1.0 : 0.0;
    buffer[pad + 4] = view.ruleset.schweineInSolo ? 1.0 : 0.0;
    // pad + 5..11 reserved
  }
  offset += 12;

  // 5. Ruleset Flags (2)
  const dulleMode = view.ruleset.dulleBeatsDulle;
  buffer[offset++] =
    dulleMode === "always"
      ? 1.0
      : dulleMode === "except_last_trick"
        ? 0.5
        : 0.0;
  buffer[offset++] = view.ruleset.schweine.mode !== "disabled" ? 1.0 : 0.0;

  // 6. Schweine Seat (4)
  if (view.schweineActiveSeat !== null) {
    buffer[offset + mod4(view.schweineActiveSeat - view.seat)] = 1.0;
  }
  offset += 4;

  // 7. Action-Conditional Features (144)
  // Use pre-computed legalCards from view (which comes from engine's legalMoves)
  const legalCardIds = new Set(view.legalCards.map((c) => c.id));

  for (let i = 0; i < 48; i++) {
    const card = getCardFromIndex(i);

    // Feature A: Is Legal?
    const legal = legalCardIds.has(card.id);
    buffer[offset + i] = legal ? 1.0 : 0.0;

    // Feature B: Trump Power
    const power = trumpPower(
      card,
      view.schweineActiveSeat,
      view.seat,
      view.ruleset,
      view.gameMode,
    );
    buffer[offset + 48 + i] = power / 500.0;

    // Feature C: Wins Trick? (only meaningful if the card is legal to play)
    let wins = false;
    if (legal && view.currentTrick.length < 4) {
      const hypotheticalTrick = [
        ...view.currentTrick,
        { seat: view.seat, card, wasLegal: true },
      ];
      const winner = winnerOfTrick(
        hypotheticalTrick,
        view.trickIndex,
        view.schweineActiveSeat,
        view.ruleset,
        view.gameMode,
      );
      if (winner.seat === view.seat) wins = true;
    }
    buffer[offset + 96 + i] = wins ? 1.0 : 0.0;
  }
  offset += 144;

  // 8. Public Knowledge (5)
  const publicTeams = [0, 0, 0, 0];

  if (view.gameMode.kind === "solo") {
    publicTeams[view.gameMode.soloSeat] = 1;
    for (let s = 0; s < 4; s++)
      if (s !== view.gameMode.soloSeat) publicTeams[s] = -1;
  } else if (view.gameMode.kind === "poverty") {
    publicTeams[view.gameMode.povertySeat] = 1;
    if (view.gameMode.acceptedBySeat !== null) {
      publicTeams[view.gameMode.acceptedBySeat] = 1;
      for (let s = 0; s < 4; s++) {
        if (
          s !== view.gameMode.povertySeat &&
          s !== view.gameMode.acceptedBySeat
        )
          publicTeams[s] = -1;
      }
    }
  } else if (view.gameMode.kind === "marriage") {
    publicTeams[view.gameMode.holderSeat] = 1;
    if (view.gameMode.partnerSeat !== null) {
      publicTeams[view.gameMode.partnerSeat] = 1;
      for (let s = 0; s < 4; s++) {
        if (s !== view.gameMode.holderSeat && s !== view.gameMode.partnerSeat)
          publicTeams[s] = -1;
      }
    } else if (view.gameMode.forced) {
      for (let s = 0; s < 4; s++) {
        if (s !== view.gameMode.holderSeat) publicTeams[s] = -1;
      }
    }
  } else {
    const allPlays = [
      ...view.completedTricks.flatMap((t) => t.plays),
      ...view.currentTrick,
    ];

    const seenClubQueenIds = new Set<string>();
    const clubQueenSeatById = new Map<string, Seat>();
    for (const p of allPlays) {
      if (p.card.suit === "clubs" && p.card.rank === "Q") {
        seenClubQueenIds.add(p.card.id);
        clubQueenSeatById.set(p.card.id, p.seat as Seat);
      }
    }

    // Only fully public once both copies of Q♣ have been played.
    const hasQ0 = seenClubQueenIds.has("clubs-Q-0");
    const hasQ1 = seenClubQueenIds.has("clubs-Q-1");
    if (hasQ0 && hasQ1) {
      const seat0 = clubQueenSeatById.get("clubs-Q-0");
      const seat1 = clubQueenSeatById.get("clubs-Q-1");
      if (seat0 !== undefined && seat1 !== undefined) {
        if (seat0 === seat1) {
          // Silent marriage: single Re seat.
          publicTeams[seat0] = 1;
          for (let s = 0; s < 4; s++) if (s !== seat0) publicTeams[s] = -1;
        } else {
          publicTeams[seat0] = 1;
          publicTeams[seat1] = 1;
          for (let s = 0; s < 4; s++)
            if (publicTeams[s] === 0) publicTeams[s] = -1;
        }
      }
    } else {
      // Partial evidence: if someone played Q♣, that seat is known Re.
      for (const seat of clubQueenSeatById.values()) {
        publicTeams[seat] = 1;
      }
    }
  }

  for (const a of view.announcements) {
    if (a.declaration === "Re") publicTeams[a.seat] = 1;
    if (a.declaration === "Kontra") publicTeams[a.seat] = -1;
  }

  // Rotate to self-relative seat order: [self, next, opposite, prev].
  for (let rel = 0; rel < 4; rel++) {
    const abs = mod4(view.seat + rel);
    buffer[offset + rel] = publicTeams[abs];
  }
  offset += 4;

  const marriageUnresolved =
    view.gameMode.kind === "marriage" &&
    view.gameMode.partnerSeat === null &&
    !view.gameMode.forced;
  buffer[offset++] = marriageUnresolved ? 1.0 : 0.0;

  // 9. Void/Counting Features (118)
  // Publicly infer which seats are void in which suits / trump from *legal* play history.
  // Self-relative seat order: [self, next, opposite, prev].
  const voidSuitAbs: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const voidTrumpAbs: number[] = [0, 0, 0, 0];
  const suitIndex: Record<string, number> = {
    clubs: 0,
    spades: 1,
    hearts: 2,
    diamonds: 3,
  };

  const allTricks: Array<{
    plays: { seat: Seat; card: any; wasLegal: boolean }[];
  }> = [...view.completedTricks, { plays: view.currentTrick }];

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
        if (!follow) {
          const si = suitIndex[leadCard.suit];
          if (si !== undefined) voidSuitAbs[s]![si] = 1;
        }
      }
    }
  }

  for (let rel = 0; rel < 4; rel++) {
    const abs = mod4(view.seat + rel);
    for (let si = 0; si < 4; si++) {
      buffer[offset + rel * 4 + si] = voidSuitAbs[abs]![si]!;
    }
  }
  offset += 16;

  for (let rel = 0; rel < 4; rel++) {
    const abs = mod4(view.seat + rel);
    buffer[offset + rel] = voidTrumpAbs[abs]!;
  }
  offset += 4;

  // Compute maximum trump power that could still be held by opponents (unseen + not in hand).
  let maxUnseenTrumpPower = 0;

  for (let i = 0; i < 48; i += 1) {
    const card = getCardFromIndex(i);
    if (handIds.has(card.id)) continue;
    if (seenIds.has(card.id)) continue;

    let pow = trumpPower(
      card,
      view.schweineActiveSeat,
      view.seat,
      view.ruleset,
      view.gameMode,
    );
    if (view.schweineActiveSeat !== null) {
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

  buffer[offset++] = maxUnseenTrumpPower / 500.0;

  // If Schweine is active and at least one trump ace is still unseen, there's a 500-power trump out.
  const trumpSuit = getTrumpSuit(view.gameMode);
  let trumpAceSeen = 0;
  if (trumpSuit) {
    for (const id of seenIds) {
      const c = id.split("-");
      if (c[0] === trumpSuit && c[1] === "A") trumpAceSeen += 1;
    }
  }
  const schweineAceUnseen =
    trumpSuit &&
    view.schweineActiveSeat !== null &&
    view.ruleset.schweine.mode !== "disabled" &&
    trumpAceSeen < 2
      ? 1.0
      : 0.0;
  buffer[offset++] = schweineAceUnseen;

  // Per-card: is there any higher trump still unseen?
  for (let i = 0; i < 48; i += 1) {
    const card = getCardFromIndex(i);
    const pow = trumpPower(
      card,
      view.schweineActiveSeat,
      view.seat,
      view.ruleset,
      view.gameMode,
    );
    buffer[offset + i] = pow > 0 && maxUnseenTrumpPower > pow ? 1.0 : 0.0;
  }
  offset += 48;

  // Per-card: known ruff risk if you lead this suit (based on proven voids).
  for (let i = 0; i < 48; i += 1) {
    const card = getCardFromIndex(i);
    const cIsTrump = isTrump(
      card,
      view.gameMode,
      view.schweineActiveSeat,
      view.ruleset,
    );
    if (cIsTrump) {
      buffer[offset + i] = 0.0;
      continue;
    }
    const si = suitIndex[card.suit];
    let risk = 0;
    if (si !== undefined) {
      for (let rel = 1; rel < 4; rel++) {
        const abs = mod4(view.seat + rel);
        if (voidSuitAbs[abs]![si]! > 0.5 && voidTrumpAbs[abs]! < 0.5) {
          risk = 1;
          break;
        }
      }
    }
    buffer[offset + i] = risk ? 1.0 : 0.0;
  }
  offset += 48;

  if (offset !== FEATURE_SIZE_V0) {
    throw new Error(
      `Legacy feature size mismatch: wrote ${offset}, expected ${FEATURE_SIZE_V0}`,
    );
  }

  return buffer;
}

export const featurizeV1 = featurize;

/**
 * V2 feature vector: V1 plus seat-attributed seen-card history.
 *
 * Appends 4 * 48 floats:
 * - For each seat s, which cards have been seen played by s so far.
 */
export function featurizeV2(view: BotView): Float32Array {
  const base = featurizeV1(view);
  if (base.length !== FEATURE_SIZE_V0) {
    throw new Error(
      `Unexpected legacy feature size: ${base.length} (expected ${FEATURE_SIZE_V0})`,
    );
  }

  const buffer = new Float32Array(FEATURE_SIZE_V0_2);
  buffer.set(base, 0);

  let offset = FEATURE_SIZE_V0;
  const allPlays = [
    ...view.completedTricks.flatMap((t) => t.plays),
    ...view.currentTrick,
  ];
  for (const p of allPlays) {
    const cid = getCardIndex(p.card.id);
    if (cid < 0 || cid >= 48) continue;
    const sAbs = p.seat as Seat;
    const sRel = mod4(sAbs - view.seat);
    buffer[offset + sRel * 48 + cid] = 1.0;
  }

  return buffer;
}
