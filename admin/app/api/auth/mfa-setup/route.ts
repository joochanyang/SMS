import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import * as OTPAuth from 'otpauth';
import crypto from 'crypto';
import { generateBackupCodes, hashPassword } from '@/lib/admin-auth';
import { requireAuth, getClientIp, getClientUserAgent } from '@/lib/admin-session';
import { AuthError } from '@/lib/admin-session';
import { encryptMfaSecret, decryptMfaSecret } from '@/lib/mfa-crypto';

// ---------------------------------------------------------------------------
// GET /api/auth/mfa-setup — Generate TOTP secret + otpauth URI
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);

    // Check MFA not already enabled
    const adminUser = await prisma.adminUser.findUnique({ where: { id: admin.id } });
    if (!adminUser) {
      return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (adminUser.mfaEnabled) {
      return NextResponse.json(
        { error: 'MFA가 이미 활성화되어 있습니다.' },
        { status: 400 },
      );
    }

    // Generate TOTP secret
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: 'SovereignSMS Admin',
      label: admin.username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const uri = totp.toString();

    // Store the secret temporarily in mfaSecret (not yet enabled)
    // AES-256-GCM 암호화 적용
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { mfaSecret: encryptMfaSecret(secret.base32) },
    });

    return NextResponse.json({
      secret: secret.base32,
      uri,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'MFA 설정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/mfa-setup — Verify code and activate MFA
// ---------------------------------------------------------------------------

const verifySchema = z.object({
  code: z.string().length(6, 'OTP 코드는 6자리입니다.'),
});

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    const ip = getClientIp(request);
    const ua = getClientUserAgent(request);

    const body = await request.json();
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '유효한 6자리 코드를 입력하세요.' },
        { status: 400 },
      );
    }

    const { code } = parsed.data;

    const adminUser = await prisma.adminUser.findUnique({ where: { id: admin.id } });
    if (!adminUser || !adminUser.mfaSecret) {
      return NextResponse.json(
        { error: 'MFA 설정을 먼저 시작하세요. (GET 요청)' },
        { status: 400 },
      );
    }
    if (adminUser.mfaEnabled) {
      return NextResponse.json(
        { error: 'MFA가 이미 활성화되어 있습니다.' },
        { status: 400 },
      );
    }

    // Verify TOTP code — 복호화 후 검증
    const plainSecret = decryptMfaSecret(adminUser.mfaSecret);
    const totp = new OTPAuth.TOTP({
      issuer: 'SovereignSMS Admin',
      label: admin.username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(plainSecret),
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return NextResponse.json(
        { error: 'OTP 코드가 올바르지 않습니다.' },
        { status: 401 },
      );
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes(10);

    // Hash backup codes for storage
    const hashedBackupCodes: string[] = [];
    for (const bc of backupCodes) {
      const hash = crypto.createHash('sha256').update(bc).digest('hex');
      hashedBackupCodes.push(hash);
    }

    // Enable MFA
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        mfaEnabled: true,
        mfaBackupCodes: hashedBackupCodes,
      },
    });

    // Audit
    try {
      await prisma.auditLog.create({
        data: {
          adminId: admin.id,
          adminEmail: admin.username,
          action: 'MFA_ENABLED',
          targetType: 'AdminUser',
          targetId: admin.id,
          reason: 'MFA 활성화',
          ipAddress: ip,
          userAgent: ua,
          result: 'SUCCESS',
        },
      });
    } catch {
      // non-blocking
    }

    return NextResponse.json({
      success: true,
      backupCodes, // Return plain-text codes ONCE — user must save them
      message: '백업 코드를 안전한 곳에 저장하세요. 다시 표시되지 않습니다.',
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'MFA 설정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
