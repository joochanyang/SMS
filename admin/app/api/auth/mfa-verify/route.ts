import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import * as OTPAuth from 'otpauth';
import crypto from 'crypto';
import { getClientIp, getClientUserAgent } from '@/lib/admin-session';

const SESSION_COOKIE = 'admin_session';

const verifySchema = z.object({
  code: z.string().min(6).max(8), // 6 for TOTP, 8 for backup code
});

// ---------------------------------------------------------------------------
// POST /api/auth/mfa-verify
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ua = getClientUserAgent(request);

    // Find session with mfaVerified = false
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ error: '세션이 없습니다. 다시 로그인하세요.' }, { status: 401 });
    }

    const session = await prisma.adminSession.findUnique({
      where: { sessionToken: token },
      include: { admin: true },
    });

    if (!session) {
      return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 });
    }

    if (session.mfaVerified) {
      return NextResponse.json({ error: 'MFA가 이미 인증되었습니다.' }, { status: 400 });
    }

    if (new Date() > session.expiresAt) {
      await prisma.adminSession.delete({ where: { id: session.id } });
      return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 });
    }

    // Parse body
    const body = await request.json();
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '유효한 코드를 입력하세요.' }, { status: 400 });
    }

    const { code } = parsed.data;
    const admin = session.admin;

    if (!admin.mfaSecret) {
      return NextResponse.json({ error: 'MFA가 설정되지 않았습니다.' }, { status: 400 });
    }

    let verified = false;
    let usedBackupCode = false;

    // Try TOTP first (6-digit code)
    if (code.length === 6 && /^\d{6}$/.test(code)) {
      const totp = new OTPAuth.TOTP({
        issuer: 'SovereignSMS Admin',
        label: admin.email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(admin.mfaSecret),
      });

      const delta = totp.validate({ token: code, window: 1 });
      if (delta !== null) {
        verified = true;
      }
    }

    // Try backup code if TOTP didn't match
    if (!verified) {
      const codeHash = crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
      const backupIndex = admin.mfaBackupCodes.indexOf(codeHash);
      if (backupIndex !== -1) {
        verified = true;
        usedBackupCode = true;

        // Remove used backup code (one-time use)
        const updatedCodes = [...admin.mfaBackupCodes];
        updatedCodes.splice(backupIndex, 1);
        await prisma.adminUser.update({
          where: { id: admin.id },
          data: { mfaBackupCodes: updatedCodes },
        });
      }
    }

    if (!verified) {
      // Audit failure
      try {
        await prisma.auditLog.create({
          data: {
            adminId: admin.id,
            adminEmail: admin.email,
            action: 'MFA_VERIFY_FAILURE',
            targetType: 'AdminUser',
            targetId: admin.id,
            reason: 'MFA 인증 실패',
            ipAddress: ip,
            userAgent: ua,
            result: 'FAILURE',
          },
        });
      } catch {
        // non-blocking
      }

      return NextResponse.json({ error: '코드가 올바르지 않습니다.' }, { status: 401 });
    }

    // Mark session as MFA-verified
    await prisma.adminSession.update({
      where: { id: session.id },
      data: { mfaVerified: true, lastActivityAt: new Date() },
    });

    // Audit success
    try {
      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          adminEmail: admin.email,
          action: 'MFA_VERIFY_SUCCESS',
          targetType: 'AdminUser',
          targetId: admin.id,
          reason: usedBackupCode ? 'MFA 인증 성공 (백업 코드)' : 'MFA 인증 성공',
          ipAddress: ip,
          userAgent: ua,
          result: 'SUCCESS',
          metadata: usedBackupCode
            ? { method: 'backup_code', remainingCodes: admin.mfaBackupCodes.length - 1 }
            : { method: 'totp' },
        },
      });
    } catch {
      // non-blocking
    }

    return NextResponse.json({
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
      ...(usedBackupCode && {
        warning: `백업 코드가 사용되었습니다. 남은 코드: ${admin.mfaBackupCodes.length - 1}개`,
      }),
    });
  } catch {
    return NextResponse.json({ error: 'MFA 인증 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
