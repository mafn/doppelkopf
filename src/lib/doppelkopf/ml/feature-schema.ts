export type FeatureVersion = "v1" | "v2";

export type FeatureSchema = {
  version: FeatureVersion;
  size: number;
  // Offsets are 0-based into the feature vector.
  offsets: {
    hand: { start: number; size: number };
    currentTrick: { start: number; size: number };
    history: { start: number; size: number };
    seen: { start: number; size: number };
    meta: { start: number; size: number };
    legalMask: { start: number; size: number };
    isTrump: { start: number; size: number };
    trumpPower: { start: number; size: number };
    cardPoints: { start: number; size: number };
    beatsCurrentWinner: { start: number; size: number };
    ruffRiskIfLead: { start: number; size: number };
    higherTrumpUnseen: { start: number; size: number };
  };
};

function addBlock(
  off: number,
  size: number,
): { start: number; end: number; next: number } {
  return { start: off, end: off + size, next: off + size };
}

/**
 * V1 feature schema (2026-02): tempo + belief + progress.
 * Truncated to 6 history slots.
 */
export function featureSchemaV1(): FeatureSchema {
  let off = 0;
  const hand = addBlock(off, 48);
  off = hand.next;
  const currentTrick = addBlock(off, 4 * 48);
  off = currentTrick.next;
  const history = addBlock(off, 6 * (4 + 4 * 48));
  off = history.next;
  const seen = addBlock(off, 48);
  off = seen.next;
  const meta = addBlock(off, 256);
  off = meta.next;
  const legalMask = addBlock(off, 48);
  off = legalMask.next;
  const isTrump = addBlock(off, 48);
  off = isTrump.next;
  const trumpPower = addBlock(off, 48);
  off = trumpPower.next;
  const cardPoints = addBlock(off, 48);
  off = cardPoints.next;
  const beatsCurrentWinner = addBlock(off, 48);
  off = beatsCurrentWinner.next;
  const ruffRiskIfLead = addBlock(off, 48);
  off = ruffRiskIfLead.next;
  const higherTrumpUnseen = addBlock(off, 48);
  off = higherTrumpUnseen.next;

  return {
    version: "v1",
    size: off,
    offsets: {
      hand: { start: hand.start, size: 48 },
      currentTrick: { start: currentTrick.start, size: 4 * 48 },
      history: { start: history.start, size: 6 * (4 + 4 * 48) },
      seen: { start: seen.start, size: 48 },
      meta: { start: meta.start, size: 256 },
      legalMask: { start: legalMask.start, size: 48 },
      isTrump: { start: isTrump.start, size: 48 },
      trumpPower: { start: trumpPower.start, size: 48 },
      cardPoints: { start: cardPoints.start, size: 48 },
      beatsCurrentWinner: { start: beatsCurrentWinner.start, size: 48 },
      ruffRiskIfLead: { start: ruffRiskIfLead.start, size: 48 },
      higherTrumpUnseen: { start: higherTrumpUnseen.start, size: 48 },
    },
  };
}

/**
 * V2 feature schema: full 12 history slots.
 */
export function featureSchemaV2(): FeatureSchema {
  let off = 0;
  const hand = addBlock(off, 48);
  off = hand.next;
  const currentTrick = addBlock(off, 4 * 48);
  off = currentTrick.next;
  const history = addBlock(off, 12 * (4 + 4 * 48));
  off = history.next;
  const seen = addBlock(off, 48);
  off = seen.next;
  const meta = addBlock(off, 256);
  off = meta.next;
  const legalMask = addBlock(off, 48);
  off = legalMask.next;
  const isTrump = addBlock(off, 48);
  off = isTrump.next;
  const trumpPower = addBlock(off, 48);
  off = trumpPower.next;
  const cardPoints = addBlock(off, 48);
  off = cardPoints.next;
  const beatsCurrentWinner = addBlock(off, 48);
  off = beatsCurrentWinner.next;
  const ruffRiskIfLead = addBlock(off, 48);
  off = ruffRiskIfLead.next;
  const higherTrumpUnseen = addBlock(off, 48);
  off = higherTrumpUnseen.next;

  return {
    version: "v2",
    size: off,
    offsets: {
      hand: { start: hand.start, size: 48 },
      currentTrick: { start: currentTrick.start, size: 4 * 48 },
      history: { start: history.start, size: 12 * (4 + 4 * 48) },
      seen: { start: seen.start, size: 48 },
      meta: { start: meta.start, size: 256 },
      legalMask: { start: legalMask.start, size: 48 },
      isTrump: { start: isTrump.start, size: 48 },
      trumpPower: { start: trumpPower.start, size: 48 },
      cardPoints: { start: cardPoints.start, size: 48 },
      beatsCurrentWinner: { start: beatsCurrentWinner.start, size: 48 },
      ruffRiskIfLead: { start: ruffRiskIfLead.start, size: 48 },
      higherTrumpUnseen: { start: higherTrumpUnseen.start, size: 48 },
    },
  };
}

export const FEATURE_SCHEMA_V1 = featureSchemaV1();
export const FEATURE_SCHEMA_V2 = featureSchemaV2();
export const FEATURE_SIZE_V1 = FEATURE_SCHEMA_V1.size;
export const FEATURE_SIZE_V2 = FEATURE_SCHEMA_V2.size;
