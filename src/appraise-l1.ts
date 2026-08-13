import { capAbs, clamp, clampUnit } from "./dynamics.ts";
import type { AffectMessage, Bond, L1Assessment, L1ModelAdapter, Pad } from "./types.ts";

interface CacheEntry {
  value: L1Assessment;
  expiresAt: number;
}

export function messageFingerprint(message: AffectMessage): string {
  const normalized = message.text.trim().toLowerCase().replace(/\s+/g, " ");
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function needsL1(message: AffectMessage, l0Hit: boolean): boolean {
  if (l0Hit) return false;
  const text = message.text;
  return /承诺|道别|批评|信任|失望|抱歉|关系|promise|goodbye|critic|trust|disappoint|sorry/i.test(text);
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs = 1500): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(1, timeoutMs));
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
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

export type L1Runner = ((
  message: AffectMessage,
  bond: Bond,
  signal: string,
  timeoutMs?: number,
) => Promise<L1Assessment | null>) & {
  cached(message: AffectMessage, signal: string, now?: number): boolean;
};

export function createL1Appraiser(adapter: L1ModelAdapter, ttlMs = 6 * 60 * 60 * 1000): L1Runner {
  const cache = new Map<string, CacheEntry>();
  const cacheKey = (message: AffectMessage, signal: string) => `${signal}:${messageFingerprint(message)}`;

  const appraise: L1Runner = async (message, bond, signal, timeoutMs = 1500) => {
    const key = cacheKey(message, signal);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;

    const result = await withTimeout(adapter.appraise({ message, bond, signal }), timeoutMs);
    const valid = result && isL1Assessment(result) ? normalizeAssessment(result) : null;
    if (valid) cache.set(key, { value: valid, expiresAt: now + ttlMs });
    return valid;
  };

  appraise.cached = (message, signal, now = Date.now()) => {
    const hit = cache.get(cacheKey(message, signal));
    return Boolean(hit && hit.expiresAt > now);
  };

  return appraise;
}

function isL1Assessment(value: L1Assessment): boolean {
  return (
    typeof value.tag === "string" &&
    typeof value.summary === "string" &&
    typeof value.desirability === "number" &&
    typeof value.expectedness === "number" &&
    typeof value.controllability === "number" &&
    typeof value.normViolation === "number" &&
    typeof value.relevanceToBond === "number" &&
    (value.agency === "self" || value.agency === "other" || value.agency === "none")
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
