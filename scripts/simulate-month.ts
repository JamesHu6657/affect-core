import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAffectCore } from "../src/core.ts";
import { stageOf } from "../src/care.ts";

const START = Date.parse("2026-08-01T04:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

type DayPlan = { label: string; messages: string[]; skip?: boolean };

function plans(): DayPlan[] {
  const days: DayPlan[] = [];
  for (let i = 0; i < 30; i += 1) {
    if (i === 6) {
      days.push({ label: "第7天 断联", messages: [], skip: true });
      continue;
    }
    if (i === 12) {
      days.push({
        label: "第13天 刷屏",
        messages: Array.from({ length: 40 }, (_, n) => `在吗在吗 ${n}`),
      });
      continue;
    }
    const messages = ["我回来了", "今天工作还顺利", i % 3 === 0 ? "谢谢你" : "晚上吃了面"].filter(Boolean);
    days.push({ label: `第${i + 1}天 正常陪`, messages });
  }
  return days;
}

const nowRef = { now: START };
const dir = await mkdtemp(join(tmpdir(), "affect-sim-"));
const core = createAffectCore({
  dir,
  config: { enabled: true, maxIntensity: 2, care: { tz: "Asia/Shanghai" } },
  now: () => nowRef.now,
});

console.log("day\tplan\tstage\tfam\taff\tstreak\tmood");
try {
  const schedule = plans();
  for (let i = 0; i < schedule.length; i += 1) {
    const plan = schedule[i]!;
    nowRef.now = START + i * DAY + 8 * 60 * 60 * 1000;
    if (!plan.skip) {
      for (const text of plan.messages) {
        nowRef.now += 60_000;
        await core.onMessage({ text, userId: "6821072295", receivedAt: nowRef.now, kind: "message" });
      }
    } else {
      await core.heartbeat(nowRef.now);
    }
    const bond = await core.bonds.read("6821072295");
    const card = String(await core.command("/mood", "6821072295"));
    const mood = card.split("\n")[0] ?? "";
    console.log(
      [
        String(i + 1).padStart(2, "0"),
        plan.label,
        stageOf(bond.familiarity),
        bond.familiarity.toFixed(3),
        bond.affection.toFixed(3),
        String((await core.store.read()).care.streak),
        mood.replace(/\s+/g, " "),
      ].join("\t"),
    );
  }
  console.log("\n--- /mood on day 30 ---\n");
  console.log(await core.command("/mood", "6821072295"));
} finally {
  await core.flush();
  await rm(dir, { recursive: true, force: true });
}
