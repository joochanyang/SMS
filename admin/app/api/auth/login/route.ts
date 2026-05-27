import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { verifyPassword } from '@/lib/admin-auth';
import {
  createSession,
  setSessionCookie,
  getClientIp,
  getClientUserAgent,
} from '@/lib/admin-session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  username: z.string().min(1, '아이디를 입력하세요.'),
  password: z.string().min(1, '비밀번호를 입력하세요.'),
});

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

async function logAudit(
  adminId: string,
  adminEmail: string,
  action: string,
  result: string,
  ip: string,
  ua: string,
  metadata?: Record<string, string | number | boolean>,
) {
  try {
    await prisma.auditLog.create({
      data: {
        adminId,
        adminEmail,
        action,
        targetType: 'AdminUser',
        targetId: adminId,
        reason: action === 'LOGIN_SUCCESS' ? '로그인 성공' : '로그인 실패',
        ipAddress: ip,
        userAgent: ua,
        result,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });
  } catch {
    // Audit logging should never block the auth flow
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ua = getClientUserAgent(request);

    // 1. Rate limit — 공유 모듈 사용
    const rl = checkRateLimit(`login:${ip}`, RATE_LIMITS.LOGIN);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: '로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도하세요.' },
        { status: 429 },
      );
    }

    // 2. Parse body
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { username, password } = parsed.data;

    // 3. Find admin
    const admin = await prisma.adminUser.findUnique({ where: { username } });
    if (!admin) {
      return NextResponse.json(
        { error: '아이디 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 },
      );
    }

    // 4. Check status
    if (admin.status === 'DISABLED') {
      return NextResponse.json(
        { error: '비활성화된 계정입니다. 관리자에게 문의하세요.' },
        { status: 403 },
      );
    }

    if (admin.status === 'LOCKED') {
      if (admin.lockedUntil && new Date() < admin.lockedUntil) {
        return NextResponse.json(
          { error: '계정이 잠겨 있습니다. 잠시 후 다시 시도하세요.' },
          { status: 403 },
        );
      }
      // Lock expired — unlock
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { status: 'ACTIVE', lockedUntil: null, failedLoginCount: 0 },
      });
    }

    // Re-fetch in case status was updated
    const currentAdmin = await prisma.adminUser.findUnique({ where: { id: admin.id } });
    if (!currentAdmin) {
      return NextResponse.json({ error: '인증 오류가 발생했습니다.' }, { status: 500 });
    }

    // 5. IP whitelist
    if (currentAdmin.allowedIps.length > 0 && !currentAdmin.allowedIps.includes(ip)) {
      await logAudit(currentAdmin.id, currentAdmin.username, 'LOGIN_FAILURE', 'FAILURE', ip, ua, {
        reason: 'IP_NOT_ALLOWED',
      });
      return NextResponse.json(
        { error: '허용되지 않은 IP에서의 접근입니다.' },
        { status: 403 },
      );
    }

    // 6. Verify password
    const passwordValid = await verifyPassword(currentAdmin.passwordHash, password);

    // 7. Failure handling
    if (!passwordValid) {
      const newFailedCount = currentAdmin.failedLoginCount + 1;
      const updateData: Record<string, unknown> = { failedLoginCount: newFailedCount };

      if (newFailedCount >= 10) {
        // Permanent lock
        updateData.status = 'LOCKED';
        updateData.lockedUntil = null; // no auto-unlock
      } else if (newFailedCount >= 5) {
        // Temporary lock (15 min)
        updateData.status = 'LOCKED';
        updateData.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }

      await prisma.adminUser.update({
        where: { id: currentAdmin.id },
        data: updateData,
      });

      await logAudit(currentAdmin.id, currentAdmin.username, 'LOGIN_FAILURE', 'FAILURE', ip, ua, {
        failedCount: newFailedCount,
      });

      return NextResponse.json(
        {
          error: '아이디 또는 비밀번호가 올바르지 않습니다.',
          remainingAttempts: Math.max(0, 5 - newFailedCount),
        },
        { status: 401 },
      );
    }

    // 8. Success — reset failed count, update lastLoginAt
    await prisma.adminUser.update({
      where: { id: currentAdmin.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // 9. MFA check
    if (currentAdmin.mfaEnabled) {
      // Create a temporary session (mfaVerified = false)
      const { token, expiresAt } = await createSession(currentAdmin.id, request);

      await logAudit(currentAdmin.id, currentAdmin.username, 'LOGIN_SUCCESS', 'SUCCESS', ip, ua, {
        mfaPending: true,
      });

      const response = NextResponse.json({
        requireMfa: true,
        tempToken: token,
      });
      setSessionCookie(response, token, expiresAt);
      return response;
    }

    // 10. No MFA — create full session
    const { token, expiresAt } = await createSession(currentAdmin.id, request);
    // Mark session as mfa-verified immediately (no MFA required)
    await prisma.adminSession.updateMany({
      where: { sessionToken: token },
      data: { mfaVerified: true },
    });

    await logAudit(currentAdmin.id, currentAdmin.username, 'LOGIN_SUCCESS', 'SUCCESS', ip, ua);

    const response = NextResponse.json({
      success: true,
      admin: {
        id: currentAdmin.id,
        username: currentAdmin.username,
        name: currentAdmin.name,
        role: currentAdmin.role,
      },
    });
    setSessionCookie(response, token, expiresAt);
    return response;
  } catch (e) {
    console.error('[admin/login] 처리 중 예외:', e);
    return NextResponse.json({ error: '로그인 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
