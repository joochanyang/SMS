/**
 * POST /api/auth/sudo
 *
 * Activate sudo mode by re-entering password.
 * Required before sensitive operations (credit adjustments, user deletion, etc.).
 *
 * Request:  { password: string }
 * Response: { sudoUntil: string } (ISO 8601)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/admin-session';
import { activateSudo } from '@/lib/sudo';
import { logAdminAction } from '@/lib/audit';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { sendAlert } from '@/lib/notifications';

export async function POST(req: NextRequest) {
  try {
    // Authenticate the admin
    const admin = await requireAuth(req);

    // Rate limit: use SENSITIVE config per admin
    const rateLimitKey = `sudo:${admin.id}`;
    const rl = checkRateLimit(rateLimitKey, RATE_LIMITS.SENSITIVE);
    if (!rl.allowed) {
      await logAdminAction(admin, 'SUDO_RATE_LIMITED', 'SYSTEM', undefined, 'Sudo 시도 횟수 초과', req, {
        result: 'FAILURE',
      });
      return NextResponse.json(
        { error: '시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.', retryAfterMs: rl.retryAfterMs },
        { status: 429 },
      );
    }

    // Parse body
    const body = await req.json();
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: '비밀번호를 입력해주세요.' },
        { status: 400 },
      );
    }

    // Activate sudo mode
    const success = await activateSudo(req, admin, password);

    if (!success) {
      await logAdminAction(admin, 'SUDO_ACTIVATE', 'SYSTEM', undefined, 'Sudo 활성화 실패 — 비밀번호 불일치', req, {
        result: 'FAILURE',
      });

      await sendAlert(
        `Sudo 활성화 실패: ${admin.username} (${admin.name})`,
        'WARNING',
      );

      return NextResponse.json(
        { error: '비밀번호가 올바르지 않습니다.' },
        { status: 401 },
      );
    }

    // Calculate sudoUntil (same logic as activateSudo: 5 minutes)
    const sudoUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await logAdminAction(admin, 'SUDO_ACTIVATE', 'SYSTEM', undefined, 'Sudo 모드 활성화', req, {
      result: 'SUCCESS',
    });

    return NextResponse.json({ sudoUntil });
  } catch (err: any) {
    if (err?.status === 401) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error('[SUDO] Unexpected error:', err);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
