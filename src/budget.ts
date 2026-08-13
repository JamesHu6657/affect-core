export interface TokenBucket {
  take(now?: number): boolean;
  remaining(now?: number): number;
}

export function tokenBucket(maxRatePerHour: number, now = Date.now): TokenBucket {
  const capacity = Math.max(0, Math.floor(Number.isFinite(maxRatePerHour) ? maxRatePerHour : 0));
  const windowMs = 60 * 60 * 1000;
  let grants: number[] = [];

  const prune = (at: number) => {
    grants = grants.filter((timestamp) => timestamp > at - windowMs);
  };

  return {
    take(at = now()) {
      prune(at);
      if (grants.length >= capacity) return false;
      grants.push(at);
      return true;
    },
    remaining(at = now()) {
      prune(at);
      return Math.max(0, capacity - grants.length);
    },
  };
}
