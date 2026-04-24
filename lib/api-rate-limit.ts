/**
 * API Rate Limit 헬퍼
 * 각 route handler 상단에서 간편하게 rate limit을 적용하기 위한 래퍼
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, type RateLimitResult } from "./rate-limiter";
import { getClientIp } from "./client-ip";

interface RateLimitConfig {
  /** 분당 최대 요청 수 */
  maxPerMinute: number;
  /** 시간당 최대 요청 수 (선택) */
  maxPerHour?: number;
}

interface RateLimitCheckResult {
  allowed: boolean;
  response?: NextResponse;
}

/**
 * Rate limit 체크 헬퍼
 *
 * 사용법:
 * ```ts
 * const rl = await withRateLimit(req, { maxPerMinute: 10, maxPerHour: 100 });
 * if (!rl.allowed) return rl.response;
 * ```
 *
 * @param req - NextRequest 객체
 * @param config - rate limit 설정
 * @returns 허용 여부 + 거부 시 429 응답
 */
export async function withRateLimit(
  req: NextRequest,
  config: RateLimitConfig,
): Promise<RateLimitCheckResult> {
  const ip = getClientIp(req, 'trusted');
  const path = req.nextUrl.pathname;
  const keyPrefix = `${path}:${ip}`;

  // 분당 제한 체크
  const minuteResult: RateLimitResult = checkRateLimit(
    `minute:${keyPrefix}`,
    config.maxPerMinute,
    60 * 1000, // 1분
  );

  if (!minuteResult.allowed) {
    return {
      allowed: false,
      response: createRateLimitResponse(minuteResult),
    };
  }

  // 시간당 제한 체크 (설정된 경우)
  if (config.maxPerHour) {
    const hourResult: RateLimitResult = checkRateLimit(
      `hour:${keyPrefix}`,
      config.maxPerHour,
      60 * 60 * 1000, // 1시간
    );

    if (!hourResult.allowed) {
      return {
        allowed: false,
        response: createRateLimitResponse(hourResult),
      };
    }
  }

  return { allowed: true };
}

/**
 * 429 응답 생성
 */
function createRateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSeconds = Math.ceil((result.retryAfterMs ?? 60000) / 1000);

  return NextResponse.json(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}
