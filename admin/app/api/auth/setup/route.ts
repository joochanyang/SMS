import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@shared/prisma';
import { hashPassword, validatePasswordPolicy } from '@/lib/admin-auth';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const setupSchema = z.object({
  secret: z.string().min(1, '설정 시크릿이 필요합니다.'),
  username: z.string().min(1, '아이디를 입력하세요.'),
  password: z.string().min(16, '비밀번호는 최소 16자 이상이어야 합니다.'),
  name: z.string().min(1, '이름을 입력하세요.'),
});

// ---------------------------------------------------------------------------
// POST /api/auth/setup — First-time SUPER_ADMIN creation
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // 1. Check ADMIN_SETUP_SECRET is configured
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    if (!setupSecret) {
      return NextResponse.json(
        { error: '초기 설정이 비활성화되어 있습니다.' },
        { status: 403 },
      );
    }

    // 2. Parse body
    const body = await request.json();
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { secret, username, password, name } = parsed.data;

    // 3. Verify setup secret (timing-safe comparison)
    const secretBuffer = Buffer.from(secret);
    const expectedBuffer = Buffer.from(setupSecret);
    if (secretBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(secretBuffer, expectedBuffer)) {
      return NextResponse.json(
        { error: '설정 시크릿이 올바르지 않습니다.' },
        { status: 403 },
      );
    }

    // 4. Only works when no admin users exist
    const adminCount = await prisma.adminUser.count();
    if (adminCount > 0) {
      return NextResponse.json(
        { error: '이미 관리자 계정이 존재합니다. 초기 설정은 한 번만 가능합니다.' },
        { status: 403 },
      );
    }

    // 5. Validate password policy
    const policyResult = validatePasswordPolicy(password);
    if (!policyResult.valid) {
      return NextResponse.json(
        { error: '비밀번호 정책을 충족하지 않습니다.', details: policyResult.errors },
        { status: 400 },
      );
    }

    // 6. Hash password
    const passwordHash = await hashPassword(password);

    // 7. Create SUPER_ADMIN
    const admin = await prisma.adminUser.create({
      data: {
        username,
        passwordHash,
        name,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        passwordChangedAt: new Date(),
        previousPasswords: [passwordHash],
      },
    });

    return NextResponse.json({
      success: true,
      message: 'SUPER_ADMIN 계정이 생성되었습니다. MFA를 설정하세요.',
      admin: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        role: admin.role,
      },
    });
  } catch (e) {
    console.error('[admin/setup] 처리 중 예외:', e);
    return NextResponse.json(
      { error: '초기 설정 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
