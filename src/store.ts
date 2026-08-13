import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { baselineState, clamp, clampUnit } from "./dynamics.ts";
import type { AffectState, Personality } from "./types.ts";

export interface AffectStore {
  read(): Promise<AffectState>;
  mutate(fn: (state: AffectState) => AffectState): Promise<AffectState>;
  flush(): Promise<void>;
  snapshot(): Promise<AffectState>;
}

const statePath = (dir: string) => join(dir, "state.json");

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sanitize(raw: unknown, personality: Personality, now = Date.now()): AffectState {
  const base = baselineState(personality, now);
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Partial<AffectState>;
  const pad = input.pad && typeof input.pad === "object" ? input.pad : {};
  const drives = input.drives && typeof input.drives === "object" ? input.drives : {};
  const habituation: AffectState["habituation"] = {};

  if (input.habituation && typeof input.habituation === "object") {
    for (const [tag, value] of Object.entries(input.habituation)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as { n?: unknown; at?: unknown };
      const n = Math.max(0, Math.min(6, Math.floor(finite(entry.n, 0))));
      const at = finite(entry.at, now);
      if (n > 0 && Number.isFinite(at)) habituation[tag] = { n, at };
    }
  }

  const lastEvents = Array.isArray(input.lastEvents)
    ? input.lastEvents
        .filter((event): event is AffectState["lastEvents"][number] => {
          if (!event || typeof event !== "object") return false;
          const record = event as AffectState["lastEvents"][number];
          return typeof record.tag === "string" && Number.isFinite(record.at) && !!record.delta;
        })
        .slice(0, 12)
        .map((event) => ({
          tag: event.tag,
          at: finite(event.at, now),
          source: event.source ?? "l0",
          delta: {
            v: clamp(finite(event.delta.v, 0)),
            a: clamp(finite(event.delta.a, 0)),
            d: clamp(finite(event.delta.d, 0)),
          },
          ...(typeof event.summary === "string" ? { summary: event.summary } : {}),
        }))
    : [];

  const numericPad = pad as Partial<AffectState["pad"]>;
  const numericDrives = drives as Partial<AffectState["drives"]>;
  return {
    version: 2,
    pad: {
      v: clamp(finite(numericPad.v, base.pad.v)),
      a: clamp(finite(numericPad.a, base.pad.a)),
      d: clamp(finite(numericPad.d, base.pad.d)),
    },
    mood: clamp(finite(input.mood, base.mood)),
    energy: clampUnit(finite(input.energy, base.energy)),
    drives: {
      curiosity: clampUnit(finite(numericDrives.curiosity, base.drives.curiosity)),
      recognition: clampUnit(finite(numericDrives.recognition, base.drives.recognition)),
      contact: clampUnit(finite(numericDrives.contact, base.drives.contact)),
      order: clampUnit(finite(numericDrives.order, base.drives.order)),
    },
    habituation,
    lastEvents,
    journal: Array.isArray(input.journal)
      ? input.journal.filter((line): line is string => typeof line === "string" && line.length > 0).slice(0, 14)
      : [],
    updatedAt: finite(input.updatedAt, now),
    lastInteractionAt: finite(input.lastInteractionAt, finite(input.updatedAt, now)),
    driveHighSince:
      typeof input.driveHighSince === "number" && Number.isFinite(input.driveHighSince) ? input.driveHighSince : null,
    lastSleepMoodAt: finite(input.lastSleepMoodAt, 0),
    lastProactiveAt: finite(input.lastProactiveAt, 0),
    lastLonelyAt: finite(input.lastLonelyAt, 0),
    enabled: input.enabled !== false,
  };
}

async function loadOrDefault(dir: string, personality: Personality): Promise<AffectState> {
  try {
    const raw = JSON.parse(await readFile(statePath(dir), "utf8")) as unknown;
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

export function createStore(dir: string, personality: Personality): AffectStore {
  let cache: AffectState | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let dirty = false;

  const run = <T>(fn: () => Promise<T> | T): Promise<T> => {
    // The rejection branch intentionally invokes fn as well: a failed mutation must not poison the queue.
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  return {
    read: () => run(async () => (cache ??= await loadOrDefault(dir, personality))),
    snapshot: () => run(async () => structuredClone(cache ??= await loadOrDefault(dir, personality))),
    mutate: (fn) =>
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
