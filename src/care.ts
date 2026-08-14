import { civilDate, civilDaysBetween } from "./clock.ts";
import type {
  AffectState,
  BondDelta,
  CareState,
  CareToday,
  PluginConfig,
  StageId,
} from "./types.ts";
import { EMPTY_CARE } from "./types.ts";

const clampUnit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const STAGES: { id: StageId; min: number }[] = [
  { id: "羁绊", min: 0.82 },
  { id: "亲近", min: 0.6 },
  { id: "熟悉", min: 0.35 },
  { id: "眼熟", min: 0.15 },
  { id: "陌生", min: 0 },
];

export const STAGE_INTENSITY_CAP: Record<StageId, number> = {
  陌生: 1,
  眼熟: 1,
  熟悉: 2,
  亲近: 2,
  羁绊: 2,
};

const CARE_GAIN: Record<string, BondDelta> = {
  contact: { familiarity: 0.006 },
  praise: { familiarity: 0.008, affection: 0.012, trust: 0.008 },
  novelty: { familiarity: 0.007, affection: 0.003 },
  achieve: { familiarity: 0.006, affection: 0.005, trust: 0.004 },
  blame: { affection: -0.01, trust: -0.08 },
  distance: { affection: -0.004 },
  interrupt: { affection: -0.003 },
};

const STREAK_TAGS = new Set(["contact", "praise", "novelty", "blame", "distance", "interrupt"]);

export const DEFAULT_FAM_CAP = 0.022;
export const DEFAULT_AFF_CAP = 0.016;
export const DEFAULT_NEG_AFF_CAP = 0.03;
export const DEFAULT_NEG_TRUST_CAP = 0.12;
export const DEFAULT_POS_TRUST_CAP = 0.04;
export const SOFT_INTERACTIONS = 8;
export const HARD_INTERACTIONS = 12;

export function emptyCare(day = ""): CareState {
  return {
    ...EMPTY_CARE,
    lastStage: "陌生",
    today: { ...EMPTY_CARE.today, day },
  };
}

export function stageOf(familiarity: number): StageId {
  const value = clampUnit(familiarity);
  return STAGES.find((stage) => value >= stage.min)?.id ?? "陌生";
}

export function stageProgress(familiarity: number): { stage: StageId; next: StageId | null; ratio: number } {
  const stage = stageOf(familiarity);
  const index = STAGES.findIndex((item) => item.id === stage);
  const current = STAGES[index]!;
  const higher = index > 0 ? STAGES[index - 1]! : null;
  if (!higher) return { stage, next: null, ratio: 1 };
  const span = higher.min - current.min;
  const ratio = span <= 0 ? 1 : clampUnit((familiarity - current.min) / span);
  return { stage, next: higher.id, ratio };
}

export function readCareConfig(config: PluginConfig = {}) {
  const care = config.care ?? {};
  const fam = typeof care.dailyFamiliarityCap === "number" && care.dailyFamiliarityCap >= 0
    ? care.dailyFamiliarityCap
    : DEFAULT_FAM_CAP;
  const aff = typeof care.dailyAffectionCap === "number" && care.dailyAffectionCap >= 0
    ? care.dailyAffectionCap
    : DEFAULT_AFF_CAP;
  return { dailyFamiliarityCap: fam, dailyAffectionCap: aff };
}

function rollToday(care: CareState, day: string): CareState {
  if (care.today.day === day) return care;
  return { ...care, today: { ...emptyCare(day).today, day } };
}

export function streakBonus(streak: number): number {
  if (streak <= 1) return 1;
  return 1 + Math.min(0.35, (streak - 1) * 0.025);
}

function interactionScale(count: number): number {
  if (count < SOFT_INTERACTIONS) return 1;
  if (count < HARD_INTERACTIONS) return 0.4;
  return 0.1;
}

function takePositive(used: number, want: number, cap: number): number {
  if (want <= 0) return want;
  return Math.min(want, Math.max(0, cap - used));
}

function takeNegative(usedAbs: number, want: number, capAbs: number): number {
  if (want >= 0) return want;
  return -Math.min(-want, Math.max(0, capAbs - usedAbs));
}

export function applyCareLedger(
  care: CareState,
  tag: string,
  now: number,
  timeZone: string,
  caps = { dailyFamiliarityCap: DEFAULT_FAM_CAP, dailyAffectionCap: DEFAULT_AFF_CAP },
): { care: CareState; bond: BondDelta; scaled: boolean } {
  const day = civilDate(now, timeZone);
  let next = rollToday(care, day);
  const recipe = CARE_GAIN[tag];
  if (!recipe) return { care: next, bond: {}, scaled: false };

  if (STREAK_TAGS.has(tag) && next.lastCareDay !== day) {
    const gap = next.lastCareDay ? civilDaysBetween(next.lastCareDay, day) : 1;
    next = {
      ...next,
      streak: gap === 1 ? next.streak + 1 : 1,
      lastCareDay: day,
    };
  }

  const scale = interactionScale(next.today.interactions) * (positiveWant(recipe) ? streakBonus(next.streak) : 1);
  const wantFam = (recipe.familiarity ?? 0) * (recipe.familiarity && recipe.familiarity > 0 ? scale : 1);
  const wantAff = (recipe.affection ?? 0) * (recipe.affection && recipe.affection > 0 ? scale : 1);
  const fam = takePositive(next.today.familiarity, wantFam, caps.dailyFamiliarityCap);
  const aff =
    wantAff >= 0
      ? takePositive(next.today.affection, wantAff, caps.dailyAffectionCap)
      : takeNegative(next.today.negAffection ?? 0, wantAff, DEFAULT_NEG_AFF_CAP);
  const wantTrust = (recipe.trust ?? 0) * ((recipe.trust ?? 0) > 0 ? scale : 1);
  const trust =
    wantTrust >= 0
      ? takePositive(next.today.posTrust ?? 0, wantTrust, DEFAULT_POS_TRUST_CAP)
      : takeNegative(next.today.negTrust ?? 0, wantTrust, DEFAULT_NEG_TRUST_CAP);
  const today: CareToday = {
    ...next.today,
    familiarity: next.today.familiarity + Math.max(0, fam),
    affection: next.today.affection + Math.max(0, aff),
    interactions: next.today.interactions + 1,
    negAffection: (next.today.negAffection ?? 0) + Math.max(0, -aff),
    negTrust: (next.today.negTrust ?? 0) + Math.max(0, -(trust ?? 0)),
    posTrust: (next.today.posTrust ?? 0) + Math.max(0, trust ?? 0),
  };
  return {
    care: { ...next, today },
    bond: {
      ...(fam !== 0 ? { familiarity: fam } : {}),
      ...(aff !== 0 ? { affection: aff } : {}),
      ...(trust ? { trust } : {}),
    },
    scaled: scale < 1,
  };
}

function positiveWant(recipe: BondDelta): boolean {
  return (recipe.familiarity ?? 0) > 0 || (recipe.affection ?? 0) > 0;
}

export function applyNeglectLedger(
  care: CareState,
  now: number,
  timeZone: string,
): { care: CareState; bond: BondDelta } {
  const day = civilDate(now, timeZone);
  const next = rollToday(care, day);
  if (!next.lastCareDay) return { care: next, bond: {} };
  const gap = civilDaysBetween(next.lastCareDay, day);
  if (gap < 2 || next.lastNeglectDay === day) return { care: next, bond: {} };
  const billedThrough = next.lastNeglectDay ?? next.lastCareDay;
  const newly = civilDaysBetween(billedThrough, day);
  if (newly <= 0) return { care: next, bond: {} };
  return {
    care: { ...next, lastNeglectDay: day, streak: 0 },
    bond: { affection: -0.012, trust: -0.01 },
  };
}

export function hydrateStage(care: CareState, familiarity: number): CareState {
  const stage = stageOf(familiarity);
  if (care.lastStage === "陌生" && stage !== "陌生" && !care.lastCareDay) {
    return { ...care, lastStage: stage };
  }
  return care;
}

export function noteStage(care: CareState, familiarity: number): { care: CareState; promoted: StageId | null } {
  const stage = stageOf(familiarity);
  const previous = STAGES.findIndex((item) => item.id === care.lastStage);
  const current = STAGES.findIndex((item) => item.id === stage);
  // STAGES is descending; smaller index is higher rank.
  if (current >= 0 && previous >= 0 && current < previous) {
    return { care: { ...care, lastStage: stage }, promoted: stage };
  }
  return { care, promoted: null };
}

export function remainingCare(care: CareState, now: number, timeZone: string, caps = readCareConfig()) {
  const day = civilDate(now, timeZone);
  const today = care.today.day === day ? care.today : emptyCare(day).today;
  return {
    day,
    interactions: today.interactions,
    softLeft: Math.max(0, SOFT_INTERACTIONS - today.interactions),
    familiarityLeft: Math.max(0, caps.dailyFamiliarityCap - today.familiarity),
    affectionLeft: Math.max(0, caps.dailyAffectionCap - today.affection),
  };
}

export function attachCare(state: AffectState, care: CareState): AffectState {
  return { ...state, care };
}

export function seedCare(state: Partial<AffectState> | undefined, now = Date.now(), timeZone = "Asia/Shanghai"): CareState {
  const raw = state?.care;
  if (!raw || typeof raw !== "object") return emptyCare(civilDate(now, timeZone));
  const today = raw.today && typeof raw.today === "object" ? raw.today : emptyCare().today;
  return {
    streak: Number.isFinite(raw.streak) ? Math.max(0, Math.floor(raw.streak)) : 0,
    lastCareDay: typeof raw.lastCareDay === "string" ? raw.lastCareDay : null,
    lastNeglectDay: typeof raw.lastNeglectDay === "string" ? raw.lastNeglectDay : null,
    lastStage: STAGES.some((item) => item.id === raw.lastStage) ? raw.lastStage : "陌生",
    today: {
      day: typeof today.day === "string" ? today.day : "",
      familiarity: Number.isFinite(today.familiarity) ? Math.max(0, today.familiarity) : 0,
      affection: Number.isFinite(today.affection) ? Math.max(0, today.affection) : 0,
      interactions: Number.isFinite(today.interactions) ? Math.max(0, Math.floor(today.interactions)) : 0,
      negAffection: Number.isFinite(today.negAffection) ? Math.max(0, today.negAffection) : 0,
      negTrust: Number.isFinite(today.negTrust) ? Math.max(0, today.negTrust) : 0,
      posTrust: Number.isFinite(today.posTrust) ? Math.max(0, today.posTrust) : 0,
    },
  };
}

/** Review helper: how many full-care days to reach a stage if every day hits the cap. */
export function daysToStage(target: StageId, daily = DEFAULT_FAM_CAP): number {
  const min = STAGES.find((item) => item.id === target)?.min ?? 0;
  if (daily <= 0) return Infinity;
  return Math.ceil(min / daily);
}
