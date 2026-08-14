import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createAffectCore } from "../src/core.ts";
import { stageOf } from "../src/care.ts";

async function withCore(nowRef: { now: number }) {
  const dir = await mkdtemp(join(tmpdir(), "affect-pet-"));
  const core = createAffectCore({
    dir,
    config: { enabled: true, maxIntensity: 2, care: { tz: "Asia/Shanghai" } },
    now: () => nowRef.now,
  });
  return {
    core,
    dir,
    async close() {
      await core.flush();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("pet core", () => {
  it("eighty messages in one sitting stay 陌生", async () => {
    const nowRef = { now: Date.parse("2026-08-14T04:00:00.000Z") };
    const { core, close } = await withCore(nowRef);
    try {
      for (let i = 0; i < 80; i += 1) {
        nowRef.now += 1000;
        await core.onMessage({ text: `今天过得怎么样呀 ${i}`, userId: "u1", receivedAt: nowRef.now, kind: "message" });
      }
      const bond = await core.bonds.read("u1");
      assert.equal(stageOf(bond.familiarity), "陌生");
      const card = await core.command("/mood", "u1");
      assert.match(String(card), /陌生/);
      assert.match(String(card), /安定|愉悦|好奇|平和|空落|低落/);
    } finally {
      await close();
    }
  });

  it("daily care over many days can reach 眼熟, reset does not wipe it", async () => {
    const nowRef = { now: Date.parse("2026-08-14T04:00:00.000Z") };
    const { core, close } = await withCore(nowRef);
    try {
      for (let day = 0; day < 10; day += 1) {
        nowRef.now = Date.parse("2026-08-14T04:00:00.000Z") + day * 24 * 60 * 60 * 1000;
        await core.onMessage({ text: "我回来了", userId: "u1", receivedAt: nowRef.now, kind: "message" });
        await core.onMessage({ text: "谢谢你", userId: "u1", receivedAt: nowRef.now + 1000, kind: "message" });
      }
      const before = await core.bonds.read("u1");
      assert.equal(stageOf(before.familiarity), "眼熟");
      await core.command("/mood reset", "u1");
      const after = await core.bonds.read("u1");
      assert.ok(after.familiarity >= before.familiarity - 1e-9);
      const state = await core.store.read();
      assert.ok(state.care.streak >= 8);
    } finally {
      await close();
    }
  });

  it("empty and one-char messages do not count as care", async () => {
    const nowRef = { now: Date.parse("2026-08-14T04:00:00.000Z") };
    const { core, close } = await withCore(nowRef);
    try {
      await core.onMessage({ text: "", userId: "u1", receivedAt: nowRef.now, kind: "message" });
      await core.onMessage({ text: "啊", userId: "u1", receivedAt: nowRef.now + 1, kind: "message" });
      const bond = await core.bonds.read("u1");
      const state = await core.store.read();
      assert.equal(bond.familiarity, 0);
      assert.equal(state.care.today.interactions, 0);
      assert.equal(state.lastEvents.length, 0);
    } finally {
      await close();
    }
  });

  it("失望 is blame, not contact", async () => {
    const nowRef = { now: Date.parse("2026-08-14T04:00:00.000Z") };
    const { core, close } = await withCore(nowRef);
    try {
      await core.onMessage({ text: "我对你很失望", userId: "u1", receivedAt: nowRef.now, kind: "message" });
      const state = await core.store.read();
      const bond = await core.bonds.read("u1");
      assert.equal(state.lastEvents[0]?.tag, "blame");
      assert.ok((bond.trust ?? 0.5) < 0.5);
    } finally {
      await close();
    }
  });

  it("mood reset clears the face label", async () => {
    const nowRef = { now: Date.parse("2026-08-14T04:00:00.000Z") };
    const { core, close } = await withCore(nowRef);
    try {
      await core.onMessage({ text: "谢谢你", userId: "u1", receivedAt: nowRef.now, kind: "message" });
      await core.command("/mood reset", "u1");
      const card = String(await core.command("/mood", "u1"));
      assert.match(card, /平和/);
    } finally {
      await close();
    }
  });

  it("heartbeat neglect writes to bonds after two silent days", async () => {
    const nowRef = { now: Date.parse("2026-08-14T04:00:00.000Z") };
    const { core, close } = await withCore(nowRef);
    try {
      await core.onMessage({ text: "我回来了", userId: "u1", receivedAt: nowRef.now, kind: "message" });
      await core.onMessage({ text: "谢谢你", userId: "u1", receivedAt: nowRef.now + 1000, kind: "message" });
      const before = await core.bonds.read("u1");
      nowRef.now += 2 * 24 * 60 * 60 * 1000;
      await core.heartbeat(nowRef.now);
      const after = await core.bonds.read("u1");
      assert.ok(after.affection < before.affection);
      assert.equal(after.familiarity, before.familiarity);
    } finally {
      await close();
    }
  });

  it("unattributed long tools do not keep the streak alive", async () => {
    const nowRef = { now: Date.parse("2026-08-14T04:00:00.000Z") };
    const { core, close } = await withCore(nowRef);
    try {
      await core.onMessage({ text: "我回来了", userId: "u1", receivedAt: nowRef.now, kind: "message" });
      nowRef.now += 24 * 60 * 60 * 1000;
      await core.onToolResult({ toolName: "image", durationMs: 12_000 });
      const state = await core.store.read();
      assert.equal(state.care.streak, 1);
      assert.notEqual(state.care.lastCareDay, "2026-08-15");
    } finally {
      await close();
    }
  });

  it("session reset keeps the care ledger", async () => {
    const nowRef = { now: Date.parse("2026-08-14T04:00:00.000Z") };
    const { core, close } = await withCore(nowRef);
    try {
      await core.onMessage({ text: "晚上好", userId: "u1", receivedAt: nowRef.now, kind: "message" });
      const before = await core.store.read();
      await core.onSessionReset();
      const after = await core.store.read();
      assert.equal(after.care.streak, before.care.streak);
      assert.equal(after.care.lastCareDay, before.care.lastCareDay);
    } finally {
      await close();
    }
  });
});
