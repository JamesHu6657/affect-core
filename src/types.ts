export const DEFAULT_DRIVES = {
  curiosity: 0,
  recognition: 0,
  contact: 0,
  order: 0,
};

export const EMPTY_CARE = {
  streak: 0,
  lastCareDay: null as string | null,
  lastNeglectDay: null as string | null,
  lastStage: "陌生" as const,
  today: { day: "", familiarity: 0, affection: 0, interactions: 0, negAffection: 0, negTrust: 0, posTrust: 0 },
};

export const NEUTRAL_BOND = {
  familiarity: 0,
  affection: 0,
  trust: 0.5,
  lastSeenAt: 0,
  care: { ...EMPTY_CARE, today: { ...EMPTY_CARE.today } },
};

export type DriveKey = keyof typeof DEFAULT_DRIVES;

export type Pad = { v: number; a: number; d: number };

export type EventTag =
  | "achieve"
  | "praise"
  | "novelty"
  | "frustrate"
  | "interrupt"
  | "blame"
  | "distance"
  | "lonely"
  | "unmet"
  | "contact"
  | "stage";

export type EventSource = "l0" | "l1" | "tool" | "cron" | "care";

export type AffectEvent = {
  tag: EventTag | string;
  at: number;
  source: EventSource | string;
  delta: Pad;
  summary?: string;
};

export type Habituation = Record<string, { n: number; at: number }>;

export type StageId = "陌生" | "眼熟" | "熟悉" | "亲近" | "羁绊";

export type CareToday = {
  day: string;
  familiarity: number;
  affection: number;
  interactions: number;
  negAffection: number;
  negTrust: number;
  posTrust: number;
};

export type CareState = {
  streak: number;
  lastCareDay: string | null;
  lastNeglectDay: string | null;
  lastStage: StageId;
  today: CareToday;
};

export type AffectState = {
  version: 3;
  pad: Pad;
  mood: number;
  energy: number;
  drives: Record<DriveKey, number>;
  habituation: Habituation;
  lastEvents: AffectEvent[];
  journal: string[];
  care: CareState;
  updatedAt: number;
  lastInteractionAt: number;
  driveHighSince: number | null;
  lastSleepMoodAt: number;
  lastProactiveAt: number;
  lastLonelyAt: number;
  enabled: boolean;
  careMigration?: number;
  legacyCare?: CareState;
};

export type Bond = {
  familiarity: number;
  affection: number;
  trust: number;
  lastSeenAt: number;
  care: CareState;
};

export type BondDelta = Partial<Pick<Bond, "familiarity" | "affection" | "trust">>;

export type Personality = {
  base: Pad & { mood: number };
  tau: { v: number; a: number; d: number; mood: number };
  maxIntensity: number;
  moodCoupling: number;
};

export type PluginConfig = {
  enabled?: boolean;
  stateDir?: string;
  ownerIds?: string[];
  careMigrateTo?: string;
  maxIntensity?: number;
  moodCoupling?: number;
  personality?: {
    openness?: number;
    conscientiousness?: number;
    extraversion?: number;
    agreeableness?: number;
    neuroticism?: number;
  };
  tau?: { v?: number; a?: number; d?: number; mood?: number };
  care?: {
    tz?: string;
    dailyFamiliarityCap?: number;
    dailyAffectionCap?: number;
  };
  l1?: { enabled?: boolean; maxRatePerHour?: number; timeoutMs?: number };
  proactive?: { enabled?: boolean; quietHours?: [string, string]; tz?: string };
};

export type InboundMessage = {
  text: string;
  userId?: string;
  sessionKey?: string;
  messageId?: string;
  receivedAt?: number;
  kind?: "message";
};

export type ToolEvent = {
  toolName: string;
  durationMs?: number;
  error?: unknown;
  sessionKey?: string;
  userId?: string;
};

export type Appraisal = {
  tag: EventTag | string;
  delta: Pad;
  source: EventSource | string;
  summary: string;
  bond?: BondDelta;
};

export type Direction = {
  label: string;
  intensity: number;
  warmth: "warm" | "cool" | "neutral";
  pace: "energetic" | "measured" | "steady";
  assertiveness: "confident" | "tentative" | "balanced";
  address: "familiar" | "direct" | "formal";
  stage: StageId;
  streak: number;
  recentTag?: string;
  recentSummary?: string;
  needs: { contact: number; recognition: number; curiosity: number; order: number };
};
