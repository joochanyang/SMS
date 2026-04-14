/**
 * SovereignSMS 관리자 패널 Rate Limiter
 *
 * 공유 모듈(lib/rate-limiter.ts)의 슬라이딩 윈도우 로직을 래핑하여
 * 관리자 패널 전용 설정과 헬퍼를 제공한다.
 */

import {
  checkRateLimit as sharedCheckRateLimit,
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
  /** 로그인 시도: IP당 15분에 5회 */
  LOGIN: { windowMs: 15 * 60 * 1000, maxRequests: 5 } satisfies RateLimitConfig,

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
  // 공유 모듈의 store에 직접 접근할 수 없으므로
  // 동일 키로 checkRateLimit을 호출하면 자연스럽게 윈도우가 만료된다.
  // 즉시 초기화가 필요하면 공유 모듈에 reset 함수 추가 필요.
  // 현재는 no-op — 윈도우 만료로 자연 해제.
  void key;
}
