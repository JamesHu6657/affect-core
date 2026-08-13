import { appendJournal, resetPadKeepMood, summarize } from "./dynamics.ts";
import { derive } from "./derive.ts";
import type { AffectState, Bond, Personality } from "./types.ts";

export interface CommandResult {
  state: AffectState;
  text: string;
}

export function handleMoodCommand(
  input: string,
  state: AffectState,
  bond: Bond,
  personality: Personality,
  now = Date.now(),
): CommandResult | null {
  const command = input.trim().toLowerCase();
  if (!command.startsWith("/mood")) return null;

  if (command === "/mood off") {
    return { state: { ...state, enabled: false, updatedAt: now }, text: "情感表达层已关闭；任务能力不受影响。" };
  }
  if (command === "/mood on") {
    return { state: { ...state, enabled: true, updatedAt: now }, text: "情感表达层已开启。" };
  }
  if (command === "/mood reset") {
    return {
      state: resetPadKeepMood(appendJournal(state, summarize(state), now), personality, now),
      text: "已归零当前情绪冲激；心境会按自身时间尺度保留并自然回归。",
    };
  }
  if (command === "/mood") {
    const direction = derive(state, bond, personality);
    return {
      state,
      text: `当前表达状态：${direction.label}（档位 ${direction.intensity}）。最近依据：${direction.recentTag ?? "无显著事件"}。`,
    };
  }
  return { state, text: "用法：/mood、/mood reset、/mood off、/mood on" };
}
