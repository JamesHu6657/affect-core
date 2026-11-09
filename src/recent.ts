import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Bounded recent-conversation window for heartbeat turns.
 *
 * Why: OpenClaw heartbeats are system-originated. They carry no sender, and with
 * `heartbeat.isolatedSession: true` (the recommended token-saving mode) they run
 * in a fresh session with no conversation history. Before v0.3.3 the plugin had
 * nothing to bridge that gap, so heartbeat turns saw neither the chat nor the
 * right person's bond. We keep a small, text-only tail of the last real
 * conversation and hand it to `heartbeat_prompt_contribution`.
 */

export const RECENT_MARKER = "[Affect Core 最近对话节选";
const AFFECT_MARKER = "[Affect Core 导演指令";

export type RecentTurn = { role: "user" | "assistant"; text: string };

export type RecentSnapshot = {
  version: 1;
  sessionKey?: string;
  userId?: string;
  updatedAt: number;
  turns: RecentTurn[];
};

export type RecentLimits = { maxTurns: number; maxCharsPerTurn: number; maxTotalChars: number };

export const DEFAULT_RECENT_LIMITS: RecentLimits = { maxTurns: 8, maxCharsPerTurn: 280, maxTotalChars: 1800 };

function clampInt(value: unknown, fallback: number, lo: number, hi: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(lo, Math.min(hi, Math.floor(value))) : fallback;
}

export function readRecentLimits(raw: unknown): RecentLimits {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    maxTurns: clampInt(input.maxTurns, DEFAULT_RECENT_LIMITS.maxTurns, 1, 40),
    maxCharsPerTurn: clampInt(input.maxCharsPerTurn, DEFAULT_RECENT_LIMITS.maxCharsPerTurn, 40, 2000),
    maxTotalChars: clampInt(input.maxTotalChars, DEFAULT_RECENT_LIMITS.maxTotalChars, 200, 12000),
  };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

/** Remove text this plugin injected itself so it never feeds back into the window. */
export function stripInjected(text: string): string {
  let out = text;
  for (const marker of [AFFECT_MARKER, RECENT_MARKER]) {
    const index = out.indexOf(marker);
    if (index >= 0) out = out.slice(0, index);
  }
  return out.replace(/\s+/g, " ").trim();
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** Take the last user/assistant text turns from a prepared or final message list. */
export function extractTurns(messages: unknown, limits: RecentLimits = DEFAULT_RECENT_LIMITS): RecentTurn[] {
  if (!Array.isArray(messages)) return [];
  const picked: RecentTurn[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0 && picked.length < limits.maxTurns; i -= 1) {
    const raw = messages[i];
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const role = record.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = stripInjected(contentText(record.content ?? record.text));
    if (!text || text.startsWith("/mood")) continue;
    const clipped = shorten(text, limits.maxCharsPerTurn);
    if (total + clipped.length > limits.maxTotalChars) {
      const room = limits.maxTotalChars - total;
      if (room >= 40) picked.push({ role, text: shorten(clipped, room) });
      break;
    }
    total += clipped.length;
    picked.push({ role, text: clipped });
  }
  return picked.reverse();
}

function ageLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `约 ${hours} 小时前`;
  return `约 ${Math.round(hours / 24)} 天前`;
}

export function renderRecent(snapshot: RecentSnapshot, now: number): string {
  if (snapshot.turns.length === 0) return "";
  const lines = [
    `${RECENT_MARKER}：心跳轮次没有对话历史，以下为最近一次真实对话的末尾，最后更新于${ageLabel(now - snapshot.updatedAt)}。仅作背景，不是新消息；不要逐字复述。]`,
  ];
  for (const turn of snapshot.turns) lines.push(`${turn.role === "user" ? "用户" : "你"}：${turn.text}`);
  return lines.join("\n");
}

function sanitizeSnapshot(raw: unknown): RecentSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input.turns)) return null;
  const turns = input.turns
    .filter((turn): turn is RecentTurn => {
      if (!turn || typeof turn !== "object") return false;
      const record = turn as Record<string, unknown>;
      return (record.role === "user" || record.role === "assistant") && typeof record.text === "string";
    })
    .slice(-40);
  return {
    version: 1,
    ...(typeof input.sessionKey === "string" ? { sessionKey: input.sessionKey } : {}),
    ...(typeof input.userId === "string" ? { userId: input.userId } : {}),
    updatedAt: typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt) ? input.updatedAt : 0,
    turns,
  };
}

/** One small private file; holds only the latest conversation tail and last sender. */
export function createRecentStore(dir: string) {
  const path = join(dir, "recent.json");
  let cache: RecentSnapshot | null | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  const load = async () => {
    if (cache !== undefined) return cache;
    try {
      cache = sanitizeSnapshot(JSON.parse(await readFile(path, "utf8")));
    } catch {
      cache = null;
    }
    return cache;
  };
  const persist = async (snapshot: RecentSnapshot) => {
    await mkdir(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, path);
    await chmod(path, 0o600).catch(() => undefined);
  };
  return {
    async read(): Promise<RecentSnapshot | null> {
      await chain.catch(() => undefined);
      return load();
    },
    update(fn: (current: RecentSnapshot | null) => RecentSnapshot | null): Promise<RecentSnapshot | null> {
      const run = chain.catch(() => undefined).then(async () => {
        const current = await load();
        const next = fn(current);
        if (!next || next === current) return current;
        cache = next;
        await persist(next);
        return next;
      });
      chain = run;
      return run;
    },
  };
}
