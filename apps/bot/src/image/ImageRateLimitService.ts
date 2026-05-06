export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterMs?: number;
}

export interface ImageRateLimitService {
  readonly consume: (key: string, now?: number) => RateLimitResult;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export const createImageRateLimitService = (config: {
  readonly limit: number;
  readonly windowMs: number;
}): ImageRateLimitService => {
  const buckets = new Map<string, Bucket>();

  return {
    consume: (key, now = Date.now()) => {
      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + config.windowMs });
        return { allowed: true };
      }

      if (current.count >= config.limit) {
        return { allowed: false, retryAfterMs: current.resetAt - now };
      }

      current.count += 1;
      return { allowed: true };
    },
  };
};
