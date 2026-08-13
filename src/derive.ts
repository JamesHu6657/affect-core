import type { AffectState, Bond, Personality, StageDirection } from "./types.ts";

function latestTag(state: AffectState): string | undefined {
  return state.lastEvents[0]?.tag;
}

function emotionalLabel(state: AffectState): string {
  const tag = latestTag(state);
  if (tag === "frustrate" || tag === "blame") return "受挫";
  if (tag === "praise" || tag === "achieve") return "愉悦";
  if (tag === "lonely" || tag === "distance") return "低落";
  if (state.pad.v > 0.25 && state.pad.a > 0.2) return "明朗";
  if (state.pad.v < -0.25 && state.pad.a < 0) return "疲惫";
  if (state.pad.v < -0.25) return "谨慎";
  return "平和";
}

export function deriveIntensity(state: AffectState, bond: Bond, personality: Personality): 0 | 1 | 2 | 3 {
  const deviation = Math.max(
    Math.abs(state.pad.v - personality.base.v),
    Math.abs(state.pad.a - personality.base.a),
    Math.abs(state.pad.d - personality.base.d),
  );

  let intensity: 0 | 1 | 2 | 3;
  if (deviation < 0.1) intensity = 0;
  else if (deviation < 0.28) intensity = 1;
  else if (deviation < 0.55) intensity = 2;
  else intensity = 3;

  intensity = Math.min(intensity, personality.maxIntensity) as 0 | 1 | 2 | 3;
  if (bond.familiarity <= 0.6) intensity = Math.min(intensity, 2) as 0 | 1 | 2 | 3;
  if (bond.familiarity < 0.2) intensity = Math.min(intensity, 1) as 0 | 1 | 2 | 3;
  return intensity;
}

export function derive(state: AffectState, bond: Bond, personality: Personality): StageDirection {
  const intensity = deriveIntensity(state, bond, personality);
  const warmthSignal = state.pad.v * 0.55 + state.mood * 0.45;
  const warmth = warmthSignal > 0.16 ? "warm" : warmthSignal < -0.16 ? "cool" : "neutral";
  const pace = state.pad.a > 0.3 ? "energetic" : state.pad.a < -0.12 ? "measured" : "steady";
  const assertiveness = state.pad.d > 0.22 ? "confident" : state.pad.d < -0.22 ? "tentative" : "balanced";
  const address = bond.familiarity > 0.6 && bond.affection > 0.35 ? "familiar" : bond.familiarity > 0.2 ? "direct" : "formal";

  return {
    label: intensity === 0 ? "平和" : emotionalLabel(state),
    intensity,
    warmth,
    pace,
    assertiveness,
    address,
    ...(intensity > 0 && latestTag(state) ? { recentTag: latestTag(state)! } : {}),
  };
}
