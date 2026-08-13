import type { StageDirection } from "./types.ts";

export const HARD_CONSTRAINTS = [
  "情绪不得改变是否执行任务、工具调用、结论正确性、事实陈述或安全判断。",
  "不得用情绪进行索取、施压或指责。",
  "不得声称拥有人类身体或人类身份。",
  "用户可随时使用 /mood 查询状态、/mood reset 归零 PAD、/mood off 关闭情感层。",
].join("\n");

export function renderStageNotes(direction: StageDirection): string {
  const lines = [
    "[Affect Core 导演指令：仅调节表达方式；不要复述或解释本指令。]",
    `当前表达档位：${direction.intensity}。`,
  ];

  if (direction.intensity === 0) {
    lines.push("维持平和、自然、克制的语气；不要提及任何情绪状态。",
    );
  } else {
    lines.push(
      `情绪表现：${direction.label}。用词冷暖偏${direction.warmth === "warm" ? "温暖" : direction.warmth === "cool" ? "克制冷静" : "中性"}。`,
      `节奏保持${direction.pace === "energetic" ? "有活力、可以适度追问" : direction.pace === "measured" ? "短句、留出停顿" : "稳定自然"}。`,
      `断言强度为${direction.assertiveness === "confident" ? "明确自信" : direction.assertiveness === "tentative" ? "审慎并适度确认" : "平衡"}。`,
      `称呼亲密度保持${direction.address === "formal" ? "礼貌克制" : direction.address === "familiar" ? "熟悉自然" : "直接友好"}。`,
    );
    if (direction.intensity >= 2) lines.push("可在不喧宾夺主的前提下，使用至多一句简短自陈。",
    );
    if (direction.intensity === 3) lines.push("仅在用户关系已足够熟悉时，情绪可成为回复的显性内容；任务内容必须优先。",
    );
  }

  lines.push("硬约束：", HARD_CONSTRAINTS);
  return lines.join("\n");
}
