import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { clampUnit } from "./dynamics.ts";
import { NEUTRAL_BOND, type Bond } from "./types.ts";

const AFFECTION_CAP = 0.85;

function sanitizeBond(raw: unknown, now = Date.now()): Bond {
  const value = raw && typeof raw === "object" ? (raw as Partial<Bond>) : {};
  const finite = (input: unknown, fallback: number) =>
    typeof input === "number" && Number.isFinite(input) ? input : fallback;
  return {
    familiarity: clampUnit(finite(value.familiarity, 0)),
    affection: Math.min(AFFECTION_CAP, clampUnit(finite(value.affection, 0))),
    trust: clampUnit(finite(value.trust, NEUTRAL_BOND.trust)),
    lastSeenAt: finite(value.lastSeenAt, now),
  };
}

export const FAMILIARITY_FADE_PER_WEEK = 0.01;

export function fadeBond(bond: Bond, now = Date.now()): Bond {
  if (!Number.isFinite(bond.lastSeenAt) || bond.lastSeenAt <= 0 || now <= bond.lastSeenAt) return bond;
  const weeks = (now - bond.lastSeenAt) / (7 * 24 * 60 * 60 * 1000);
  const fade = Math.min(0.3, weeks * FAMILIARITY_FADE_PER_WEEK);
  if (fade <= 0) return bond;
  return { ...bond, familiarity: clampUnit(bond.familiarity - fade) };
}

export function applyBondDelta(bond: Bond, delta: Partial<Pick<Bond, "familiarity" | "affection" | "trust">>, now = Date.now()): Bond {
  const familiarityDelta = Number.isFinite(delta.familiarity) ? (delta.familiarity as number) : 0;
  const affectionDelta = Number.isFinite(delta.affection) ? (delta.affection as number) : 0;
  const trustDelta = Number.isFinite(delta.trust) ? (delta.trust as number) : 0;

  return {
    // Familiarity never decreases through social event updates.
    familiarity: Math.max(bond.familiarity, clampUnit(bond.familiarity + Math.max(0, familiarityDelta))),
    // Positive affection saturates; negative affection still applies directly.
    affection: Math.min(
      AFFECTION_CAP,
      clampUnit(bond.affection + (affectionDelta > 0 ? affectionDelta * (1 - bond.affection) : affectionDelta)),
    ),
    // Trust rises slowly and falls at full rate.
    trust: clampUnit(bond.trust + (trustDelta > 0 ? trustDelta * 0.3 : trustDelta)),
    lastSeenAt: now,
  };
}

export interface BondStore {
  read(userId: string): Promise<Bond>;
  update(userId: string, delta: Partial<Pick<Bond, "familiarity" | "affection" | "trust">>): Promise<Bond>;
  fadeAll(now?: number): Promise<void>;
  flush(): Promise<void>;
}

export function createBondStore(dir: string): BondStore {
  const file = join(dir, "bonds.json");
  let cache: Record<string, Bond> | null = null;
  let dirty = false;
  let chain: Promise<unknown> = Promise.resolve();

  const run = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const load = async (): Promise<Record<string, Bond>> => {
    if (cache) return cache;
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
      if (!raw || typeof raw !== "object") return (cache = {});
      cache = Object.fromEntries(Object.entries(raw).map(([id, bond]) => [id, sanitizeBond(bond)]));
      return cache;
    } catch {
      cache = {};
      return cache;
    }
  };

  return {
    read: (userId) =>
      run(async () => {
        const bonds = await load();
        const now = Date.now();
        const faded = fadeBond(sanitizeBond(bonds[userId], now), now);
        if (bonds[userId] && faded.familiarity !== bonds[userId].familiarity) {
          bonds[userId] = faded;
          dirty = true;
        }
        return faded;
      }),
    update: (userId, delta) =>
      run(async () => {
        const bonds = await load();
        const now = Date.now();
        bonds[userId] = applyBondDelta(fadeBond(sanitizeBond(bonds[userId], now), now), delta, now);
        dirty = true;
        return bonds[userId];
      }),
    fadeAll: (now = Date.now()) =>
      run(async () => {
        const bonds = await load();
        for (const [userId, bond] of Object.entries(bonds)) {
          const faded = fadeBond(bond, now);
          if (faded.familiarity !== bond.familiarity) {
            bonds[userId] = faded;
            dirty = true;
          }
        }
      }),
    flush: () =>
      run(async () => {
        if (!dirty || !cache) return;
        await mkdir(dir, { recursive: true });
        const temporary = join(dirname(file), `.bonds.${process.pid}.${Date.now()}.tmp`);
        await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
        await rename(temporary, file);
        dirty = false;
      }),
  };
}

export { AFFECTION_CAP };
