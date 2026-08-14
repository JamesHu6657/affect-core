import type { Personality, PluginConfig } from "./types.ts";

export const DEFAULT_TAU = { v: 55, a: 14, d: 70, mood: 900 };

const unit = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const positive = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
const intensity = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 2;
  return Math.max(0, Math.min(3, Math.round(value)));
};

export function personalityFrom(config: PluginConfig = {}): Personality {
  const ocean = config.personality ?? {};
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
  return {
    base,
    gain: {
      v: 0.6 + neuroticism,
      a: 0.5 + extraversion,
      d: 0.85,
    },
    tau: {
      v: positive(config.tau?.v, DEFAULT_TAU.v),
      a: positive(config.tau?.a, DEFAULT_TAU.a),
      d: positive(config.tau?.d, DEFAULT_TAU.d),
      mood: positive(config.tau?.mood, DEFAULT_TAU.mood),
    },
    maxIntensity: intensity(config.maxIntensity),
    moodCoupling: unit(config.moodCoupling, 0.25),
  };
}

export function featureEnabled(config: PluginConfig = {}): boolean {
  return config.enabled === true;
}
