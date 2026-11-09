import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createAffectCore } from "../src/core.ts";
import { extractTurns, RECENT_MARKER, stripInjected } from "../src/recent.ts";
import plugin from "../src/index.ts";

const T0 = Date.parse("2026-11-08T12:00:00.000Z");

async function makeCore(nowRef: { now: number }, extra: Record<string, unknown> = {}, dir?: string) {
  const root = dir ?? (await mkdtemp(join(tmpdir(), "affect-hb-")));
  const core = createAffectCore({
    dir: root,
    config: { enabled: true, care: { tz: "Asia/Shanghai" }, ...extra },
    now: () => nowRef.now,
  });
  return { core, dir: root };
}

const chat = [
  { role: "user", content: "今晚想把热工第三章刷完" },
  { role: "assistant", content: [{ type: "text", text: "好，先做真题 2019 第 4 题。" }] },
  { role: "toolResult", content: "SECRET_TOOL_OUTPUT" },
  { role: "user", content: [{ type: "text", text: "做完了，熵那步错了" }, { type: "image", data: "x" }] },
];

describe("recent window", () => {
  it("keeps only user/assistant text, in order, bounded", () => {
    const turns = extractTurns(chat, { maxTurns: 8, maxCharsPerTurn: 280, maxTotalChars: 1800 });
    assert.deepEqual(turns.map((t) => t.role), ["user", "assistant", "user"]);
    assert.ok(!JSON.stringify(turns).includes("SECRET_TOOL_OUTPUT"));
    const many = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "长".repeat(500) + i }));
    const bounded = extractTurns(many, { maxTurns: 6, maxCharsPerTurn: 100, maxTotalChars: 350 });
    assert.ok(bounded.length <= 6);
    assert.ok(bounded.every((t) => t.text.length <= 100));
    assert.ok(bounded.reduce((n, t) => n + t.text.length, 0) <= 350);
    assert.match(bounded[bounded.length - 1]!.text, /…$/);
  });

  it("strips text the plugin injected itself", () => {
    const text = "你好\n\n[Affect Core 导演指令：仅调节表达方式]\n当前养成阶段：陌生";
    assert.equal(stripInjected(text), "你好");
    assert.equal(stripInjected(`${RECENT_MARKER}：...]\n用户：hi`), "");
  });
});

describe("heartbeat context", () => {
  it("heartbeat sees the last conversation and the sender's bond after a restart", async () => {
    const nowRef = { now: T0 };
    const first = await makeCore(nowRef);
    try {
      for (let day = 0; day < 12; day += 1) {
        nowRef.now = T0 + day * 86400000;
        await first.core.onMessage({ text: "早上好，今天继续刷题", userId: "owner", sessionKey: "agent:main:main", receivedAt: nowRef.now, kind: "message" });
      }
      await first.core.recordConversation(chat, { sessionKey: "agent:main:main" });
      await first.core.flush();
      const ownerStage = (await first.core.beforeAgentReply("owner")).appendContext ?? "";

      // Gateway restart: new core, empty process memory, same state dir.
      nowRef.now += 30 * 60 * 1000;
      const second = await makeCore(nowRef, {}, first.dir);
      const hb = await second.core.heartbeatContext("agent:main:heartbeat:isolated-1");
      const text = hb.appendContext ?? "";
      assert.match(text, /最近对话节选/);
      assert.match(text, /用户：今晚想把热工第三章刷完/);
      assert.match(text, /你：好，先做真题 2019 第 4 题。/);
      assert.match(text, /30 分钟前/);
      const stageLine = (s: string) => s.split("\n").find((l) => l.startsWith("当前养成阶段"));
      assert.equal(stageLine(text), stageLine(ownerStage));
      assert.match(String(stageLine(ownerStage)), /连续照顾 12 天/);
      const raw = await readFile(join(first.dir, "recent.json"), "utf8");
      assert.ok(!raw.includes("SECRET_TOOL_OUTPUT"));
      assert.equal((await stat(join(first.dir, "recent.json"))).mode & 0o777, 0o600);
    } finally {
      await rm(first.dir, { recursive: true, force: true });
    }
  });

  it("does not repeat history when the heartbeat already runs in that session", async () => {
    const nowRef = { now: T0 };
    const { core, dir } = await makeCore(nowRef);
    try {
      await core.recordConversation(chat, { sessionKey: "agent:main:main", userId: "owner" });
      const hb = await core.heartbeatContext("agent:main:main");
      assert.doesNotMatch(hb.appendContext ?? "", /最近对话节选/);
      assert.match(hb.appendContext ?? "", /导演指令/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops stale tails and honours enabled=false", async () => {
    const nowRef = { now: T0 };
    const stale = await makeCore(nowRef, { heartbeatContext: { maxAgeHours: 2 } });
    const off = await makeCore(nowRef, { heartbeatContext: { enabled: false } });
    try {
      await stale.core.recordConversation(chat, { sessionKey: "s", userId: "owner" });
      await off.core.recordConversation(chat, { sessionKey: "s", userId: "owner" });
      nowRef.now += 3 * 3600 * 1000;
      assert.doesNotMatch((await stale.core.heartbeatContext("hb")).appendContext ?? "", /最近对话节选/);
      assert.doesNotMatch((await off.core.heartbeatContext("hb")).appendContext ?? "", /最近对话节选/);
    } finally {
      await rm(stale.dir, { recursive: true, force: true });
      await rm(off.dir, { recursive: true, force: true });
    }
  });

  it("falls back to ownerIds when nobody has spoken since install", async () => {
    const nowRef = { now: T0 };
    const { core, dir } = await makeCore(nowRef, { ownerIds: ["owner"] });
    try {
      for (let day = 0; day < 12; day += 1) {
        nowRef.now = T0 + day * 86400000;
        await core.onMessage({ text: "早上好，今天继续刷题", userId: "owner", receivedAt: nowRef.now, kind: "message" });
      }
      await core.flush();
      const fresh = createAffectCore({ dir, config: { enabled: true, ownerIds: ["owner"], care: { tz: "Asia/Shanghai" } }, now: () => nowRef.now });
      await rm(join(dir, "recent.json"), { force: true });
      const line = ((await fresh.heartbeatContext("hb")).appendContext ?? "").split("\n").find((l) => l.startsWith("当前养成阶段"));
      assert.match(String(line), /连续照顾 12 天/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("plugin wiring", () => {
  it("registers heartbeat_prompt_contribution and does not inject twice on a heartbeat run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "affect-wire-"));
    const handlers = new Map<string, (...args: unknown[]) => Promise<any>>();
    const api = {
      pluginConfig: { enabled: true, stateDir: dir, care: { tz: "Asia/Shanghai" } },
      on: (name: string, fn: (...args: unknown[]) => Promise<any>) => handlers.set(name, fn),
      lifecycle: { registerRuntimeLifecycle: (entry: { dispose: () => Promise<void> }) => disposers.push(entry.dispose) },
    };
    const disposers: Array<() => Promise<void>> = [];
    try {
      (plugin as unknown as { register: (api: unknown) => void }).register(api);
      assert.ok(handlers.has("heartbeat_prompt_contribution"));
      assert.ok(handlers.has("agent_end"));
      await handlers.get("message_received")!({ content: "在吗" }, { senderId: "owner", sessionKey: "agent:main:main" });
      await handlers.get("before_prompt_build")!(
        { prompt: "x", messages: chat.slice(0, 2), currentUserMessage: "做完了，熵那步错了" },
        { trigger: "user", sessionKey: "agent:main:main", senderId: "owner" },
      );
      const hbCtx = { trigger: "heartbeat", sessionKey: "agent:main:heartbeat", runId: "run-1" };
      const contribution = await handlers.get("heartbeat_prompt_contribution")!({ sessionKey: "agent:main:heartbeat", heartbeatName: "heartbeat" }, hbCtx);
      assert.match(contribution.appendContext, /用户：做完了，熵那步错了/);
      const build = await handlers.get("before_prompt_build")!({ prompt: "HEARTBEAT", messages: [] }, hbCtx);
      assert.equal(build.appendContext, undefined);
      assert.ok(build.appendSystemContext);
      // Older hosts without the contribution hook still get context via before_prompt_build.
      const legacy = await handlers.get("before_prompt_build")!({ prompt: "HEARTBEAT", messages: [] }, { ...hbCtx, runId: "run-2" });
      assert.match(legacy.appendContext, /最近对话节选/);
      // A heartbeat run must not overwrite the stored tail.
      await handlers.get("agent_end")!({ messages: [{ role: "user", content: "HEARTBEAT_OK" }] }, hbCtx);
      const raw = await readFile(join(dir, "recent.json"), "utf8");
      assert.ok(!raw.includes("HEARTBEAT_OK"));
    } finally {
      for (const dispose of disposers) await dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
