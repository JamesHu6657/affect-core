import type { AffectConfig, OceanConfig, Personality } from "./types.ts";

export const DEFAULT_TAU = {
  v: 55,
  a: 14,
  d: 70,
  mood: 900,
} as const;

const unit = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;

const positive = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;

const intensity = (value: unknown): 0 | 1 | 2 | 3 => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 2;
  return Math.max(0, Math.min(3, Math.round(value))) as 0 | 1 | 2 | 3;
};

export function personalityFrom(config: AffectConfig = {}): Personality {
  const ocean: OceanConfig = config.personality ?? {};
  const openness = unit(ocean.openness, 0.7);
  const conscientiousness = unit(ocean.conscientiousness, 0.8);
  const extraversion = unit(ocean.extraversion, 0.3);
  const agreeableness = unit(ocean.agreeableness, 0.75);
  const neuroticism = unit(ocean.neuroticism, 0.35);

  const base = {
    v: 0.35 * agreeableness - 0.25 * neuroticism,
    a: 0.45 * extraversion - 0.15,
    d: 0.3 * conscientiousness - 0.2 * neuroticism,
    mood: 0,
  };
  base.mood = base.v * 0.6;

  const rawCoupling = unit(config.moodCoupling, 0.25);
  return {
    base,
    gain: {
      v: 0.6 + neuroticism,
      a: 0.5 + extraversion,
      d: 0.85 + openness * 0,
    },
    tau: {
      v: positive(config.tau?.v, DEFAULT_TAU.v),
      a: positive(config.tau?.a, DEFAULT_TAU.a),
      d: positive(config.tau?.d, DEFAULT_TAU.d),
      mood: positive(config.tau?.mood, DEFAULT_TAU.mood),
    },
    maxIntensity: intensity(config.maxIntensity),
    moodCoupling: rawCoupling,
  };
}

export function featureEnabled(config: AffectConfig = {}): boolean {
  return config.enabled === true;
}
