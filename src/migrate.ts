import { emptyCare } from "./care.ts";
import type { AffectState, Bond, CareState } from "./types.ts";

export const CARE_MIGRATION = 4;

export function careLooksUsed(care: CareState | undefined): boolean {
  if (!care) return false;
  return care.streak > 0 || Boolean(care.lastCareDay) || care.today.interactions > 0 || care.lastStage !== "陌生";
}

export function planCareMigration(
  state: AffectState,
  bonds: Array<[string, Bond]>,
  ownerId?: string,
): { state: AffectState; bonds: Array<[string, Bond]>; note: string } {
  if ((state.careMigration ?? 0) >= CARE_MIGRATION) {
    return { state, bonds, note: "already-migrated" };
  }
  const leftover = state.legacyCare ?? state.care;
  const used = careLooksUsed(leftover);
  const { legacyCare: _ignored, ...rest } = state;
  const nextState: AffectState = { ...rest, careMigration: CARE_MIGRATION, care: emptyCare() };
  if (!used) return { state: nextState, bonds, note: "empty" };

  const target = ownerId && bonds.some(([id]) => id === ownerId) ? ownerId : bonds.length === 1 ? bonds[0]![0] : undefined;
  if (target) {
    const mapped = bonds.map(([id, bond]) =>
      id === target && !careLooksUsed(bond.care) ? ([id, { ...bond, care: leftover }] as [string, Bond]) : ([id, bond] as [string, Bond]),
    );
    return { state: nextState, bonds: mapped, note: `moved:${target}` };
  }
  return { state: { ...nextState, legacyCare: leftover }, bonds, note: bonds.length === 0 ? "deferred-no-bonds" : "legacy-ambiguous" };
}
