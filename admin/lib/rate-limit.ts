/**
 * In-Memory Sliding Window Rate Limiter for SovereignSMS Admin Panel
 *
 * Simple, zero-dependency rate limiting using a Map of timestamp arrays.
 * Suitable for single-process deployments. For multi-instance setups,
 * replace with Redis-based rate limiting.
 */

export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

/** Internal store: key -> array of request timestamps */
const store = new Map<string, number[]>();

/** Cleanup interval handle */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic cleanup of stale entries.
 * Called lazily on first rate-limit check.
 */
function ensureCleanup(): void {
  if (cleanupInterval !== null) return;
  // Run cleanup every 60 seconds
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of store.entries()) {
      // Remove entries where all timestamps are older than the largest window (15 min)
      const filtered = timestamps.filter((t) => now - t < 15 * 60 * 1000);
      if (filtered.length === 0) {
        store.delete(key);
      } else {
        store.set(key, filtered);
      }
    }
  }, 60_000);

  // Prevent the interval from keeping the process alive
  if (cleanupInterval && typeof cleanupInterval === 'object' && 'unref' in cleanupInterval) {
    cleanupInterval.unref();
  }
}

/**
 * Check and record a request against the rate limit.
 *
 * @param key   - Unique key (e.g. `login:${ip}`, `credit:${adminId}`)
 * @param config - Window size and max requests
 * @returns Whether the request is allowed, remaining quota, and retry-after if blocked
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  ensureCleanup();

  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Get existing timestamps and prune expired ones
  const existing = store.get(key) ?? [];
  const valid = existing.filter((t) => t > windowStart);

  if (valid.length >= config.maxRequests) {
    // Rate limited — calculate when the oldest entry in the window expires
    const oldestInWindow = valid[0];
    const retryAfterMs = oldestInWindow + config.windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 0),
    };
  }

  // Allow and record this request
  valid.push(now);
  store.set(key, valid);

  return {
    allowed: true,
    remaining: config.maxRequests - valid.length,
  };
}

/**
 * Predefined rate limit configurations.
 */
export const RATE_LIMITS = {
  /** Login attempts: 5 per 15 minutes per IP */
  LOGIN: { windowMs: 15 * 60 * 1000, maxRequests: 5 } satisfies RateLimitConfig,

  /** General API calls: 60 per minute per IP */
  API: { windowMs: 60 * 1000, maxRequests: 60 } satisfies RateLimitConfig,

  /** Credit adjustments: 5 per minute per admin */
  CREDIT_ADJUST: { windowMs: 60 * 1000, maxRequests: 5 } satisfies RateLimitConfig,

  /** Sensitive operations: 10 per minute per admin */
  SENSITIVE: { windowMs: 60 * 1000, maxRequests: 10 } satisfies RateLimitConfig,
} as const;

/**
 * Reset rate limit for a specific key. Useful after successful login
 * to clear failed-attempt counters.
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}
