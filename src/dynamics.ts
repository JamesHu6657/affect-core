import { sleepOverlapMinutes, sleepPeriodIdsBetween, sleepPeriodId } from "./clock.ts";
import { DEFAULT_DRIVES, type AffectState, type Drives, type Pad, type Personality } from "./types.ts";

export const CAP = 0.35;
export const HAB_MAX = 6;
export const MOOD_COUPLING = 0.25;
export const MAX_DT_MIN = 48 * 60;
export const DRIVE_UNMET_MS = 60 * 60 * 1000;
export const JOURNAL_LIMIT = 14;
const EVENT_LIMIT = 12;
const HALF_HOUR_MS = 30 * 60 * 1000;
const ENERGY_AROUSAL_COST_PER_HOUR = 0.12;
const ENERGY_IMPULSE_COST = 0.04;
const SLEEP_MOOD_PULL = 0.3;

export interface TickOptions {
  tz?: string;
}

export const clamp = (value: number, min = -1, max = 1): number =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));

export const clampUnit = (value: number): number => clamp(value, 0, 1);

export const capAbs = (value: number, cap = CAP): number =>
  clamp(value, -cap, cap);

export function relax(x: number, base: number, dtMin: number, tau: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(base)) return base;
  if (!Number.isFinite(tau) || tau <= 0) return base;
  const dt = Math.max(0, Math.min(MAX_DT_MIN, Number.isFinite(dtMin) ? dtMin : 0));
  return base + (x - base) * Math.exp(-dt / tau);
}

export function capArousal(arousal: number, energy: number): number {
  return Math.min(clamp(arousal), 0.15 + 0.85 * clampUnit(energy));
}

export function elapsed(state: AffectState, now: number): number {
  const raw = (now - state.updatedAt) / 60_000;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, MAX_DT_MIN);
}

export function accrue(drives: Drives, dtMin: number): Drives {
  const rate = dtMin / (8 * 60);
  return {
    curiosity: clampUnit(drives.curiosity + rate * 0.7),
    recognition: clampUnit(drives.recognition + rate * 0.6),
    contact: clampUnit(drives.contact + rate * 0.5),
    order: clampUnit(drives.order + rate * 0.45),
  };
}

export function drivesFromTags(tags: readonly string[]): (keyof Drives)[] {
  const keys = new Set<keyof Drives>();
  for (const tag of tags) {
    if (tag === "praise") keys.add("recognition");
    if (tag === "novelty") keys.add("curiosity");
    if (tag === "achieve") keys.add("order");
  }
  return [...keys];
}

export function satisfyDrives(drives: Drives, keys: readonly (keyof Drives)[]): Drives {
  if (keys.length === 0) return drives;
  const next = { ...drives };
  for (const key of keys) next[key] = 0;
  return next;
}

export function applySatisfiedDrives(
  state: AffectState,
  tags: readonly string[] = [],
  extra: readonly (keyof Drives)[] = [],
): AffectState {
  const keys = [...new Set([...drivesFromTags(tags), ...extra])];
  if (keys.length === 0) return state;
  const drives = satisfyDrives(state.drives, keys);
  const high = Math.max(...Object.values(drives)) > 0.7;
  return { ...state, drives, driveHighSince: high ? state.driveHighSince : null };
}

function recoverEnergy(energy: number, dtMin: number, from: number, to: number, tz: string): number {
  const sleepMin = Math.min(dtMin, sleepOverlapMinutes(from, to, tz));
  const wakeMin = Math.max(0, dtMin - sleepMin);
  const recovery = (sleepMin / 60) * 0.11 + (wakeMin / 60) * 0.035;
  return clampUnit(energy + recovery);
}

export function integratedPositiveArousalHours(a0: number, base: number, tau: number, dtMin: number): number {
  if (!Number.isFinite(tau) || tau <= 0 || dtMin <= 0) return 0;
  if (a0 <= 0 && base <= 0) return 0;

  if (a0 <= 0 && base > 0) {
    const tZero = tau * Math.log((base - a0) / base);
    if (!Number.isFinite(tZero) || tZero >= dtMin) return 0;
    const remaining = dtMin - tZero;
    return Math.max(0, base * remaining - base * tau * (1 - Math.exp(-remaining / tau))) / 60;
  }

  let tEnd = dtMin;
  if (a0 > 0 && base < 0) {
    const tZero = tau * Math.log((a0 - base) / -base);
    if (Number.isFinite(tZero) && tZero > 0) tEnd = Math.min(dtMin, tZero);
  }
  const integralMin = base * tEnd + (a0 - base) * tau * (1 - Math.exp(-tEnd / tau));
  return Math.max(0, integralMin) / 60;
}

function spendEnergy(energy: number, arousal: number, baseA: number, tauA: number, dtMin: number): number {
  const spent = integratedPositiveArousalHours(arousal, baseA, tauA, dtMin) * ENERGY_AROUSAL_COST_PER_HOUR;
  return clampUnit(energy - spent);
}

export function decayHab(
  habituation: AffectState["habituation"],
  now: number,
): AffectState["habituation"] {
  const next: AffectState["habituation"] = {};
  for (const [tag, entry] of Object.entries(habituation)) {
    const periods = Math.floor(Math.max(0, now - entry.at) / HALF_HOUR_MS);
    const n = Math.max(0, Math.min(HAB_MAX, entry.n - periods));
    if (n > 0) next[tag] = { n, at: periods > 0 ? entry.at + periods * HALF_HOUR_MS : entry.at };
  }
  return next;
}

export function baselineState(personality: Personality, now = Date.now()): AffectState {
  return {
    version: 2,
    pad: { v: personality.base.v, a: capArousal(personality.base.a, 1), d: personality.base.d },
    mood: personality.base.mood,
    energy: 1,
    drives: { ...DEFAULT_DRIVES },
    habituation: {},
    lastEvents: [],
    journal: [],
    updatedAt: now,
    lastInteractionAt: now,
    driveHighSince: null,
    lastSleepMoodAt: 0,
    lastProactiveAt: 0,
    lastLonelyAt: 0,
    enabled: true,
  };
}

export function tick(state: AffectState, personality: Personality, now: number, options: TickOptions = {}): AffectState {
  const tz = options.tz ?? "UTC";
  const dt = elapsed(state, now);
  if (dt === 0) {
    return { ...state, updatedAt: now };
  }

  const from = now - dt * 60_000;
  const spent = spendEnergy(state.energy, state.pad.a, personality.base.a, personality.tau.a, dt);
  const energy = recoverEnergy(spent, dt, from, now, tz);
  const drives = accrue(state.drives, dt);
  const high = Math.max(...Object.values(drives)) > 0.7;
  const driveHighSince = high ? (state.driveHighSince ?? now) : null;

  let mood = clamp(relax(state.mood, personality.base.mood, dt, personality.tau.mood));
  let lastSleepMoodAt = state.lastSleepMoodAt;
  const covered = lastSleepMoodAt > 0 ? sleepPeriodId(lastSleepMoodAt, tz) : null;
  const uncovered = sleepPeriodIdsBetween(from, now, tz).filter((id) => id !== covered);
  if (uncovered.length > 0) {
    for (let index = 0; index < uncovered.length; index += 1) {
      mood = clamp(mood + (personality.base.mood - mood) * SLEEP_MOOD_PULL);
    }
    lastSleepMoodAt = now;
  }

  return {
    ...state,
    pad: {
      v: clamp(relax(state.pad.v, personality.base.v, dt, personality.tau.v)),
      a: capArousal(relax(state.pad.a, personality.base.a, dt, personality.tau.a), energy),
      d: clamp(relax(state.pad.d, personality.base.d, dt, personality.tau.d)),
    },
    mood,
    energy,
    drives,
    driveHighSince,
    lastSleepMoodAt,
    habituation: decayHab(state.habituation, now),
    updatedAt: now,
  };
}

export function impulse(
  state: AffectState,
  requested: Pad,
  tag: string,
  now: number,
  source: "l0" | "l1" | "tool" | "cron" | "command" = "l0",
  summary?: string,
  moodCoupling = MOOD_COUPLING,
): AffectState {
  const h = state.habituation[tag]?.n ?? 0;
  let gain = Math.pow(0.6, Math.min(h, HAB_MAX));

  if (requested.v < 0) {
    gain *= Math.min(1.3, 1 + Math.max(0, -state.mood) * 0.6);
    if (state.mood < -0.5) gain *= 0.5;
  }

  const delta = {
    v: capAbs(requested.v * gain),
    a: capAbs(requested.a * gain),
    d: capAbs(requested.d * gain),
  };

  let effectiveCoupling = clampUnit(moodCoupling);
  if (delta.v < 0 && state.mood < -0.6) effectiveCoupling *= 0.4;

  const energy = clampUnit(state.energy - Math.max(0, delta.a) * ENERGY_IMPULSE_COST);
  const event = { tag, delta, at: now, source, ...(summary ? { summary } : {}) };
  return {
    ...state,
    pad: {
      v: clamp(state.pad.v + delta.v),
      a: capArousal(clamp(state.pad.a + delta.a), energy),
      d: clamp(state.pad.d + delta.d),
    },
    mood: clamp(state.mood + delta.v * effectiveCoupling),
    energy,
    habituation: {
      ...state.habituation,
      [tag]: { n: Math.min(h + 1, HAB_MAX), at: now },
    },
    lastEvents: [event, ...state.lastEvents].slice(0, EVENT_LIMIT),
    updatedAt: now,
  };
}

export function summarize(state: AffectState): string {
  const recent = state.lastEvents.slice(0, 4).map((event) => event.tag);
  return recent.length > 0 ? `events ${recent.join(",")}` : "no notable events";
}

export function appendJournal(state: AffectState, line: string, now: number): AffectState {
  const stamp = new Date(now).toISOString().slice(0, 10);
  const entry = `${stamp} ${line}`.slice(0, 240);
  return { ...state, journal: [entry, ...state.journal].slice(0, JOURNAL_LIMIT) };
}

export function resetPadKeepMood(state: AffectState, personality: Personality, now: number): AffectState {
  return {
    ...state,
    pad: {
      v: personality.base.v,
      a: capArousal(personality.base.a, state.energy),
      d: personality.base.d,
    },
    habituation: {},
    updatedAt: now,
  };
}
