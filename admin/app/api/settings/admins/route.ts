import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission, requireRole } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import { hashPassword, validatePasswordPolicy } from '@/lib/admin-auth';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const createAdminSchema = z.object({
  email: z.string().email('유효한 이메일을 입력하세요.'),
  name: z.string().min(1, '이름을 입력하세요.'),
  password: z.string().min(16, '비밀번호는 최소 16자 이상이어야 합니다.'),
  role: z.enum(['ADMIN', 'SUPPORT', 'VIEWER']),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(err: unknown): NextResponse {
  if (err instanceof Error) {
    const status = (err as any).status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  console.error('[API] settings/admins:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// GET /api/settings/admins — List admin users
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'admin:read');

    // SUPER_ADMIN sees all, others see nothing (enforced at permission level, but double-check)
    requireRole(admin, 'SUPER_ADMIN');

    const admins = await prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        mfaEnabled: true,
        allowedIps: true,
        dailyCreditLimit: true,
        lastLoginAt: true,
        createdAt: true,
        createdById: true,
      },
    });

    return NextResponse.json({ admins });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/settings/admins — Create admin user
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'admin:manage');
    requireRole(admin, 'SUPER_ADMIN');

    const body = await request.json();
    const parsed = createAdminSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { email, name, password, role } = parsed.data;

    // Password policy
    const policyResult = validatePasswordPolicy(password);
    if (!policyResult.valid) {
      return NextResponse.json(
        { error: '비밀번호 정책을 충족하지 않습니다.', details: policyResult.errors },
        { status: 400 },
      );
    }

    // Check duplicate by username OR email (username is unique, email column is not)
    const existing = await prisma.adminUser.findFirst({
      where: { OR: [{ username: email }, { email }] },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: '이미 등록된 계정입니다.' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const newAdmin = await prisma.adminUser.create({
      data: {
        username: email,
        email,
        name,
        passwordHash,
        role,
        createdById: admin.id,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    await logAdminAction(
      admin,
      'ADMIN_CREATE',
      'AdminUser',
      newAdmin.id,
      `관리자 생성: ${email} (${role})`,
      request,
      { newValue: { email, name, role } },
    );

    return NextResponse.json({ admin: newAdmin }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
