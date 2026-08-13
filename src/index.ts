import { homedir } from "node:os";
import { join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createAffectCore } from "./core.ts";
import type { AffectConfig, AffectMessage, OpenClawAdapter, PluginLogger, ToolEvent } from "./types.ts";

const HEARTBEAT_MS = 5 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readConfig(api: OpenClawAdapter): AffectConfig {
  if (api.pluginConfig && typeof api.pluginConfig === "object") return api.pluginConfig as AffectConfig;
  return api.config?.affect ?? { enabled: false };
}

function readStateDir(api: OpenClawAdapter, config: AffectConfig): string {
  const explicit = (config as { stateDir?: unknown }).stateDir;
  if (typeof explicit === "string" && explicit.trim() !== "") return explicit.trim();
  if (typeof api.workspacePath === "function") return api.workspacePath("affect");
  const workspace = api.config?.agents?.defaults?.workspace;
  if (typeof workspace === "string" && workspace.trim() !== "") return join(workspace, "affect");
  const fromEnv = process.env.OPENCLAW_WORKSPACE;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return join(fromEnv.trim(), "affect");
  // Never hardcode an absolute install path: a non-root install would silently
  // write state outside its own workspace.
  return join(homedir(), ".openclaw", "workspace", "affect");
}

function adaptLogger(api: OpenClawAdapter): PluginLogger | undefined {
  const raw = api.logger ?? api.log;
  if (!raw) return undefined;
  const line = (write: ((message: string) => void) | undefined, message: string, details?: unknown) => {
    if (!write) return;
    write(details === undefined ? message : `${message} ${details instanceof Error ? details.stack ?? details.message : String(details)}`);
  };
  return {
    debug: (message, details) => line(raw.debug, message, details),
    warn: (message, details) => line(raw.warn, message, details),
    error: (message, details) => line(raw.error, message, details),
  };
}

function senderId(raw: Record<string, unknown>): string | undefined {
  for (const key of ["senderId", "from", "userId"] as const) {
    const value = raw[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function messageText(raw: Record<string, unknown>): string {
  if (typeof raw.content === "string") return raw.content;
  if (typeof raw.text === "string") return raw.text;
  return "";
}

/** SDK names stay in this file so a signature mismatch cannot leak into the kernel. */
function register(apiUnknown: unknown): void {
  const api = apiUnknown as OpenClawAdapter;
  const config = readConfig(api);
  const dir = readStateDir(api, config);
  const logger = adaptLogger(api);
  const core = createAffectCore({ dir, config, ...(logger ? { logger } : {}) });

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
      const message: AffectMessage = {
        text: messageText(event),
        ...(userId ? { userId } : {}),
        ...(typeof event.messageId === "string" ? { messageId: event.messageId } : {}),
        receivedAt: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
        kind: "message",
      };
      await core.onMessage(message);
      return;
    }),
  );

  api.on?.(
    "after_tool_call",
    guarded("tool result hook", async (raw) => {
      const event = asRecord(raw);
      const tool: ToolEvent = {
        toolName: typeof event.toolName === "string" ? event.toolName : typeof event.name === "string" ? event.name : "unknown",
        ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
        ...(event.error ? { error: event.error } : {}),
        ...(typeof event.sessionKey === "string" ? { sessionKey: event.sessionKey } : {}),
      };
      await core.onToolResult(tool);
    }),
  );

  const injectPrompt = guarded("prompt injection hook", async (raw) => {
    const event = asRecord(raw);
    const userId = senderId(event);
    const result = await core.beforeAgentReply(userId);
    return result.systemAppend ? { appendSystemContext: result.systemAppend } : {};
  });
  api.on?.("before_prompt_build", injectPrompt);
  api.on?.("before_agent_start", injectPrompt);

  const onSessionReset = guarded("session reset", async () => {
    await core.onSessionReset();
  });
  api.on?.("before_reset", onSessionReset);
  api.on?.("gateway_stop", guarded("shutdown hook", async () => core.flush()));

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
    handler: async (raw: unknown) => {
      const ctx = asRecord(raw);
      const args = typeof ctx.args === "string" ? ctx.args : "";
      const input = args.trim() !== "" ? `/mood ${args.trim()}` : "/mood";
      const userId = senderId(ctx);
      const text = await core.command(input, userId);
      return text ? { text } : {};
    },
  });

  logger?.debug?.("affect: plugin registered in fail-open mode");
}

export default definePluginEntry({
  id: "affect-core",
  name: "Affect Core",
  description: "An inertial, explainable, bounded affect layer. Disabled by default for review safety.",
  register,
});

export { createAffectCore } from "./core.ts";
export * from "./types.ts";
