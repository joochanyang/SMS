/**
 * POST /api/users/[id]/password
 *
 * SUPER_ADMIN 이 (sudo 모드에서) 유저 비밀번호를 강제 재설정한다.
 * - 입력 검증: ./validate.ts (순수 함수)
 * - 해시: bcryptjs cost 12 (유저는 bcryptjs, 어드민은 argon2 — 절대 섞지 말 것)
 * - 감사 로그: action='user.password_reset', 메타데이터에 비밀번호/해시 절대 포함 금지
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { requireSudo } from '@/lib/sudo';
import { logAdminAction } from '@/lib/audit';
import { handleApiError } from '@shared/api-error';
import { validatePasswordResetInput } from './validate';

const BCRYPT_COST = 12;

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'user:update');
    await requireSudo(req, admin);

    const { id } = await context.params;

    const body = (await req.json().catch(() => null)) as
      | { newPassword?: string; confirmPassword?: string; reason?: string }
      | null;
    if (!body) {
      return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
    }

    const result = validatePasswordResetInput({
      newPassword: body.newPassword ?? '',
      confirmPassword: body.confirmPassword ?? '',
      reason: body.reason ?? '',
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: '유저를 찾을 수 없습니다.' }, { status: 404 });
    }

    // bcryptjs cost 12 — app/api/auth/reset-password/route.ts 와 동일 정책
    const passwordHash = await bcrypt.hash(body.newPassword!, BCRYPT_COST);

    await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    // 감사 로그 — previousValue/newValue/메타데이터에 비밀번호·해시 절대 포함 금지
    await logAdminAction(
      admin,
      'user.password_reset',
      'User',
      id,
      body.reason!,
      req,
      { result: 'SUCCESS' },
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, 'admin-user-password-reset');
  }
}
