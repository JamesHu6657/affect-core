import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { seedCare } from "./care.ts";
import { baselineState, clamp, clampUnit } from "./dynamics.ts";
import type { AffectState, Personality } from "./types.ts";

const statePath = (dir: string) => join(dir, "state.json");

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sanitize(raw: unknown, personality: Personality, now = Date.now()): AffectState {
  const base = baselineState(personality, now);
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Record<string, unknown>;
  const pad = input.pad && typeof input.pad === "object" ? (input.pad as Record<string, unknown>) : {};
  const drives = input.drives && typeof input.drives === "object" ? (input.drives as Record<string, unknown>) : {};
  const habituation: AffectState["habituation"] = {};
  if (input.habituation && typeof input.habituation === "object") {
    for (const [tag, value] of Object.entries(input.habituation as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const n = Math.max(0, Math.min(6, Math.floor(finite(entry.n, 0))));
      const at = finite(entry.at, now);
      if (n > 0 && Number.isFinite(at)) habituation[tag] = { n, at };
    }
  }
  const lastEvents = Array.isArray(input.lastEvents)
    ? input.lastEvents
        .filter((event) => {
          if (!event || typeof event !== "object") return false;
          const record = event as Record<string, unknown>;
          return typeof record.tag === "string" && Number.isFinite(record.at) && !!record.delta;
        })
        .slice(0, 12)
        .map((event) => {
          const item = event as { tag: string; at: number; source?: string; delta: { v?: number; a?: number; d?: number }; summary?: string };
          return {
            tag: item.tag,
            at: finite(item.at, now),
            source: item.source ?? "l0",
            delta: {
              v: clamp(finite(item.delta.v, 0)),
              a: clamp(finite(item.delta.a, 0)),
              d: clamp(finite(item.delta.d, 0)),
            },
            ...(typeof item.summary === "string" ? { summary: item.summary } : {}),
          };
        })
    : [];
  return {
    version: 3,
    pad: {
      v: clamp(finite(pad.v, base.pad.v)),
      a: clamp(finite(pad.a, base.pad.a)),
      d: clamp(finite(pad.d, base.pad.d)),
    },
    mood: clamp(finite(input.mood, base.mood)),
    energy: clampUnit(finite(input.energy, base.energy)),
    drives: {
      curiosity: clampUnit(finite(drives.curiosity, base.drives.curiosity)),
      recognition: clampUnit(finite(drives.recognition, base.drives.recognition)),
      contact: clampUnit(finite(drives.contact, base.drives.contact)),
      order: clampUnit(finite(drives.order, base.drives.order)),
    },
    habituation,
    lastEvents,
    journal: Array.isArray(input.journal)
      ? input.journal.filter((line): line is string => typeof line === "string" && line.length > 0).slice(0, 14)
      : [],
    care: seedCare(input as Partial<AffectState>, now),
    updatedAt: finite(input.updatedAt, now),
    lastInteractionAt: finite(input.lastInteractionAt, finite(input.updatedAt, now)),
    driveHighSince:
      typeof input.driveHighSince === "number" && Number.isFinite(input.driveHighSince) ? input.driveHighSince : null,
    lastSleepMoodAt: finite(input.lastSleepMoodAt, 0),
    lastProactiveAt: finite(input.lastProactiveAt, 0),
    lastLonelyAt: finite(input.lastLonelyAt, 0),
    enabled: input.enabled !== false,
    careMigration: typeof input.careMigration === "number" && Number.isFinite(input.careMigration) ? input.careMigration : 0,
    ...(input.legacyCare && typeof input.legacyCare === "object"
      ? { legacyCare: seedCare({ care: input.legacyCare as AffectState["care"] }, now) }
      : {}),
  };
}

async function loadOrDefault(dir: string, personality: Personality): Promise<AffectState> {
  try {
    const raw = JSON.parse(await readFile(statePath(dir), "utf8"));
    return sanitize(raw, personality);
  } catch {
    return baselineState(personality);
  }
}

async function writeAtomic(dir: string, state: AffectState): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = statePath(dir);
  const temporary = join(dirname(target), `.state.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export function createStore(dir: string, personality: Personality) {
  let cache: AffectState | null = null;
  let chain = Promise.resolve();
  let dirty = false;
  const run = <T>(fn: () => Promise<T>) => {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    read: () => run(async () => (cache ??= await loadOrDefault(dir, personality))),
    snapshot: () => run(async () => structuredClone((cache ??= await loadOrDefault(dir, personality)))),
    mutate: (fn: (state: AffectState) => AffectState) =>
      run(async () => {
        const current = cache ??= await loadOrDefault(dir, personality);
        cache = sanitize(fn(structuredClone(current)), personality);
        dirty = true;
        return cache;
      }),
    flush: () =>
      run(async () => {
        if (!dirty || !cache) return;
        await writeAtomic(dir, cache);
        dirty = false;
      }),
  };
}
