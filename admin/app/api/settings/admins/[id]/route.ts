import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission, requireRole } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';

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
  console.error('[API] settings/admins/[id]:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const updateAdminSchema = z.object({
  role: z.enum(['ADMIN', 'SUPPORT', 'VIEWER']).optional(),
  status: z.enum(['ACTIVE', 'LOCKED', 'DISABLED']).optional(),
  allowedIps: z.array(z.string()).optional(),
  dailyCreditLimit: z.number().min(0).optional(),
  reason: z.string().min(5, '사유를 5자 이상 입력하세요.'),
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/admins/[id] — Update admin user
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'admin:manage');
    requireRole(admin, 'SUPER_ADMIN');
    const { id } = await context.params;

    // Cannot modify self
    if (admin.id === id) {
      return NextResponse.json({ error: '자신의 계정은 수정할 수 없습니다.' }, { status: 400 });
    }

    const body = await req.json();
    const parsed = updateAdminSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { role, status, allowedIps, dailyCreditLimit, reason } = parsed.data;

    const targetAdmin = await prisma.adminUser.findUnique({ where: { id } });
    if (!targetAdmin) {
      return NextResponse.json({ error: '관리자를 찾을 수 없습니다.' }, { status: 404 });
    }

    // Cannot modify another SUPER_ADMIN
    if (targetAdmin.role === 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'SUPER_ADMIN 계정은 수정할 수 없습니다.' }, { status: 403 });
    }

    const updateData: any = {};
    if (role !== undefined) updateData.role = role;
    if (status !== undefined) updateData.status = status;
    if (allowedIps !== undefined) updateData.allowedIps = allowedIps;
    if (dailyCreditLimit !== undefined) updateData.dailyCreditLimit = dailyCreditLimit;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });
    }

    const updated = await prisma.adminUser.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        allowedIps: true,
        dailyCreditLimit: true,
        updatedAt: true,
      },
    });

    // If disabling admin, delete their sessions
    if (status === 'DISABLED' || status === 'LOCKED') {
      await prisma.adminSession.deleteMany({ where: { adminId: id } });
    }

    await logAdminAction(admin, 'ADMIN_UPDATE', 'AdminUser', id, reason, req, {
      previousValue: {
        role: targetAdmin.role,
        status: targetAdmin.status,
        allowedIps: targetAdmin.allowedIps,
        dailyCreditLimit: targetAdmin.dailyCreditLimit,
      },
      newValue: updateData,
    });

    return NextResponse.json({ admin: updated });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/settings/admins/[id] — Delete admin user
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'admin:manage');
    requireRole(admin, 'SUPER_ADMIN');
    const { id } = await context.params;

    // Cannot delete self
    if (admin.id === id) {
      return NextResponse.json({ error: '자신의 계정은 삭제할 수 없습니다.' }, { status: 400 });
    }

    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!targetAdmin) {
      return NextResponse.json({ error: '관리자를 찾을 수 없습니다.' }, { status: 404 });
    }

    // Cannot delete SUPER_ADMIN
    if (targetAdmin.role === 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'SUPER_ADMIN 계정은 삭제할 수 없습니다.' }, { status: 403 });
    }

    // Delete sessions first, then the admin
    await prisma.adminSession.deleteMany({ where: { adminId: id } });
    await prisma.adminUser.delete({ where: { id } });

    await logAdminAction(admin, 'ADMIN_DELETE', 'AdminUser', id, `관리자 삭제: ${targetAdmin.email}`, req, {
      previousValue: { email: targetAdmin.email, name: targetAdmin.name, role: targetAdmin.role },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleError(err);
  }
}
