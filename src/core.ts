import { appraiseCron, appraiseL0, appraiseToolResult, asContact } from "./appraise-l0.ts";
import { createL1Appraiser, mapL1ToPad, needsL1, type L1Adapter } from "./appraise-l1.ts";
import { createBondStore } from "./bonds.ts";
import { tokenBucket } from "./budget.ts";
import {
  applyCareLedger,
  applyNeglectLedger,
  hydrateStage,
  noteStage,
  readCareConfig,
} from "./care.ts";
import { civilDate, inQuietHours, readQuietHours, resolveTimeZone } from "./clock.ts";
import { handleMoodCommand } from "./commands.ts";
import { derive } from "./derive.ts";
import { L0_EVENTS } from "./appraise-l0.ts";
import { appendJournal, applySatisfiedDrives, impulse, resetPadKeepMood, summarize, tick } from "./dynamics.ts";
import { renderStageNotes } from "./express.ts";
import { personalityFrom } from "./personality.ts";
import { createStore } from "./store.ts";
import type { AffectState, InboundMessage, PluginConfig, ToolEvent } from "./types.ts";

const PROACTIVE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PROACTIVE_SILENCE_MS = 2 * 60 * 60 * 1000;

export type CoreOptions = {
  dir: string;
  config?: PluginConfig;
  l1?: ReturnType<typeof createL1Appraiser> | L1Adapter;
  now?: () => number;
  logger?: { debug?: Function; warn?: Function; error?: Function };
};

export function createAffectCore(options: CoreOptions) {
  const config = options.config ?? {};
  const personality = personalityFrom(config);
  const store = createStore(options.dir, personality);
  const bonds = createBondStore(options.dir);
  const clock = options.now ?? Date.now;
  const tz = resolveTimeZone(config.care?.tz ?? config.proactive?.tz);
  const quietHours = readQuietHours(config.proactive?.quietHours);
  const proactiveEnabled = config.proactive?.enabled === true;
  const maxRate = typeof config.l1?.maxRatePerHour === "number" ? config.l1.maxRatePerHour : 12;
  const budget = tokenBucket(maxRate, clock);
  const l1 = options.l1
    ? "cached" in options.l1
      ? options.l1
      : createL1Appraiser(options.l1)
    : null;
  const globallyEnabled = config.enabled === true;
  const caps = readCareConfig(config);
  const failures = new Map<string, number>();
  const step = (state: AffectState, now: number) => tick(state, personality, now, { tz });

  let lastUserId: string | undefined;

  const applyImpulse = async (
    appraisal: { tag: string; delta: { v: number; a: number; d: number }; source: string; summary: string },
    extras: { satisfy?: Array<"contact" | "recognition" | "curiosity" | "order">; lastInteraction?: boolean; lastLonely?: boolean } = {},
  ) => {
    const now = clock();
    await store.mutate((state) => {
      let next = impulse(step(state, now), appraisal.delta, appraisal.tag, now, appraisal.source, appraisal.summary, personality.moodCoupling);
      if (extras.satisfy) next = applySatisfiedDrives(next, [appraisal.tag], extras.satisfy);
      if (extras.lastInteraction) next = { ...next, lastInteractionAt: now };
      if (extras.lastLonely) next = { ...next, lastLonelyAt: now };
      return next;
    });
  };

  const growBond = async (userId: string | undefined, familiarity: number, now: number) => {
    if (!userId) return;
    await store.mutate((state) => {
      const noted = noteStage(state.care, familiarity);
      if (!noted.promoted) return { ...state, care: noted.care };
      return appendJournal(
        impulse(
          { ...state, care: noted.care },
          L0_EVENTS.stage,
          "stage",
          now,
          "care",
          `养成到了「${noted.promoted}」`,
          personality.moodCoupling,
        ),
        `升到 ${noted.promoted}`,
        now,
      );
    });
  };

  return {
    store,
    bonds,
    async onMessage(message: InboundMessage) {
      try {
        if (!globallyEnabled) return;
        const command = await this.command(message.text, message.userId);
        if (command !== null) return { reply: command };
        if (!(await store.read()).enabled) return;
        const now = clock();
        if (message.userId) lastUserId = message.userId;
        if (message.userId) {
          const existing = await bonds.read(message.userId);
          await store.mutate((state) => ({ ...state, care: hydrateStage(state.care, existing.familiarity) }));
        }
        const l0 = appraiseL0(message);
        let appraisal = l0;
        if (l1 && config.l1?.enabled === true && needsL1(message, Boolean(l0))) {
          const signal = l0?.tag ?? "ambiguous";
          if (l1.cached(message, signal) || budget.take(clock())) {
            const bond = await bonds.read(message.userId ?? lastUserId ?? "anonymous");
            const assessment = await l1(message, bond, signal, typeof config.l1?.timeoutMs === "number" ? config.l1.timeoutMs : 1500);
            if (assessment) {
              appraisal = {
                tag: assessment.tag,
                delta: mapL1ToPad(assessment),
                source: "l1",
                summary: assessment.summary,
              };
            }
          }
        }
        if (!appraisal) appraisal = asContact(message);
        let bondDelta = {};
        await store.mutate((state) => {
          let next = step(state, now);
          if (appraisal) {
            next = impulse(next, appraisal.delta, appraisal.tag, now, appraisal.source, appraisal.summary, personality.moodCoupling);
            const ledger = applyCareLedger(next.care, appraisal.tag, now, tz, caps);
            bondDelta = ledger.bond;
            next = applySatisfiedDrives(
              { ...next, care: ledger.care, lastInteractionAt: now },
              [appraisal.tag],
              appraisal.tag === "contact" ? ["contact"] : [],
            );
          }
          return next;
        });
        if (message.userId && appraisal) {
          const after = await bonds.update(message.userId, bondDelta);
          await growBond(message.userId, after.familiarity, now);
        }
        await this.flush();
      } catch (error) {
        options.logger?.warn?.("affect: message appraisal skipped", error);
      }
    },
    async onToolResult(event: ToolEvent) {
      try {
        if (!globallyEnabled || !(await store.read()).enabled) return;
        const key = event.toolName;
        const count = event.error ? (failures.get(key) ?? 0) + 1 : 0;
        failures.set(key, count);
        const appraisal = appraiseToolResult(event, count);
        const now = clock();
        const sender = event.userId;
        if (appraisal) {
          let bondDelta = {};
          await store.mutate((state) => {
            let next = impulse(step(state, now), appraisal.delta, appraisal.tag, now, appraisal.source, appraisal.summary, personality.moodCoupling);
            if (appraisal.tag === "achieve") next = applySatisfiedDrives(next, [appraisal.tag], ["order"]);
            const humanToday = Boolean(sender) && state.care.lastCareDay === civilDate(now, tz);
            if (humanToday) {
              const ledger = applyCareLedger(next.care, appraisal.tag, now, tz, caps);
              bondDelta = ledger.bond;
              next = { ...next, care: ledger.care };
            }
            return sender ? { ...next, lastInteractionAt: now } : next;
          });
          if (sender && Object.keys(bondDelta).length > 0) {
            const after = await bonds.update(sender, bondDelta);
            await growBond(sender, after.familiarity, now);
          }
        }
        await this.flush();
      } catch (error) {
        options.logger?.warn?.("affect: tool appraisal skipped", error);
      }
    },
    async beforeAgentReply(userId?: string) {
      try {
        if (!globallyEnabled) return {};
        const now = clock();
        const state = await store.mutate((current) => step(current, now));
        if (!state.enabled) return {};
        const resolved = userId ?? lastUserId ?? "anonymous";
        const bond = await bonds.read(resolved);
        await store.mutate((current) => ({ ...current, care: hydrateStage(current.care, bond.familiarity) }));
        const hydrated = await store.read();
        return { systemAppend: renderStageNotes(derive(hydrated, bond, personality, now)) };
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
        const neglect = applyNeglectLedger(snapshot.care, now, tz);
        if (neglect.bond.affection || neglect.bond.trust) {
          await store.mutate((state) => ({ ...state, care: neglect.care }));
          await bonds.updateAll(neglect.bond, false);
        }
        const maxDrive = Math.max(...Object.values(snapshot.drives));
        const alreadyLonely = snapshot.lastLonelyAt > snapshot.lastInteractionAt;
        const appraisal = appraiseCron(silenceAgeMs, maxDrive, driveHighForMs, alreadyLonely);
        if (appraisal) {
          await applyImpulse(appraisal, { lastLonely: appraisal.tag === "lonely" });
          if (appraisal.tag === "unmet") {
            await store.mutate((state) => ({ ...state, driveHighSince: now }));
          }
        }
        let proactive;
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
    async command(input: string, userId?: string) {
      try {
        if (!globallyEnabled) {
          return input.trim().toLowerCase().startsWith("/mood") ? "情感层在配置中关闭。" : null;
        }
        let output: string | null = null;
        const now = clock();
        const bond = await bonds.read(userId ?? "anonymous");
        await store.mutate((state) => {
          const result = handleMoodCommand(input, step(state, now), bond, personality, now, config, tz);
          if (!result) return state;
          output = result.text;
          return result.state;
        });
        await this.flush();
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
