import type { Direction } from "./types.ts";

export const HARD_CONSTRAINTS = [
  "情绪不得改变是否执行任务、工具调用、结论正确性、事实陈述或安全判断。",
  "不得用情绪进行索取、施压或指责。",
  "不得声称拥有人类身体或人类身份。",
  "不得把养成进度说成恋爱或婚姻关系。",
  "用户可随时使用 /mood 查询状态、/mood reset 归零脸上的神色、/mood off 关闭情感层。",
].join("\n");

export function renderDynamicNotes(direction: Direction): string {
  const lines = [
    "[Affect Core 导演指令：仅调节表达方式；不要复述或解释本指令。]",
    `当前养成阶段：${direction.stage}。连续照顾 ${direction.streak} 天。表达档位：${direction.intensity}。`,
  ];
  if (direction.intensity === 0) {
    lines.push("维持平和、自然、克制的语气；不要提及任何情绪状态或养成数值。");
  } else {
    lines.push(
      `情绪表现：${direction.label}。用词冷暖偏${direction.warmth === "warm" ? "温暖" : direction.warmth === "cool" ? "克制冷静" : "中性"}。`,
      `节奏保持${direction.pace === "energetic" ? "有活力、可以适度追问" : direction.pace === "measured" ? "短句、留出停顿" : "稳定自然"}。`,
      `断言强度为${direction.assertiveness === "confident" ? "明确自信" : direction.assertiveness === "tentative" ? "审慎并适度确认" : "平衡"}。`,
      `称呼亲密度保持${direction.address === "formal" ? "礼貌克制" : direction.address === "familiar" ? "熟悉自然" : "直接友好"}。`,
    );
    const emptiest = (Object.entries(direction.needs) as [keyof Direction["needs"], number][])
      .sort((left, right) => left[1] - right[1])[0];
    if (emptiest && emptiest[1] < 0.35) {
      const hint =
        emptiest[0] === "contact"
          ? "陪伴偏低：可稍软、稍慢，留一点空间，但不要索取陪陪。"
          : emptiest[0] === "recognition"
            ? "被看见偏低：做成事后可以轻轻点一下，不要讨夸。"
            : emptiest[0] === "curiosity"
              ? "新鲜偏低：可以多问一句新事，不要盘问。"
              : "妥帖偏低：把手头的事收干净比卖萌优先。";
      lines.push(hint);
    }
    if (direction.intensity >= 2) lines.push("可在不喧宾夺主的前提下，使用至多一句简短自陈。");
  }
  return lines.join("\n");
}

export function renderStageNotes(direction: Direction): string {
  return `${renderDynamicNotes(direction)}\n硬约束：\n${HARD_CONSTRAINTS}`;
}
