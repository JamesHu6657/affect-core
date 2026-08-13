const FALLBACK_TZ = "UTC";

export interface CivilTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function utcParts(now: number): CivilTime {
  const date = new Date(now);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function parts(now: number, timeZone: string): CivilTime {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(now));
    const value = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(formatted.find((part) => part.type === type)?.value ?? Number.NaN);
    const civil: CivilTime = {
      year: value("year"),
      month: value("month"),
      day: value("day"),
      hour: value("hour"),
      minute: value("minute"),
    };
    if (Object.values(civil).every(Number.isFinite)) return civil;
  } catch {
    // Bad IANA names fall back to UTC so tick() cannot throw.
  }
  return timeZone === FALLBACK_TZ ? utcParts(now) : parts(now, FALLBACK_TZ);
}

export function resolveTimeZone(value: unknown, fallback = FALLBACK_TZ): string {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format();
    return value.trim();
  } catch {
    return fallback;
  }
}

export function localHour(now: number, timeZone: string): number {
  return parts(now, timeZone).hour;
}

export function minutesOfDay(now: number, timeZone: string): number {
  const civil = parts(now, timeZone);
  return civil.hour * 60 + civil.minute;
}

export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function inQuietHours(now: number, quietHours: readonly [string, string], timeZone: string): boolean {
  const start = parseClock(quietHours[0]);
  const end = parseClock(quietHours[1]);
  if (start === null || end === null) return false;
  const minutes = minutesOfDay(now, timeZone);
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function inSleepWindow(now: number, timeZone: string): boolean {
  const hour = localHour(now, timeZone);
  return hour >= 23 || hour < 8;
}

export function sleepPeriodId(now: number, timeZone: string): string {
  const civil = parts(now, timeZone);
  if (civil.hour >= 23) return `${civil.year}-${civil.month}-${civil.day}`;
  const previous = parts(now - 24 * 60 * 60 * 1000, timeZone);
  return `${previous.year}-${previous.month}-${previous.day}`;
}

export function sameSleepPeriod(then: number, now: number, timeZone: string): boolean {
  if (!Number.isFinite(then) || then <= 0) return false;
  return sleepPeriodId(then, timeZone) === sleepPeriodId(now, timeZone);
}

export function sleepOverlapMinutes(from: number, to: number, timeZone: string): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  const step = 15 * 60 * 1000;
  let sleep = 0;
  let cursor = from;
  while (cursor < to) {
    const next = Math.min(cursor + step, to);
    if (inSleepWindow(cursor, timeZone)) sleep += (next - cursor) / 60_000;
    cursor = next;
  }
  return sleep;
}

export function sleepPeriodIdsBetween(from: number, to: number, timeZone: string): string[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const ids = new Set<string>();
  const step = 60 * 60 * 1000;
  for (let cursor = from; cursor <= to; cursor += step) {
    if (inSleepWindow(cursor, timeZone)) ids.add(sleepPeriodId(cursor, timeZone));
  }
  if (inSleepWindow(to, timeZone)) ids.add(sleepPeriodId(to, timeZone));
  return [...ids];
}

export function readQuietHours(value: unknown): [string, string] {
  if (Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string") {
    if (parseClock(value[0]) !== null && parseClock(value[1]) !== null) return [value[0], value[1]];
  }
  return ["23:30", "08:00"];
}
