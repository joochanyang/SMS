/**
 * 관리자 API 공용 에러 핸들러.
 * 기존 18개 라우트에 복붙된 `handleError(err)` 로직을 대체한다.
 */

import { NextResponse } from 'next/server';
import { logger, toLogError } from './logger';

interface AuthzError extends Error {
  status?: number;
  requireSudo?: boolean;
}

export function handleApiError(err: unknown, context: string): NextResponse {
  if (err instanceof Error) {
    const e = err as AuthzError;
    const status = e.status;
    if (status === 401 || status === 403) {
      const body: Record<string, unknown> = { error: e.message };
      if (e.requireSudo) body.requireSudo = true;
      return NextResponse.json(body, { status });
    }
  }

  logger.error(`[API] ${context}`, { error: toLogError(err) });
  return NextResponse.json(
    { error: '요청 처리 중 오류가 발생했습니다.' },
    { status: 500 },
  );
}
