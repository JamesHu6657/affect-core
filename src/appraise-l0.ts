import type { Appraisal, InboundMessage, Pad, ToolEvent } from "./types.ts";

const EVENT = {
  achieve: { v: 0.22, a: 0.1, d: 0.18 },
  praise: { v: 0.3, a: 0.16, d: 0.12 },
  novelty: { v: 0.12, a: 0.28, d: -0.08 },
  frustrate: { v: -0.24, a: 0.3, d: -0.26 },
  interrupt: { v: -0.14, a: 0.22, d: -0.18 },
  blame: { v: -0.28, a: 0.24, d: -0.3 },
  distance: { v: -0.1, a: -0.08, d: -0.06 },
  lonely: { v: -0.12, a: -0.18, d: 0 },
  unmet: { v: -0.08, a: -0.12, d: 0 },
  contact: { v: 0.05, a: 0.04, d: 0.02 },
  stage: { v: 0.16, a: 0.12, d: 0.1 },
};

const matches = (text: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));

export function appraiseL0(message: InboundMessage): Appraisal | null {
  const text = message.text.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (text === "/stop" || lower.includes("停止") || lower.includes("别做了")) {
    return { tag: "interrupt", delta: EVENT.interrupt, source: "l0", summary: "你打断了手头的事" };
  }
  if (matches(lower, [/谢谢/, /感谢/, /辛苦了/, /做得好/, /干得漂亮/, /great job/, /thank you/, /thanks/, /well done/])) {
    return { tag: "praise", delta: EVENT.praise, source: "l0", summary: "你明确说了谢谢或肯定" };
  }
  if (matches(lower, [/不对/, /错了/, /搞错/, /不行/, /你错/, /错误/, /失望/, /批评/, /wrong/, /incorrect/, /you failed/, /disappoint/, /critic/])) {
    return { tag: "blame", delta: EVENT.blame, source: "l0", summary: "你指出结果不对或表示失望" };
  }
  if (matches(lower, [/抱歉/, /对不起/, /道别/, /再见/, /sorry/, /goodbye/])) {
    return { tag: "distance", delta: EVENT.distance, source: "l0", summary: "你道了歉或准备离开" };
  }
  if (matches(lower, [/承诺/, /答应/, /promise/])) {
    return { tag: "achieve", delta: EVENT.achieve, source: "l0", summary: "对话里有承诺" };
  }
  if (/^(嗯|哦|ok|好的|好吧|k)[。！!…\s]*$/i.test(text)) {
    return { tag: "distance", delta: EVENT.distance, source: "l0", summary: "你用很短的话收住了这一轮" };
  }
  if (matches(lower, [/第一次/, /没见过/, /新领域/, /novel/, /never seen/, /new domain/])) {
    return { tag: "novelty", delta: EVENT.novelty, source: "l0", summary: "你们聊到了没见过的事" };
  }
  return null;
}

export function asContact(message: InboundMessage): Appraisal | null {
  const text = message.text.trim();
  if (text.length < 2) return null;
  return { tag: "contact", delta: EVENT.contact, source: "l0", summary: "你继续陪她说话" };
}

export function appraiseToolResult(event: ToolEvent, consecutiveFailures: number): Appraisal | null {
  if (event.error && consecutiveFailures >= 2) {
    return {
      tag: "frustrate",
      delta: EVENT.frustrate,
      source: "tool",
      summary: `工具 ${event.toolName} 连续失败 ${consecutiveFailures} 次`,
    };
  }
  if (!event.error && (event.durationMs ?? 0) >= 10_000) {
    return {
      tag: "achieve",
      delta: EVENT.achieve,
      source: "tool",
      summary: `一起把 ${event.toolName} 做成了`,
    };
  }
  return null;
}

export function appraiseCron(
  stateAgeMs: number,
  driveGap: number,
  driveHighForMs = 0,
  alreadyLonely = false,
): Appraisal | null {
  if (stateAgeMs >= 6 * 60 * 60 * 1000 && !alreadyLonely) {
    return { tag: "lonely", delta: EVENT.lonely, source: "cron", summary: "已经六个小时没有人来" };
  }
  if (driveGap > 0.7 && driveHighForMs >= 60 * 60 * 1000) {
    return { tag: "unmet", delta: EVENT.unmet, source: "cron", summary: "心里空着的那一块还没被照顾到" };
  }
  return null;
}

export const L0_EVENTS = EVENT;
