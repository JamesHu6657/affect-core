import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyCare, remainingCare } from "../src/care.ts";
import { derive, emotionalLabel, renderStatus } from "../src/derive.ts";
import { personalityFrom } from "../src/personality.ts";
import { NEUTRAL_BOND, type AffectState } from "../src/types.ts";

const personality = personalityFrom({ enabled: true, maxIntensity: 2 });
const now = Date.parse("2026-08-14T04:00:00.000Z");

function state(partial: Partial<AffectState>): AffectState {
  return {
    version: 3,
    pad: { v: 0.18, a: -0.02, d: 0.17 },
    mood: 0.1,
    energy: 1,
    drives: { curiosity: 0.4, recognition: 0.5, contact: 0.2, order: 0.3 },
    habituation: {},
    lastEvents: [],
    journal: [],
    care: emptyCare("2026-08-14"),
    updatedAt: now,
    lastInteractionAt: now,
    driveHighSince: null,
    lastSleepMoodAt: 0,
    lastProactiveAt: 0,
    lastLonelyAt: 0,
    enabled: true,
    ...partial,
  };
}

const stranger = { ...NEUTRAL_BOND, lastSeenAt: now };

describe("derive", () => {
  it("names the latest fresh event instead of collapsing to 平和", () => {
    const current = state({
      lastEvents: [{ tag: "achieve", at: now - 60_000, source: "tool", delta: { v: 0.2, a: 0.1, d: 0.1 }, summary: "一起把 image 做成了" }],
    });
    const direction = derive(current, stranger, personality, now);
    assert.equal(direction.label, "愉悦");
    assert.ok(direction.intensity >= 1);
    assert.equal(direction.stage, "陌生");
  });

  it("maps ordinary talk to 安定", () => {
    assert.equal(
      emotionalLabel(
        state({ lastEvents: [{ tag: "contact", at: now, source: "l0", delta: { v: 0.05, a: 0.04, d: 0.02 } }] }),
        now,
      ),
      "安定",
    );
  });

  it("forgets event names after four hours and can return 平和", () => {
    const stale = state({
      pad: { v: personality.base.v, a: personality.base.a, d: personality.base.d },
      mood: personality.base.mood,
      lastEvents: [{ tag: "achieve", at: now - 5 * 60 * 60 * 1000, source: "tool", delta: { v: 0.2, a: 0.1, d: 0.1 } }],
    });
    assert.equal(emotionalLabel(stale, now), "平和");
  });

  it("renders a pet status card", () => {
    const current = state({
      care: { ...emptyCare("2026-08-14"), streak: 3, lastCareDay: "2026-08-14", today: { day: "2026-08-14", familiarity: 0.01, affection: 0.004, interactions: 4, negAffection: 0, negTrust: 0 } },
      lastEvents: [{ tag: "contact", at: now, source: "l0", delta: { v: 0.05, a: 0.04, d: 0.02 }, summary: "你继续陪她说话" }],
    });
    const bond = { ...stranger, care: current.care };
    const text = renderStatus(derive(current, bond, personality, now), remainingCare(bond.care, now, "Asia/Shanghai"));
    assert.match(text, /安定/);
    assert.match(text, /陌生/);
    assert.match(text, /连续照顾 3 天/);
    assert.match(text, /今日养成 4\/12/);
    assert.match(text, /你继续陪她说话/);
  });
});
