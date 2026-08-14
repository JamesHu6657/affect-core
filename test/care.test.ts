import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FAM_CAP,
  applyCareLedger,
  applyNeglectLedger,
  daysToStage,
  emptyCare,
  noteStage,
  remainingCare,
  stageOf,
  streakBonus,
} from "../src/care.ts";

const TZ = "Asia/Shanghai";
// 2026-08-14 12:00 +08
const DAY0 = Date.parse("2026-08-14T04:00:00.000Z");
const hour = 60 * 60 * 1000;
const day = 24 * hour;

describe("care ledger", () => {
  it("caps familiarity so one day of spam cannot reach 眼熟", () => {
    let care = emptyCare();
    let fam = 0;
    for (let i = 0; i < 80; i += 1) {
      const result = applyCareLedger(care, "contact", DAY0 + i * 1000, TZ);
      care = result.care;
      fam += result.bond.familiarity ?? 0;
    }
    assert.ok(fam < 0.15, `spam day familiarity ${fam} must stay below 眼熟`);
    assert.ok(care.today.interactions === 80);
    assert.ok(remainingCare(care, DAY0, TZ).softLeft === 0);
  });

  it("counts a care day and continues the streak across midnight", () => {
    let care = emptyCare();
    care = applyCareLedger(care, "contact", DAY0, TZ).care;
    assert.equal(care.streak, 1);
    care = applyCareLedger(care, "contact", DAY0 + day, TZ).care;
    assert.equal(care.streak, 2);
    care = applyCareLedger(care, "contact", DAY0 + 2 * day, TZ).care;
    assert.equal(care.streak, 3);
  });

  it("breaks the streak after a missed civil day", () => {
    let care = applyCareLedger(emptyCare(), "praise", DAY0, TZ).care;
    care = applyCareLedger(care, "contact", DAY0 + 2 * day, TZ).care;
    assert.equal(care.streak, 1);
  });

  it("praise is worth more affection than contact", () => {
    const talk = applyCareLedger(emptyCare(), "contact", DAY0, TZ).bond;
    const thanks = applyCareLedger(emptyCare(), "praise", DAY0, TZ).bond;
    assert.ok((thanks.affection ?? 0) > (talk.affection ?? 0));
  });

  it("negative hits are not blocked by the daily cap", () => {
    let care = emptyCare();
    for (let i = 0; i < 20; i += 1) care = applyCareLedger(care, "contact", DAY0 + i * 1000, TZ).care;
    const blamed = applyCareLedger(care, "blame", DAY0 + 30_000, TZ);
    assert.ok((blamed.bond.trust ?? 0) < 0);
    assert.ok((blamed.bond.affection ?? 0) < 0);
  });

  it("neglect after a missed day lowers affection once per day", () => {
    let care = applyCareLedger(emptyCare(), "contact", DAY0, TZ).care;
    const first = applyNeglectLedger(care, DAY0 + 2 * day, TZ);
    assert.equal(first.bond.affection, -0.012);
    const second = applyNeglectLedger(first.care, DAY0 + 2 * day + hour, TZ);
    assert.deepEqual(second.bond, {});
    const third = applyNeglectLedger(first.care, DAY0 + 3 * day, TZ);
    assert.equal(third.bond.affection, -0.012);
  });

  it("hard-caps daily familiarity with no trickle", () => {
    let care = emptyCare();
    let fam = 0;
    for (let i = 0; i < 20; i += 1) {
      const result = applyCareLedger(care, "contact", DAY0 + i * 1000, TZ);
      care = result.care;
      fam += result.bond.familiarity ?? 0;
    }
    assert.ok(fam <= 0.022 + 1e-9, `fam ${fam}`);
  });

  it("promotes stage only when crossing upward", () => {
    const noted = noteStage(emptyCare(), 0.16);
    assert.equal(noted.promoted, "眼熟");
    const again = noteStage(noted.care, 0.2);
    assert.equal(again.promoted, null);
  });

  it("takes more than a week of full days to reach 眼熟, weeks to reach 羁绊", () => {
    assert.ok(daysToStage("眼熟") >= 7);
    assert.ok(daysToStage("羁绊") >= 35);
    assert.ok(DEFAULT_FAM_CAP < 0.03);
  });

  it("streak bonus is bounded", () => {
    assert.equal(streakBonus(1), 1);
    assert.ok(streakBonus(7) > 1);
    assert.equal(streakBonus(99), 1.35);
  });

  it("stageOf maps the published thresholds", () => {
    assert.equal(stageOf(0), "陌生");
    assert.equal(stageOf(0.15), "眼熟");
    assert.equal(stageOf(0.35), "熟悉");
    assert.equal(stageOf(0.6), "亲近");
    assert.equal(stageOf(0.82), "羁绊");
  });
});
