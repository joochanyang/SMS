/**
 * 슬라이딩 윈도우 기반 인메모리 Rate Limiter
 * 외부 의존성 없이 Map 기반으로 IP/userId별 요청 카운트 추적
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

interface RequestRecord {
  timestamps: number[];
}

const store = new Map<string, RequestRecord>();

// 5분마다 만료된 엔트리 정리
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_WINDOW_MS = 60 * 60 * 1000; // 최대 윈도우 = 1시간

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const cutoff = now - MAX_WINDOW_MS;
    store.forEach((record, key) => {
      // 윈도우 밖의 타임스탬프 제거
      record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
      if (record.timestamps.length === 0) {
        store.delete(key);
      }
    });
  }, CLEANUP_INTERVAL_MS);

  // Node.js에서 프로세스 종료를 막지 않도록 unref
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

startCleanup();

/**
 * 슬라이딩 윈도우 rate limit 체크
 * @param key - 고유 키 (예: "ip:127.0.0.1" 또는 "user:abc123")
 * @param maxRequests - 윈도우 내 최대 허용 요청 수
 * @param windowMs - 윈도우 크기 (밀리초)
 * @returns RateLimitResult
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = store.get(key);
  if (!record) {
    record = { timestamps: [] };
    store.set(key, record);
  }

  // 윈도우 밖의 타임스탬프 제거
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  if (record.timestamps.length >= maxRequests) {
    // 가장 오래된 요청이 윈도우를 벗어나는 시점 계산
    const oldestInWindow = record.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 1000),
    };
  }

  // 요청 허용 → 타임스탬프 기록
  record.timestamps.push(now);

  return {
    allowed: true,
    remaining: maxRequests - record.timestamps.length,
  };
}
