import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createL1Appraiser, mapL1ToPad } from "../src/appraise-l1.ts";
import { applyBondDelta, fadeBond, AFFECTION_CAP } from "../src/bonds.ts";
import { tokenBucket } from "../src/budget.ts";
import { createAffectCore } from "../src/core.ts";
import { derive, deriveIntensity } from "../src/derive.ts";
import { applySatisfiedDrives, baselineState, CAP, decayHab, impulse, tick } from "../src/dynamics.ts";
import { HARD_CONSTRAINTS, renderStageNotes } from "../src/express.ts";
import { personalityFrom } from "../src/personality.ts";
import { createStore } from "../src/store.ts";
import { NEUTRAL_BOND, type AffectState, type Pad } from "../src/types.ts";

const p = personalityFrom();
const start = 1_700_000_000_000;
const finite = (value: number) => Number.isFinite(value) && value >= -1 && value <= 1;

function stateAt(now = start): AffectState {
  return baselineState(p, now);
}

const positive: Pad = { v: 0.3, a: 0.16, d: 0.12 };
const negative: Pad = { v: -0.28, a: 0.24, d: -0.3 };

test("1. 任意随机序列保持有界且无 NaN", () => {
  let state = stateAt();
  let seed = 7;
  for (let index = 0; index < 2_000; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
    state = tick(state, p, start + index * 60_000);
    state = impulse(state, { v: random(), a: random(), d: random() }, `r-${index % 9}`, start + index * 60_000);
    assert.ok(finite(state.pad.v) && finite(state.pad.a) && finite(state.pad.d) && finite(state.mood));
    assert.ok(Number.isFinite(state.energy) && state.energy >= 0 && state.energy <= 1);
  }
});

test("2. 单事件每一维有效位移不超过 0.35", () => {
  const before = stateAt();
  const after = impulse(before, { v: 99, a: -99, d: 99 }, "extreme", start);
  const epsilon = 1e-12;
  assert.ok(Math.abs(after.pad.v - before.pad.v) <= CAP + epsilon);
  assert.ok(Math.abs(after.pad.a - before.pad.a) <= CAP + epsilon);
  assert.ok(Math.abs(after.pad.d - before.pad.d) <= CAP + epsilon);
});

test("3. 习惯化使 20 次同类正事件的总位移小于 6 次的两倍", () => {
  const mild: Pad = { v: 0.05, a: 0, d: 0 };
  const simulate = (count: number) => {
    let state = stateAt();
    for (let index = 0; index < count; index += 1) state = impulse(state, mild, "praise", start + index * 1_000);
    return state.pad.v - p.base.v;
  };
  assert.ok(simulate(20) < simulate(6) * 2);
});

test("4. 习惯化系数有地板且归零后删除键", () => {
  let state = stateAt();
  for (let index = 0; index < 30; index += 1) state = impulse(state, positive, "praise", start + index);
  assert.equal(state.habituation.praise?.n, 6);
  const oneMore = impulse(state, positive, "praise", start + 31);
  assert.ok(Math.abs(oneMore.lastEvents[0]!.delta.v) >= positive.v * Math.pow(0.6, 6) - 1e-10);
  const decayed = decayHab(oneMore.habituation, start + 31 + 6 * 30 * 60_000);
  assert.equal(decayed.praise, undefined);
});

test("5. 单事件直接耦合 mood，位移落在 0.03 到 0.09", () => {
  const before = stateAt();
  const after = impulse(before, positive, "praise", start);
  const displacement = after.mood - before.mood;
  assert.ok(displacement >= 0.03 && displacement <= 0.09, `${displacement}`);
});

test("6. 24 小时无事件后 PAD 回归基线而 mood 仍保留方向", () => {
  const before = impulse(stateAt(), positive, "praise", start);
  const after = tick(before, p, start + 24 * 60 * 60_000);
  assert.ok(Math.abs(after.pad.v - p.base.v) < 0.05);
  assert.ok(Math.abs(after.pad.a - p.base.a) < 0.05);
  assert.ok(Math.abs(after.pad.d - p.base.d) < 0.05);
  assert.ok(after.mood > p.base.mood);
});

test("7. 仅输入负事件 200 条，mood 不跌破 -0.75", () => {
  let state = stateAt();
  for (let index = 0; index < 200; index += 1) state = impulse(state, negative, "blame", start + index * 1_000);
  assert.ok(state.mood >= -0.75, `${state.mood}`);
});

test("8. 时钟回拨后下一次 tick 仍推进", () => {
  const first = impulse(stateAt(start), positive, "praise", start);
  const rolledBack = tick(first, p, start - 60 * 60_000);
  const resumed = tick(rolledBack, p, start - 60 * 60_000 + 60_000);
  assert.equal(rolledBack.updatedAt, start - 60 * 60_000);
  assert.equal(resumed.updatedAt, start - 60 * 60_000 + 60_000);
  assert.notEqual(resumed.pad.v, rolledBack.pad.v);
});

test("9. 停机 30 天后状态有限、回归基线且驱力不越界", () => {
  const prior = impulse(stateAt(), { v: -0.35, a: 0.35, d: -0.35 }, "blame", start);
  const after = tick(prior, p, start + 30 * 24 * 60 * 60_000);
  assert.ok(finite(after.pad.v) && finite(after.pad.a) && finite(after.pad.d) && finite(after.mood));
  assert.ok(Math.abs(after.pad.v - p.base.v) < 0.05);
  assert.ok(Math.abs(after.pad.a - p.base.a) < 0.05);
  assert.ok(Math.abs(after.pad.d - p.base.d) < 0.05);
  assert.ok(Object.values(after.drives).every((value) => value >= 0 && value <= 1));
  assert.ok(after.energy >= 0.5, `${after.energy}`);
});

test("10. 非法 τ 统一回落默认值且不污染状态", () => {
  const invalid = personalityFrom({ tau: { v: 0, a: -1, d: Number.NaN, mood: "bad" } });
  assert.deepEqual(invalid.tau, { v: 55, a: 14, d: 70, mood: 900 });
  const result = tick(stateAt(), invalid, start + 60_000);
  assert.ok(finite(result.pad.v) && finite(result.pad.a) && finite(result.pad.d) && finite(result.mood));
});

test("11. L1 超时或失败时，L0 已生效且仍可生成回复注入", async () => {
  const dir = await mkdtemp(join(tmpdir(), "affect-test-"));
  try {
    const core = createAffectCore({
      dir,
      config: { enabled: true, l1: { enabled: true, maxRatePerHour: 12, timeoutMs: 5 } },
      l1: { appraise: async () => { throw new Error("model unavailable"); } },
    });
    await core.onMessage({ text: "谢谢，做得很好", userId: "u" });
    const state = await core.store.read();
    assert.equal(state.lastEvents[0]?.tag, "praise");
    const reply = await core.beforeAgentReply("u");
    assert.ok(typeof reply.systemAppend === "string");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("12. 一小时内 L1 实际许可次数不超过 maxRatePerHour", () => {
  const bucket = tokenBucket(3, () => start);
  assert.equal(bucket.take(start), true);
  assert.equal(bucket.take(start + 1), true);
  assert.equal(bucket.take(start + 2), true);
  assert.equal(bucket.take(start + 3), false);
  assert.equal(bucket.take(start + 60 * 60_000 + 4), true);
});

test("13. mutate 与 cron tick 交错并发不丢失事件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "affect-store-"));
  try {
    const store = createStore(dir, p);
    const jobs: Promise<unknown>[] = [];
    for (let index = 0; index < 200; index += 1) {
      jobs.push(store.mutate((state) => impulse(state, { v: 0.01, a: 0, d: 0 }, `event-${index}`, start + index)));
    }
    for (let index = 0; index < 50; index += 1) {
      jobs.push(store.mutate((state) => tick(state, p, start + 200 + index * 60_000)));
    }
    await Promise.all(jobs);
    const state = await store.read();
    // 200 mutations are queued before 50 ticks. The bounded journal retains the newest 12,
    // so its ordered tail proves no queued mutation was overwritten by concurrent ticks.
    assert.equal(state.lastEvents.length, 12);
    assert.equal(state.lastEvents[0]?.tag, "event-199");
    assert.equal(state.lastEvents.at(-1)?.tag, "event-188");
    assert.equal(state.updatedAt, start + 200 + 49 * 60_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("14. 500 次 praise 后 affection 不超过 0.85", () => {
  let bond = { ...NEUTRAL_BOND };
  for (let index = 0; index < 500; index += 1) bond = applyBondDelta(bond, { affection: 0.04 }, start + index);
  assert.ok(bond.affection <= AFFECTION_CAP);
});

test("15. 陌生用户输出强度不超过 1", () => {
  const extreme = impulse(stateAt(), { v: -0.35, a: 0.35, d: -0.35 }, "blame", start);
  assert.ok(deriveIntensity(extreme, { ...NEUTRAL_BOND, familiarity: 0 }, p) <= 1);
  assert.ok(deriveIntensity(extreme, { ...NEUTRAL_BOND, familiarity: 0.1 }, p) <= 1);
});

test("16. 任意状态下注入片段包含硬约束；强度 0 不含离散情绪名", () => {
  const neutral = renderStageNotes({ label: "平和", intensity: 0, warmth: "neutral", pace: "steady", assertiveness: "balanced", address: "formal" });
  assert.ok(neutral.includes(HARD_CONSTRAINTS));
  assert.ok(!/愉悦|受挫|低落|疲惫|谨慎|明朗/.test(neutral));
  const intense = renderStageNotes({ label: "受挫", intensity: 3, warmth: "cool", pace: "energetic", assertiveness: "tentative", address: "familiar", recentTag: "blame" });
  assert.ok(intense.includes(HARD_CONSTRAINTS));
});

test("L1 缓存命中不重复调用适配器", async () => {
  let calls = 0;
  const appraise = createL1Appraiser({
    appraise: async () => {
      calls += 1;
      return { tag: "ambiguous", summary: "test", desirability: 0, expectedness: 0.5, agency: "none", controllability: 0.5, normViolation: 0, relevanceToBond: 0 };
    },
  });
  const message = { text: "关系很重要", userId: "u" };
  await appraise(message, NEUTRAL_BOND, "ambiguous");
  await appraise(message, NEUTRAL_BOND, "ambiguous");
  assert.equal(calls, 1);
});

test("默认禁用或 /mood off 后不再积累新的情感事件", async () => {
  const disabledDir = await mkdtemp(join(tmpdir(), "affect-disabled-"));
  const enabledDir = await mkdtemp(join(tmpdir(), "affect-off-"));
  try {
    const disabled = createAffectCore({ dir: disabledDir, config: { enabled: false } });
    await disabled.onMessage({ text: "谢谢", userId: "u" });
    assert.equal((await disabled.store.read()).lastEvents.length, 0);
    assert.deepEqual(await disabled.beforeAgentReply("u"), {});

    const enabled = createAffectCore({ dir: enabledDir, config: { enabled: true } });
    const off = await enabled.onMessage({ text: "/mood off", userId: "u" });
    assert.ok(off?.reply?.includes("关闭"));
    await enabled.onMessage({ text: "谢谢", userId: "u" });
    assert.equal((await enabled.store.read()).lastEvents.length, 0);
  } finally {
    await Promise.all([
      rm(disabledDir, { recursive: true, force: true }),
      rm(enabledDir, { recursive: true, force: true }),
    ]);
  }
});

test("cron 静默以 lastInteractionAt 计，心跳 tick 不会阻止 lonely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "affect-lonely-"));
  let now = start;
  try {
    const core = createAffectCore({ dir, config: { enabled: true }, now: () => now });
    await core.onMessage({ text: "随便聊一句", userId: "u" });
    now += 5 * 60_000;
    await core.heartbeat(now);
    assert.notEqual((await core.store.read()).lastEvents[0]?.tag, "lonely");
    now += 6 * 60 * 60_000;
    await core.heartbeat(now);
    assert.equal((await core.store.read()).lastEvents[0]?.tag, "lonely");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("L1 缓存命中不消耗小时配额", async () => {
  const dir = await mkdtemp(join(tmpdir(), "affect-l1-budget-"));
  let calls = 0;
  try {
    const core = createAffectCore({
      dir,
      config: { enabled: true, l1: { enabled: true, maxRatePerHour: 2, timeoutMs: 200 } },
      l1: {
        appraise: async () => {
          calls += 1;
          return {
            tag: "distance",
            summary: "relational",
            desirability: -0.2,
            expectedness: 0.4,
            agency: "other",
            controllability: 0.3,
            normViolation: 0,
            relevanceToBond: 0.6,
          };
        },
      },
    });
    const first = { text: "这段关系让我很失望", userId: "u" };
    await core.onMessage(first);
    await core.onMessage(first);
    await core.onMessage({ text: "我很抱歉，也谈一下信任", userId: "u" });
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("L1 唤醒度不随效价变号，失败结果不进缓存", async () => {
  const pad = mapL1ToPad({
    tag: "blame",
    summary: "unexpected harm",
    desirability: -0.8,
    expectedness: 0.1,
    agency: "other",
    controllability: 0.2,
    normViolation: 0.1,
    relevanceToBond: 0.4,
  });
  assert.ok(pad.a > 0);

  let calls = 0;
  const appraise = createL1Appraiser({
    appraise: async () => {
      calls += 1;
      throw new Error("timeout");
    },
  });
  const message = { text: "关系很重要", userId: "u" };
  assert.equal(await appraise(message, NEUTRAL_BOND, "ambiguous"), null);
  assert.equal(await appraise(message, NEUTRAL_BOND, "ambiguous"), null);
  assert.equal(calls, 2);
});

test("驱力在对应事件上清除，unmet 只在持续偏高后触发", async () => {
  const afterDay = tick(stateAt(), p, start + 10 * 60 * 60_000);
  assert.ok(afterDay.drives.curiosity > 0.7);
  const satisfied = applySatisfiedDrives(afterDay, ["novelty", "praise"], ["contact"]);
  assert.equal(satisfied.drives.curiosity, 0);
  assert.equal(satisfied.drives.recognition, 0);
  assert.equal(satisfied.drives.contact, 0);
  assert.equal(satisfied.driveHighSince, null);

  const dir = await mkdtemp(join(tmpdir(), "affect-unmet-"));
  let now = start + 10 * 60 * 60_000;
  try {
    const core = createAffectCore({ dir, config: { enabled: true }, now: () => now });
    await core.store.mutate((state) => ({ ...state, updatedAt: start, lastInteractionAt: now }));
    await core.heartbeat(now);
    assert.notEqual((await core.store.read()).lastEvents[0]?.tag, "unmet");
    now += 60 * 60_000;
    await core.heartbeat(now);
    assert.equal((await core.store.read()).lastEvents[0]?.tag, "unmet");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/mood 查询把状态文本返回给调用方", async () => {
  const dir = await mkdtemp(join(tmpdir(), "affect-mood-"));
  try {
    const core = createAffectCore({ dir, config: { enabled: true } });
    await core.onMessage({ text: "谢谢，做得很好", userId: "u" });
    const result = await core.onMessage({ text: "/mood", userId: "u" });
    assert.ok(result?.reply?.includes("当前表达状态"));
    await core.onSessionReset();
    const state = await core.store.read();
    assert.ok(state.journal.length >= 1);
    assert.equal(state.pad.v, p.base.v);
    assert.ok(state.mood !== p.base.mood || state.journal[0]?.includes("events"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("睡眠只额外拉回一次心境；低 energy 同时约束冲激与衰减", () => {
  const night = Date.UTC(2024, 0, 2, 2, 0, 0);
  const raised = { ...stateAt(night - 60_000), mood: 0.8, lastSleepMoodAt: 0 };
  const first = tick(raised, p, night, { tz: "UTC" });
  const expected = 0.8 + (p.base.mood - 0.8) * 0.3;
  assert.ok(Math.abs(first.mood - expected) < 0.05);
  const second = tick(first, p, night + 5 * 60_000, { tz: "UTC" });
  assert.ok(Math.abs(second.mood - first.mood) < 0.02);

  const tired = { ...stateAt(), energy: 0.2 };
  const burst = impulse(tired, { v: 0, a: 0.9, d: 0 }, "arouse", start);
  assert.ok(burst.pad.a <= 0.15 + 0.85 * burst.energy + 1e-12);
  const later = tick({ ...tired, pad: { v: 0, a: 0.9, d: 0 } }, p, start + 60_000, { tz: "UTC" });
  assert.ok(later.pad.a <= 0.15 + 0.85 * later.energy + 1e-12);

  const evening = Date.UTC(2024, 0, 2, 22, 0, 0);
  const morning = Date.UTC(2024, 0, 3, 10, 0, 0);
  const overnight = tick({ ...stateAt(evening), mood: 0.8, lastSleepMoodAt: 0 }, p, morning, { tz: "UTC" });
  assert.ok(overnight.lastSleepMoodAt > 0);
  assert.ok(overnight.mood < 0.38, `${overnight.mood}`);
});

test("熟悉度随时间轻微钝化；结转的负心境会降低用词温度", () => {
  const warm = { ...NEUTRAL_BOND, familiarity: 0.8, lastSeenAt: start };
  const faded = fadeBond(warm, start + 14 * 7 * 24 * 60 * 60_000);
  assert.ok(faded.familiarity < warm.familiarity);
  assert.ok(faded.familiarity > 0.6);

  const carried = { ...stateAt(), pad: { v: p.base.v, a: p.base.a, d: p.base.d }, mood: -0.7 };
  assert.equal(derive(carried, NEUTRAL_BOND, p).warmth, "cool");
});

test("/mood 先 tick 再改时钟，空闲演化不会被抹掉", async () => {
  const dir = await mkdtemp(join(tmpdir(), "affect-mood-tick-"));
  let now = start;
  try {
    const core = createAffectCore({ dir, config: { enabled: true }, now: () => now });
    await core.onMessage({ text: "谢谢，做得很好", userId: "u" });
    const afterPraise = await core.store.read();
    now += 24 * 60 * 60_000;
    const reply = await core.onMessage({ text: "/mood", userId: "u" });
    const after = await core.store.read();
    assert.ok(reply?.reply?.includes("当前表达状态"));
    assert.equal(after.updatedAt, now);
    assert.ok(Math.abs(after.pad.v - p.base.v) < Math.abs(afterPraise.pad.v - p.base.v));
    assert.ok(after.mood > p.base.mood);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lonely 每个静默回合只发一次，随后允许 unmet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "affect-lonely-once-"));
  let now = start;
  try {
    const core = createAffectCore({ dir, config: { enabled: true }, now: () => now });
    await core.store.mutate((state) => ({ ...state, updatedAt: start, lastInteractionAt: start, lastLonelyAt: 0 }));
    now = start + 6 * 60 * 60_000;
    await core.heartbeat(now);
    assert.equal((await core.store.read()).lastEvents[0]?.tag, "lonely");
    now += 5 * 60_000;
    await core.heartbeat(now);
    assert.equal((await core.store.read()).lastEvents.filter((event) => event.tag === "lonely").length, 1);
    now = start + 10 * 60 * 60_000;
    await core.heartbeat(now);
    now += 60 * 60_000;
    await core.heartbeat(now);
    const events = (await core.store.read()).lastEvents;
    assert.equal(events[0]?.tag, "unmet");
    assert.ok(events.some((event) => event.tag === "lonely"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
