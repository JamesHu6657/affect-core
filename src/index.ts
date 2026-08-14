import { join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createL1Appraiser } from "./appraise-l1.ts";
import { createAffectCore } from "./core.ts";
import type { PluginConfig } from "./types.ts";

const HEARTBEAT_MS = 5 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readConfig(api: { pluginConfig?: PluginConfig; config?: { affect?: PluginConfig } }): PluginConfig {
  if (api.pluginConfig && typeof api.pluginConfig === "object") return api.pluginConfig;
  return api.config?.affect ?? { enabled: false };
}

function readStateDir(api: { workspacePath?: (name: string) => string; config?: { agents?: { defaults?: { workspace?: string } } } }, config: PluginConfig): string {
  const explicit = config.stateDir;
  if (typeof explicit === "string" && explicit.trim() !== "") return explicit.trim();
  if (typeof api.workspacePath === "function") return api.workspacePath("affect");
  const workspace = api.config?.agents?.defaults?.workspace;
  if (typeof workspace === "string" && workspace.trim() !== "") return join(workspace, "affect");
  return "/root/.openclaw/workspace/affect";
}

function adaptLogger(api: { logger?: { debug?: Function; warn?: Function; error?: Function }; log?: { debug?: Function; warn?: Function; error?: Function } }) {
  const raw = api.logger ?? api.log;
  if (!raw) return undefined;
  const line = (write: Function | undefined, message: string, details?: unknown) => {
    if (!write) return;
    write(details === undefined ? message : `${message} ${details instanceof Error ? details.stack ?? details.message : String(details)}`);
  };
  return {
    debug: (message: string, details?: unknown) => line(raw.debug, message, details),
    warn: (message: string, details?: unknown) => line(raw.warn, message, details),
    error: (message: string, details?: unknown) => line(raw.error, message, details),
  };
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["id", "userId", "senderId", "from"]) {
      const inner = asId(record[key]);
      if (inner) return inner;
    }
  }
  return undefined;
}

function senderId(raw: Record<string, unknown>): string | undefined {
  for (const key of ["senderId", "from", "userId", "sender", "author"]) {
    const value = asId(raw[key]);
    if (value) return value;
  }
  return undefined;
}

function messageText(raw: Record<string, unknown>): string {
  if (typeof raw.content === "string") return raw.content;
  if (typeof raw.text === "string") return raw.text;
  return "";
}

function heuristicL1() {
  return {
    async appraise({ message }: { message: { text: string } }) {
      const text = String(message?.text ?? "");
      const hit = (pattern: RegExp) => pattern.test(text);
      if (hit(/失望|critic|disappoint/i)) {
        return { tag: "blame", summary: "你说了失望或批评", desirability: -0.55, expectedness: 0.35, controllability: 0.4, normViolation: 0.2, relevanceToBond: 0.55, agency: "self" as const };
      }
      if (hit(/承诺|promise/i)) {
        return { tag: "achieve", summary: "对话里有承诺", desirability: 0.35, expectedness: 0.45, controllability: 0.55, normViolation: 0, relevanceToBond: 0.45, agency: "self" as const };
      }
      if (hit(/道别|goodbye/i)) {
        return { tag: "distance", summary: "你准备结束对话", desirability: -0.2, expectedness: 0.5, controllability: 0.35, normViolation: 0, relevanceToBond: 0.4, agency: "other" as const };
      }
      if (hit(/抱歉|sorry/i)) {
        return { tag: "distance", summary: "你说了抱歉", desirability: -0.15, expectedness: 0.4, controllability: 0.45, normViolation: 0.05, relevanceToBond: 0.35, agency: "other" as const };
      }
      if (hit(/信任|关系|trust/i)) {
        return { tag: "praise", summary: "你们谈到信任或关系", desirability: 0.28, expectedness: 0.4, controllability: 0.4, normViolation: 0, relevanceToBond: 0.6, agency: "none" as const };
      }
      return null;
    },
  };
}

function register(apiUnknown: unknown) {
  const api = apiUnknown as {
    pluginConfig?: PluginConfig;
    config?: { affect?: PluginConfig; agents?: { defaults?: { workspace?: string } } };
    workspacePath?: (name: string) => string;
    logger?: { debug?: Function; warn?: Function; error?: Function };
    log?: { debug?: Function; warn?: Function; error?: Function };
    on?: (name: string, handler: (...args: unknown[]) => unknown) => void;
    lifecycle?: { registerRuntimeLifecycle?: (entry: { id: string; dispose: () => Promise<void> }) => void };
    registerCommand?: (command: { name: string; description: string; acceptsArgs: boolean; handler: (raw: unknown) => Promise<unknown> }) => void;
  };
  const config = readConfig(api);
  const dir = readStateDir(api, config);
  const logger = adaptLogger(api);
  if (config.l1?.enabled === true) {
    logger?.warn?.("affect: L1 is experimental (keyword stub, not an LLM) and is off unless you set l1.enabled");
  }
  const l1 = config.l1?.enabled === true ? createL1Appraiser(heuristicL1()) : null;
  const core = createAffectCore({ dir, config, ...(l1 ? { l1 } : {}), ...(logger ? { logger } : {}) });
  const guarded = (label: string, fn: (...args: unknown[]) => Promise<unknown>) => async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      logger?.warn?.(`affect: ${label} skipped`, error);
      return {};
    }
  };
  api.on?.(
    "message_received",
    guarded("message hook", async (raw) => {
      const event = asRecord(raw);
      const userId = senderId(event);
      const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey : undefined;
      await core.onMessage({
        text: messageText(event),
        ...(userId ? { userId } : {}),
        ...(sessionKey ? { sessionKey } : {}),
        ...(typeof event.messageId === "string" ? { messageId: event.messageId } : {}),
        receivedAt: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
        kind: "message",
      });
    }),
  );
  api.on?.(
    "after_tool_call",
    guarded("tool result hook", async (raw, ctxRaw) => {
      const event = asRecord(raw);
      const ctx = asRecord(ctxRaw);
      const userId =
        senderId(event) ??
        asId(ctx.senderId) ??
        asId((ctx.requester as Record<string, unknown> | undefined)?.senderId) ??
        asId((ctx.channelContext as Record<string, unknown> | undefined)?.sender);
      await core.onToolResult({
        toolName: typeof event.toolName === "string" ? event.toolName : typeof event.name === "string" ? event.name : "unknown",
        ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
        ...(event.error ? { error: event.error } : {}),
        ...(typeof event.sessionKey === "string" ? { sessionKey: event.sessionKey } : {}),
        ...(userId ? { userId } : {}),
      });
    }),
  );
  const injectPrompt = guarded("prompt injection hook", async (raw, ctxRaw) => {
    const event = asRecord(raw);
    const ctx = asRecord(ctxRaw);
    const userId =
      senderId(event) ??
      asId(ctx.senderId) ??
      asId((ctx.channelContext as Record<string, unknown> | undefined)?.sender) ??
      asId((ctx.requester as Record<string, unknown> | undefined)?.senderId);
    const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey : typeof ctx.sessionKey === "string" ? ctx.sessionKey : undefined;
    const result = await core.beforeAgentReply(userId, sessionKey);
    return result.systemAppend ? { appendSystemContext: result.systemAppend } : {};
  });
  api.on?.("before_prompt_build", injectPrompt);
  api.on?.("before_agent_start", injectPrompt);
  api.on?.(
    "before_reset",
    guarded("session reset", async () => {
      await core.onSessionReset();
    }),
  );
  api.on?.(
    "gateway_stop",
    guarded("shutdown hook", async () => core.flush()),
  );
  const timer = setInterval(() => {
    void core.heartbeat().then(() => core.flush()).catch((error) => {
      logger?.warn?.("affect: heartbeat skipped", error);
    });
  }, HEARTBEAT_MS);
  timer.unref?.();
  api.lifecycle?.registerRuntimeLifecycle?.({
    id: "affect-core-heartbeat",
    dispose: async () => {
      clearInterval(timer);
      await core.flush();
    },
  });
  api.registerCommand?.({
    name: "mood",
    description: "Query or control the affect layer (/mood, /mood reset, /mood off, /mood on).",
    acceptsArgs: true,
    handler: async (raw) => {
      const ctx = asRecord(raw);
      const args = typeof ctx.args === "string" ? ctx.args : "";
      const input = args.trim() !== "" ? `/mood ${args.trim()}` : "/mood";
      const text = await core.command(input, senderId(ctx));
      return text ? { text } : {};
    },
  });
  logger?.debug?.("affect: pet-cultivation plugin registered");
}

export default definePluginEntry({
  id: "affect-core",
  name: "Affect Core",
  description: "Pet-like sustainable cultivation plus a bounded affect layer. Local review build.",
  register,
});

export { createAffectCore } from "./core.ts";
export * from "./types.ts";
