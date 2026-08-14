import { HARD_INTERACTIONS, STAGE_INTENSITY_CAP, remainingCare, stageOf } from "./care.ts";
import type { AffectState, Bond, Direction, Personality } from "./types.ts";

const LABEL_BY_TAG: Record<string, string> = {
  frustrate: "受挫",
  blame: "受挫",
  praise: "愉悦",
  achieve: "愉悦",
  lonely: "低落",
  distance: "低落",
  unmet: "空落",
  contact: "安定",
  novelty: "好奇",
  stage: "雀跃",
};

const FRESH_MS = 4 * 60 * 60 * 1000;

function latestEvent(state: AffectState) {
  return state.lastEvents[0];
}

function latestLabelTag(state: AffectState, now: number): string | undefined {
  const event = latestEvent(state);
  if (!event || !LABEL_BY_TAG[event.tag]) return undefined;
  if (Number.isFinite(event.at) && now - event.at > FRESH_MS) return undefined;
  return event.tag;
}

export function emotionalLabel(state: AffectState, now = Date.now()): string {
  const tagged = latestLabelTag(state, now);
  if (tagged) return LABEL_BY_TAG[tagged];
  if (state.pad.v > 0.25 && state.pad.a > 0.2) return "明朗";
  if (state.pad.v < -0.25 && state.pad.a < 0) return "疲惫";
  if (state.pad.v < -0.25) return "谨慎";
  return "平和";
}

export function deriveIntensity(state: AffectState, bond: Bond, personality: Personality): number {
  const deviation = Math.max(
    Math.abs(state.pad.v - personality.base.v),
    Math.abs(state.pad.a - personality.base.a),
    Math.abs(state.pad.d - personality.base.d),
    Math.abs(state.mood - personality.base.mood),
  );
  let intensity = deviation < 0.08 ? 0 : deviation < 0.28 ? 1 : deviation < 0.55 ? 2 : 3;
  const stage = stageOf(bond.familiarity);
  intensity = Math.min(intensity, personality.maxIntensity, STAGE_INTENSITY_CAP[stage]);
  return intensity;
}

export function fullness(drive: number): number {
  return Math.max(0, Math.min(1, 1 - drive));
}

export function derive(state: AffectState, bond: Bond, personality: Personality, now = Date.now()): Direction {
  let intensity = deriveIntensity(state, bond, personality);
  const label = emotionalLabel(state, now);
  if (label !== "平和" && intensity === 0) intensity = 1;
  const stage = stageOf(bond.familiarity);
  intensity = Math.min(intensity, personality.maxIntensity, STAGE_INTENSITY_CAP[stage]);
  const warmthSignal = state.pad.v * 0.55 + state.mood * 0.45;
  const recent = latestEvent(state);
  return {
    label,
    intensity,
    warmth: warmthSignal > 0.16 ? "warm" : warmthSignal < -0.16 ? "cool" : "neutral",
    pace: state.pad.a > 0.3 ? "energetic" : state.pad.a < -0.12 ? "measured" : "steady",
    assertiveness: state.pad.d > 0.22 ? "confident" : state.pad.d < -0.22 ? "tentative" : "balanced",
    address: bond.familiarity > 0.6 && bond.affection > 0.35 ? "familiar" : bond.familiarity > 0.2 ? "direct" : "formal",
    stage,
    streak: bond.care?.streak ?? 0,
    needs: {
      contact: fullness(state.drives.contact),
      recognition: fullness(state.drives.recognition),
      curiosity: fullness(state.drives.curiosity),
      order: fullness(state.drives.order),
    },
    ...(latestLabelTag(state, now) || recent?.tag ? { recentTag: latestLabelTag(state, now) ?? recent?.tag } : {}),
    ...(recent?.summary ? { recentSummary: recent.summary } : {}),
  };
}

export function meter(unit: number, width = 6): string {
  const filled = Math.round(Math.max(0, Math.min(1, unit)) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

export function renderStatus(direction: Direction, remaining: ReturnType<typeof remainingCare>): string {
  const lines = [
    `栞那现在：${direction.label} · ${direction.stage}`,
    `陪伴 ${meter(direction.needs.contact)}  被看见 ${meter(direction.needs.recognition)}  新鲜 ${meter(direction.needs.curiosity)}  妥帖 ${meter(direction.needs.order)}`,
    `连续照顾 ${direction.streak} 天 · 今日养成 ${remaining.interactions}/${HARD_INTERACTIONS}`,
    `最近：${direction.recentSummary ?? direction.recentTag ?? "还没有特别的事"}`,
  ];
  return lines.join("\n");
}
