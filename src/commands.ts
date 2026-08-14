import { readCareConfig, remainingCare } from "./care.ts";
import { derive, renderStatus } from "./derive.ts";
import { appendJournal, resetPadKeepMood, summarize } from "./dynamics.ts";
import type { AffectState, Bond, Personality, PluginConfig } from "./types.ts";

export function handleMoodCommand(
  input: string,
  state: AffectState,
  bond: Bond,
  personality: Personality,
  now = Date.now(),
  config: PluginConfig = {},
  timeZone = "Asia/Shanghai",
): { state: AffectState; text: string } | null {
  const command = input.trim().toLowerCase();
  if (!command.startsWith("/mood")) return null;
  if (command === "/mood off") {
    return { state: { ...state, enabled: false, updatedAt: now }, text: "情感表达层已关闭；养成账本还在，任务能力不受影响。" };
  }
  if (command === "/mood on") {
    return { state: { ...state, enabled: true, updatedAt: now }, text: "情感表达层已开启。" };
  }
  if (command === "/mood reset") {
    return {
      state: resetPadKeepMood(appendJournal(state, summarize(state), now), personality, now),
      text: "脸上的神色已归零；连陪、阶段和亲密度都还在。",
    };
  }
  if (command === "/mood") {
    const direction = derive(state, bond, personality, now);
    const remaining = remainingCare(bond.care ?? state.care, now, timeZone, readCareConfig(config));
    return { state, text: renderStatus(direction, remaining) };
  }
  return { state, text: "用法：/mood、/mood reset、/mood off、/mood on" };
}
