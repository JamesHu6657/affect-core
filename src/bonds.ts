import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { emptyCare, seedCare } from "./care.ts";
import { clampUnit } from "./dynamics.ts";
import { NEUTRAL_BOND, type Bond, type BondDelta, type CareState } from "./types.ts";

const AFFECTION_CAP = 0.85;

function sanitizeBond(raw: unknown, now = Date.now()): Bond {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const finite = (input: unknown, fallback: number) =>
    typeof input === "number" && Number.isFinite(input) ? input : fallback;
  return {
    familiarity: clampUnit(finite(value.familiarity, 0)),
    affection: Math.min(AFFECTION_CAP, clampUnit(finite(value.affection, 0))),
    trust: clampUnit(finite(value.trust, NEUTRAL_BOND.trust)),
    lastSeenAt: finite(value.lastSeenAt, now),
    care: seedCare({ care: value.care as CareState }, now),
  };
}

export function applyBondDelta(bond: Bond, delta: BondDelta, now = Date.now(), touch = true): Bond {
  const familiarityDelta = Number.isFinite(delta.familiarity) ? (delta.familiarity as number) : 0;
  const affectionDelta = Number.isFinite(delta.affection) ? (delta.affection as number) : 0;
  const trustDelta = Number.isFinite(delta.trust) ? (delta.trust as number) : 0;
  return {
    familiarity: Math.max(bond.familiarity, clampUnit(bond.familiarity + Math.max(0, familiarityDelta))),
    affection: Math.min(
      AFFECTION_CAP,
      clampUnit(bond.affection + (affectionDelta > 0 ? affectionDelta * (1 - bond.affection) : affectionDelta)),
    ),
    trust: clampUnit(bond.trust + (trustDelta > 0 ? trustDelta * 0.3 : trustDelta)),
    lastSeenAt: touch ? now : bond.lastSeenAt,
    care: bond.care ?? emptyCare(),
  };
}

export function createBondStore(dir: string) {
  const file = join(dir, "bonds.json");
  let cache: Record<string, Bond> | null = null;
  let dirty = false;
  let chain = Promise.resolve();
  const run = <T>(fn: () => Promise<T>) => {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const load = async () => {
    if (cache) return cache;
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      if (!raw || typeof raw !== "object") return (cache = {});
      cache = Object.fromEntries(Object.entries(raw).map(([id, bond]) => [id, sanitizeBond(bond)]));
      return cache;
    } catch {
      cache = {};
      return cache;
    }
  };
  return {
    read: (userId: string) =>
      run(async () => {
        const bonds = await load();
        return sanitizeBond(bonds[userId], Date.now());
      }),
    update: (userId: string, delta: BondDelta, touch = true) =>
      run(async () => {
        const bonds = await load();
        const now = Date.now();
        bonds[userId] = applyBondDelta(sanitizeBond(bonds[userId], now), delta, now, touch);
        dirty = true;
        return bonds[userId];
      }),
    mutate: (userId: string, fn: (bond: Bond) => Bond) =>
      run(async () => {
        const bonds = await load();
        const now = Date.now();
        const current = sanitizeBond(bonds[userId], now);
        bonds[userId] = sanitizeBond(fn(current), now);
        dirty = true;
        return bonds[userId];
      }),
    entries: () =>
      run(async () => {
        const bonds = await load();
        return Object.entries(bonds);
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
