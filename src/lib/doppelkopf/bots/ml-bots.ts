import {
  pickBotCard as heuristicPick,
  pickBotSolo as heuristicPickSolo,
} from "./heuristic-v1";
import { featurizeV1, featurizeV2 } from "../ml/featurizer";
import { FEATURE_SIZE_V1, FEATURE_SIZE_V2 } from "../ml/feature-schema";
import { getCardFromIndex, META_ACTIONS } from "../ml/canonical-cards";
import {
  runOnnx,
  type OrtBrowserConfig,
  getExpectedFeatureSize,
} from "../ml/onnx-browser";
import type { BotView, GameAction } from "../types";
import { enumerateBidChoices } from "../ml/bid-oracle";

/**
 * ML-Alpha Bot support for both V1 (ResNet) and V2 (Transformer).
 */

const V1_CFG: OrtBrowserConfig = {
  modelUrl: "/models/doko.onnx",
  wasmBaseUrl: "/vendor/onnxruntime/",
};

const V2_CFG: OrtBrowserConfig = {
  modelUrl: "/models/doko_v2.onnx",
  wasmBaseUrl: "/vendor/onnxruntime/",
};

export async function pickMlBotCardAsync(
  view: BotView,
  version: "ml-v1" | "ml-v2",
): Promise<string> {
  const cfg = version === "ml-v1" ? V1_CFG : V2_CFG;
  const expectedSize = await getExpectedFeatureSize(cfg);
  const isV1 = expectedSize === FEATURE_SIZE_V1;
  const isV2 = expectedSize === FEATURE_SIZE_V2;
  if (!isV1 && !isV2)
    throw new Error(
      `[ML] Unknown feature size ${expectedSize} for model ${version}`,
    );
  const features = isV1 ? featurizeV1(view) : featurizeV2(view);
  const { card_logits } = await runOnnx(cfg, features);

  const legal = new Set(view.legalCards.map((c) => c.id));
  let bestIdx = -1;
  let bestLogit = -Infinity;
  for (let i = 0; i < 48; i += 1) {
    const id = getCardFromIndex(i).id;
    if (!legal.has(id)) continue;
    const logit = card_logits[i] ?? -Infinity;
    if (logit > bestLogit) {
      bestLogit = logit;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) return getCardFromIndex(bestIdx).id;
  return heuristicPick(view);
}

export async function pickMlBotSoloAsync(
  view: BotView,
  version: "ml-v1" | "ml-v2",
): Promise<GameAction> {
  const cfg = version === "ml-v1" ? V1_CFG : V2_CFG;
  const expectedSize = await getExpectedFeatureSize(cfg);
  const isV1 = expectedSize === FEATURE_SIZE_V1;
  const isV2 = expectedSize === FEATURE_SIZE_V2;
  if (!isV1 && !isV2)
    throw new Error(
      `[ML] Unknown feature size ${expectedSize} for model ${version}`,
    );
  const features = isV1 ? featurizeV1(view) : featurizeV2(view);
  const { bid_logits } = await runOnnx(cfg, features);

  if (!bid_logits) {
    console.warn(`[ML] Model ${version} has no bid_logits head.`);
    const solo = heuristicPickSolo(view);
    if (solo === "throw") return { type: "ThrowCards", seat: view.seat };
    if (solo)
      return { type: "ChooseSolo", seat: view.seat, soloType: solo as any };
    return { type: "PassSolo", seat: view.seat };
  }

  // Use bid oracle logic to enumerate valid choices
  const choices = enumerateBidChoices(
    {
      state: { ...view, hands: { [view.seat]: view.hand } } as any,
      events: [],
    },
    view.seat,
    view.ruleset,
  );

  if (choices.length === 0) {
    return { type: "PassSolo", seat: view.seat };
  }

  let bestChoice = choices[0]!;
  let bestLogit = -Infinity;

  for (const choice of choices) {
    const idx = META_ACTIONS.indexOf(choice.meta as any);
    if (idx !== -1) {
      const logit = bid_logits[idx] ?? -Infinity;
      if (logit > bestLogit) {
        bestLogit = logit;
        bestChoice = choice;
      }
    }
  }

  return bestChoice.action;
}
