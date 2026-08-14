import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyCare } from "../src/care.ts";
import { planCareMigration } from "../src/migrate.ts";
import { personalityFrom } from "../src/personality.ts";
import { baselineState } from "../src/dynamics.ts";
import { NEUTRAL_BOND } from "../src/types.ts";

const p = personalityFrom();

describe("care migration", () => {
  it("moves leftover global care onto the only bond", () => {
    const state = { ...baselineState(p, 1), care: { ...emptyCare("2026-08-01"), streak: 9, lastCareDay: "2026-08-01" } };
    const planned = planCareMigration(state, [["u1", { ...NEUTRAL_BOND, care: emptyCare() }]]);
    assert.equal(planned.note, "moved:u1");
    assert.equal(planned.bonds[0]?.[1].care.streak, 9);
    assert.equal(planned.state.careMigration, 4);
    assert.equal(planned.state.care.streak, 0);
  });

  it("keeps leftover care when several bonds exist", () => {
    const state = { ...baselineState(p, 1), care: { ...emptyCare("2026-08-01"), streak: 4, lastCareDay: "2026-08-01" } };
    const planned = planCareMigration(state, [
      ["a", { ...NEUTRAL_BOND, care: emptyCare() }],
      ["b", { ...NEUTRAL_BOND, care: emptyCare() }],
    ]);
    assert.equal(planned.note, "legacy-ambiguous");
    assert.equal(planned.state.legacyCare?.streak, 4);
    assert.equal(planCareMigration(planned.state, planned.bonds).note, "already-migrated");
  });

  it("honors careMigrateTo when multiple bonds exist", () => {
    const state = { ...baselineState(p, 1), care: { ...emptyCare("2026-08-01"), streak: 6, lastCareDay: "2026-08-01" } };
    const planned = planCareMigration(
      state,
      [
        ["a", { ...NEUTRAL_BOND, care: emptyCare() }],
        ["b", { ...NEUTRAL_BOND, care: emptyCare() }],
      ],
      "b",
    );
    assert.equal(planned.note, "moved:b");
    assert.equal(planned.bonds.find(([id]) => id === "b")?.[1].care.streak, 6);
  });
});
