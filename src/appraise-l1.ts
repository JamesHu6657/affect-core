import { capAbs, clamp, clampUnit } from "./dynamics.ts";
import type { Bond, InboundMessage, Pad } from "./types.ts";

export type L1Assessment = {
  tag: string;
  summary: string;
  desirability: number;
  expectedness: number;
  controllability: number;
  normViolation: number;
  relevanceToBond: number;
  agency: "self" | "other" | "none";
};

export type L1Adapter = {
  appraise: (input: { message: InboundMessage; bond: Bond; signal: string }) => Promise<L1Assessment | null>;
};

export function messageFingerprint(message: InboundMessage): string {
  const normalized = message.text.trim().toLowerCase().replace(/\s+/g, " ");
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function needsL1(message: InboundMessage, l0Hit: boolean): boolean {
  if (l0Hit) return false;
  return /承诺|道别|批评|信任|失望|抱歉|关系|promise|goodbye|critic|trust|disappoint|sorry/i.test(message.text);
}

export function isRelationalCue(message: InboundMessage): boolean {
  return needsL1(message, false);
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs = 1500): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(1, timeoutMs));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export function mapL1ToPad(assessment: L1Assessment): Pad {
  const desirability = clamp(assessment.desirability);
  const unexpectedness = 1 - clampUnit(assessment.expectedness);
  const controllability = clampUnit(assessment.controllability);
  const normViolation = clampUnit(assessment.normViolation);
  const v = desirability * 0.3;
  const a = unexpectedness * 0.22 + Math.abs(desirability) * 0.08;
  const agencyShift = assessment.agency === "self" ? 0.1 : assessment.agency === "other" ? -0.06 : 0;
  const d = controllability * 0.16 + agencyShift - normViolation * 0.18;
  return { v: capAbs(v), a: capAbs(a), d: capAbs(d) };
}

export function createL1Appraiser(adapter: L1Adapter, ttlMs = 6 * 60 * 60 * 1000) {
  const cache = new Map<string, { value: L1Assessment; expiresAt: number }>();
  const cacheKey = (message: InboundMessage, signal: string) => `${signal}:${messageFingerprint(message)}`;
  const appraise = async (message: InboundMessage, bond: Bond, signal: string, timeoutMs = 1500) => {
    const key = cacheKey(message, signal);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    const result = await withTimeout(adapter.appraise({ message, bond, signal }), timeoutMs);
    const valid = result && isL1Assessment(result) ? normalizeAssessment(result) : null;
    if (valid) cache.set(key, { value: valid, expiresAt: now + ttlMs });
    return valid;
  };
  appraise.cached = (message: InboundMessage, signal: string, now = Date.now()) => {
    const hit = cache.get(cacheKey(message, signal));
    return Boolean(hit && hit.expiresAt > now);
  };
  return appraise;
}

function isL1Assessment(value: unknown): value is L1Assessment {
  if (!value || typeof value !== "object") return false;
  const item = value as L1Assessment;
  return (
    typeof item.tag === "string" &&
    typeof item.summary === "string" &&
    typeof item.desirability === "number" &&
    typeof item.expectedness === "number" &&
    typeof item.controllability === "number" &&
    typeof item.normViolation === "number" &&
    typeof item.relevanceToBond === "number" &&
    (item.agency === "self" || item.agency === "other" || item.agency === "none")
  );
}

function normalizeAssessment(value: L1Assessment): L1Assessment {
  return {
    tag: value.tag.slice(0, 64),
    summary: value.summary.slice(0, 240),
    desirability: clamp(value.desirability),
    expectedness: clampUnit(value.expectedness),
    controllability: clampUnit(value.controllability),
    normViolation: clampUnit(value.normViolation),
    relevanceToBond: clampUnit(value.relevanceToBond),
    agency: value.agency,
  };
}
