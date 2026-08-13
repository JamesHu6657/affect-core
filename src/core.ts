import { createL1Appraiser, mapL1ToPad, needsL1 } from "./appraise-l1.ts";
import { appraiseCron, appraiseL0, appraiseToolResult } from "./appraise-l0.ts";
import { createBondStore, type BondStore } from "./bonds.ts";
import { tokenBucket, type TokenBucket } from "./budget.ts";
import { inQuietHours, readQuietHours, resolveTimeZone } from "./clock.ts";
import { handleMoodCommand } from "./commands.ts";
import { derive } from "./derive.ts";
import { appendJournal, applySatisfiedDrives, impulse, resetPadKeepMood, summarize, tick } from "./dynamics.ts";
import { renderStageNotes } from "./express.ts";
import { personalityFrom } from "./personality.ts";
import { createStore, type AffectStore } from "./store.ts";
import type {
  AffectConfig,
  AffectMessage,
  AffectState,
  Appraisal,
  Drives,
  L1ModelAdapter,
  PluginLogger,
  ToolEvent,
} from "./types.ts";

export interface AffectCore {
  onMessage(message: AffectMessage): Promise<{ reply?: string } | undefined>;
  onToolResult(event: ToolEvent): Promise<void>;
  beforeAgentReply(userId?: string): Promise<{ systemAppend?: string }>;
  heartbeat(now?: number): Promise<{ proactive?: { reason: string; summary: string } }>;
  command(input: string, userId?: string): Promise<string | null>;
  onSessionReset(): Promise<void>;
  flush(): Promise<void>;
  store: AffectStore;
  bonds: BondStore;
}

export interface AffectCoreOptions {
  dir: string;
  config?: AffectConfig;
  logger?: PluginLogger;
  l1?: L1ModelAdapter;
  now?: () => number;
}

const PROACTIVE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PROACTIVE_SILENCE_MS = 2 * 60 * 60 * 1000;

export function createAffectCore(options: AffectCoreOptions): AffectCore {
  const config = options.config ?? {};
  const personality = personalityFrom(config);
  const store = createStore(options.dir, personality);
  const bonds = createBondStore(options.dir);
  const clock = options.now ?? Date.now;
  const tz = resolveTimeZone(config.proactive?.tz);
  const quietHours = readQuietHours(config.proactive?.quietHours);
  const proactiveEnabled = config.proactive?.enabled === true;
  const maxRate = typeof config.l1?.maxRatePerHour === "number" ? config.l1.maxRatePerHour : 12;
  const budget: TokenBucket = tokenBucket(maxRate, clock);
  const l1 = options.l1 ? createL1Appraiser(options.l1) : null;
  const globallyEnabled = config.enabled === true;
  const failures = new Map<string, number>();

  const step = (state: AffectState, now: number) => tick(state, personality, now, { tz });

  const applyImpulse = async (
    appraisal: Appraisal,
    extras: { lastInteraction?: boolean; lastLonely?: boolean; satisfy?: readonly (keyof Drives)[] } = {},
  ) => {
    const now = clock();
    await store.mutate((state) => {
      let next = impulse(
        step(state, now),
        appraisal.delta,
        appraisal.tag,
        now,
        appraisal.source,
        appraisal.summary,
        personality.moodCoupling,
      );
      if (extras.satisfy) next = applySatisfiedDrives(next, [appraisal.tag], extras.satisfy);
      if (extras.lastInteraction) next = { ...next, lastInteractionAt: now };
      if (extras.lastLonely) next = { ...next, lastLonelyAt: now };
      return next;
    });
  };

  return {
    store,
    bonds,
    async onMessage(message) {
      try {
        if (!globallyEnabled) return;
        const command = await this.command(message.text, message.userId);
        if (command !== null) return { reply: command };
        if (!(await store.read()).enabled) return;

        const now = clock();
        const l0 = appraiseL0(message);
        await store.mutate((state) => {
          let next = step(state, now);
          if (l0) {
            next = impulse(next, l0.delta, l0.tag, now, l0.source, l0.summary, personality.moodCoupling);
          }
          next = applySatisfiedDrives(next, l0 ? [l0.tag] : [], ["contact"]);
          return { ...next, lastInteractionAt: now };
        });
        if (message.userId) await bonds.update(message.userId, l0?.bond ?? {});

        if (!l1 || config.l1?.enabled !== true || !needsL1(message, Boolean(l0))) return;
        const signal = l0?.tag ?? "ambiguous";
        if (!l1.cached(message, signal) && !budget.take(clock())) return;
        const bond = await bonds.read(message.userId ?? "anonymous");
        const assessment = await l1(message, bond, signal, typeof config.l1?.timeoutMs === "number" ? config.l1.timeoutMs : 1500);
        if (!assessment) return;
        const refinedAt = clock();
        await store.mutate((state) =>
          impulse(step(state, refinedAt), mapL1ToPad(assessment), assessment.tag, refinedAt, "l1", assessment.summary, personality.moodCoupling),
        );
        if (message.userId && assessment.relevanceToBond > 0.2) {
          const trust = assessment.desirability >= 0 ? assessment.desirability * 0.03 : assessment.desirability * 0.06;
          await bonds.update(message.userId, { trust, familiarity: 0.01 * assessment.relevanceToBond });
        }
      } catch (error) {
        options.logger?.warn?.("affect: message appraisal skipped", error);
      }
    },
    async onToolResult(event) {
      try {
        if (!globallyEnabled || !(await store.read()).enabled) return;
        const key = event.toolName;
        const count = event.error ? (failures.get(key) ?? 0) + 1 : 0;
        failures.set(key, count);
        const appraisal = appraiseToolResult(event, count);
        const now = clock();
        if (appraisal) {
          await applyImpulse(appraisal, {
            lastInteraction: true,
            satisfy: appraisal.tag === "achieve" ? ["order"] : [],
          });
        } else {
          await store.mutate((state) => ({ ...step(state, now), lastInteractionAt: now }));
        }
      } catch (error) {
        options.logger?.warn?.("affect: tool appraisal skipped", error);
      }
    },
    async beforeAgentReply(userId) {
      try {
        if (!globallyEnabled) return {};
        const now = clock();
        const state = await store.mutate((current) => step(current, now));
        if (!state.enabled) return {};
        const bond = await bonds.read(userId ?? "anonymous");
        return { systemAppend: renderStageNotes(derive(state, bond, personality)) };
      } catch (error) {
        options.logger?.warn?.("affect: stage-note injection skipped", error);
        return {};
      }
    },
    async heartbeat(now = clock()) {
      try {
        if (!globallyEnabled || !(await store.read()).enabled) return {};
        let silenceAgeMs = 0;
        let driveHighForMs = 0;
        const snapshot = await store.mutate((state) => {
          silenceAgeMs = Math.max(0, now - (state.lastInteractionAt || state.updatedAt));
          const next = step(state, now);
          driveHighForMs = next.driveHighSince !== null ? Math.max(0, now - next.driveHighSince) : 0;
          return next;
        });
        await bonds.fadeAll(now);
        const maxDrive = Math.max(...Object.values(snapshot.drives));
        const alreadyLonely = snapshot.lastLonelyAt > snapshot.lastInteractionAt;
        const appraisal = appraiseCron(silenceAgeMs, maxDrive, driveHighForMs, alreadyLonely);
        if (appraisal) {
          await applyImpulse(appraisal, { lastLonely: appraisal.tag === "lonely" });
          if (appraisal.tag === "unmet") {
            await store.mutate((state) => ({ ...state, driveHighSince: now }));
          }
        }

        let proactive: { reason: string; summary: string } | undefined;
        if (
          proactiveEnabled &&
          !inQuietHours(now, quietHours, tz) &&
          now - snapshot.lastProactiveAt >= PROACTIVE_MIN_INTERVAL_MS &&
          silenceAgeMs >= PROACTIVE_SILENCE_MS &&
          (snapshot.drives.contact >= 0.55 || snapshot.drives.recognition >= 0.55 || silenceAgeMs >= 6 * 60 * 60 * 1000)
        ) {
          proactive = {
            reason: silenceAgeMs >= 6 * 60 * 60 * 1000 ? "lonely" : "drive",
            summary: "quiet contact window; a low-intensity check-in would match current drives",
          };
          await store.mutate((state) => ({ ...state, lastProactiveAt: now }));
        }

        await store.flush();
        await bonds.flush();
        return proactive ? { proactive } : {};
      } catch (error) {
        options.logger?.warn?.("affect: heartbeat skipped", error);
        return {};
      }
    },
    async command(input, userId) {
      try {
        if (!globallyEnabled) {
          return input.trim().toLowerCase().startsWith("/mood") ? "情感层在配置中关闭。" : null;
        }
        let output: string | null = null;
        const now = clock();
        const bond = await bonds.read(userId ?? "anonymous");
        await store.mutate((state) => {
          const result = handleMoodCommand(input, step(state, now), bond, personality, now);
          if (!result) return state;
          output = result.text;
          return result.state;
        });
        return output;
      } catch (error) {
        options.logger?.warn?.("affect: command skipped", error);
        return null;
      }
    },
    async onSessionReset() {
      try {
        if (!globallyEnabled) return;
        const now = clock();
        await store.mutate((state) => {
          const ticked = step(state, now);
          return resetPadKeepMood(appendJournal(ticked, summarize(ticked), now), personality, now);
        });
      } catch (error) {
        options.logger?.warn?.("affect: session reset skipped", error);
      }
    },
    async flush() {
      await Promise.all([store.flush(), bonds.flush()]);
    },
  };
}
