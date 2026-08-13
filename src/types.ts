export type Axis = "v" | "a" | "d";

export interface Pad {
  v: number;
  a: number;
  d: number;
}

export interface TimeConstants {
  v: number;
  a: number;
  d: number;
  mood: number;
}

export interface Drives {
  curiosity: number;
  recognition: number;
  contact: number;
  order: number;
}

export interface HabituationEntry {
  n: number;
  at: number;
}

export interface EventRecord {
  tag: string;
  delta: Pad;
  at: number;
  source: "l0" | "l1" | "tool" | "cron" | "command";
  summary?: string;
}

export interface AffectState {
  version: 2;
  pad: Pad;
  mood: number;
  energy: number;
  drives: Drives;
  habituation: Record<string, HabituationEntry>;
  lastEvents: EventRecord[];
  journal: string[];
  updatedAt: number;
  lastInteractionAt: number;
  driveHighSince: number | null;
  lastSleepMoodAt: number;
  lastProactiveAt: number;
  lastLonelyAt: number;
  enabled: boolean;
}

export interface Bond {
  familiarity: number;
  affection: number;
  trust: number;
  lastSeenAt: number;
}

export interface Personality {
  base: Pad & { mood: number };
  gain: Pad;
  tau: TimeConstants;
  maxIntensity: 0 | 1 | 2 | 3;
  moodCoupling: number;
}

export interface OceanConfig {
  openness?: unknown;
  conscientiousness?: unknown;
  extraversion?: unknown;
  agreeableness?: unknown;
  neuroticism?: unknown;
}

export interface AffectConfig {
  enabled?: unknown;
  maxIntensity?: unknown;
  personality?: OceanConfig;
  tau?: Partial<Record<keyof TimeConstants, unknown>>;
  moodCoupling?: unknown;
  l1?: {
    enabled?: unknown;
    maxRatePerHour?: unknown;
    timeoutMs?: unknown;
  };
  proactive?: {
    enabled?: unknown;
    quietHours?: unknown;
    tz?: unknown;
  };
}

export interface Appraisal {
  tag: string;
  delta: Pad;
  source: "l0" | "l1" | "tool" | "cron" | "command";
  summary?: string;
  bond?: Partial<Pick<Bond, "familiarity" | "affection" | "trust">>;
}

export interface L1Dimensions {
  desirability: number;
  expectedness: number;
  agency: "self" | "other" | "none";
  controllability: number;
  normViolation: number;
  relevanceToBond: number;
}

export interface L1Assessment extends L1Dimensions {
  tag: string;
  summary: string;
}

export interface StageDirection {
  label: string;
  intensity: 0 | 1 | 2 | 3;
  warmth: "cool" | "neutral" | "warm";
  pace: "measured" | "steady" | "energetic";
  assertiveness: "tentative" | "balanced" | "confident";
  address: "formal" | "direct" | "familiar";
  recentTag?: string;
}

export interface AffectMessage {
  text: string;
  userId?: string;
  messageId?: string;
  receivedAt?: number;
  kind?: "message" | "system" | "command";
}

export interface ToolEvent {
  toolName: string;
  sessionKey?: string;
  durationMs?: number;
  error?: unknown;
}

export interface L1ModelAdapter {
  appraise(input: {
    message: AffectMessage;
    bond: Bond;
    signal: string;
  }): Promise<L1Assessment | null>;
}

export interface PluginLogger {
  debug?(message: string, details?: unknown): void;
  warn?(message: string, details?: unknown): void;
  error?(message: string, details?: unknown): void;
}

export interface OpenClawAdapter {
  on?(name: string, handler: (...args: unknown[]) => unknown): void;
  registerTool?(tool: unknown): void;
  registerCommand?(command: unknown): void;
  registerCron?(expression: string, handler: () => Promise<void>): void;
  sendMessage?(payload: unknown): Promise<unknown> | unknown;
  config?: {
    affect?: AffectConfig;
    agents?: { defaults?: { workspace?: unknown } };
  };
  pluginConfig?: Record<string, unknown>;
  workspacePath?(name: string): string;
  log?: PluginLogger;
  logger?: PluginLogger;
  lifecycle?: {
    registerRuntimeLifecycle?: (lifecycle: { id: string; dispose?: () => void | Promise<void> }) => void;
  };
}

export const DEFAULT_DRIVES: Drives = {
  curiosity: 0,
  recognition: 0,
  contact: 0,
  order: 0,
};

export const NEUTRAL_BOND: Bond = {
  familiarity: 0,
  affection: 0,
  trust: 0.5,
  lastSeenAt: 0,
};
