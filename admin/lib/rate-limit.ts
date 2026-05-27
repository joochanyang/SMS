/**
 * SovereignSMS 관리자 패널 Rate Limiter
 *
 * 공유 모듈(lib/rate-limiter.ts)의 슬라이딩 윈도우 로직을 래핑하여
 * 관리자 패널 전용 설정과 헬퍼를 제공한다.
 */

import {
  checkRateLimit as sharedCheckRateLimit,
  resetRateLimit as sharedResetRateLimit,
  type RateLimitResult,
} from '@shared/rate-limiter';

export type { RateLimitResult };

export interface RateLimitConfig {
  /** 시간 윈도우 (밀리초) */
  windowMs: number;
  /** 윈도우 내 최대 허용 요청 수 */
  maxRequests: number;
}

/**
 * Rate limit 체크 — 공유 모듈에 위임
 *
 * @param key    - 고유 키 (예: `login:${ip}`, `credit:${adminId}`)
 * @param config - 윈도우 크기 및 최대 요청 수
 * @returns 허용 여부, 잔여 횟수, 재시도 대기 시간
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  return sharedCheckRateLimit(key, config.maxRequests, config.windowMs);
}

/**
 * 관리자 패널용 사전 정의 Rate Limit 설정
 */
export const RATE_LIMITS = {
  /**
   * 로그인 시도 rate limit: IP당 15분에 10회.
   *
   * 한도 의미: "연속 실패 10회" 가 정확함. 성공하면 카운터가 리셋되도록
   * `admin/app/api/auth/login/route.ts` 가 성공 분기에서 resetRateLimit() 호출.
   * 따라서 정상 사용자는 사실상 영향 없고, brute-force만 차단.
   */
  LOGIN: { windowMs: 15 * 60 * 1000, maxRequests: 10 } satisfies RateLimitConfig,

  /** 일반 API 호출: IP당 분당 60회 */
  API: { windowMs: 60 * 1000, maxRequests: 60 } satisfies RateLimitConfig,

  /** 크레딧 조정: 관리자당 분당 5회 */
  CREDIT_ADJUST: { windowMs: 60 * 1000, maxRequests: 5 } satisfies RateLimitConfig,

  /** 민감 작업: 관리자당 분당 10회 */
  SENSITIVE: { windowMs: 60 * 1000, maxRequests: 10 } satisfies RateLimitConfig,
} as const;

/**
 * 특정 키의 rate limit 초기화.
 * 로그인 성공 후 실패 카운터 제거 등에 사용.
 */
export function resetRateLimit(key: string): void {
  sharedResetRateLimit(key);
}
