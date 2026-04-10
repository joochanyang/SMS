import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
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
  console.error('[API] users/[id]/suspend:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const suspendSchema = z.object({
  action: z.enum(['SUSPEND', 'UNSUSPEND', 'BAN']),
  reason: z.string().min(10, '사유를 10자 이상 입력하세요.'),
});

// ---------------------------------------------------------------------------
// POST /api/users/[id]/suspend — Suspend / Unsuspend / Ban user
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'user:suspend');
    const { id } = await context.params;

    const body = await req.json();
    const parsed = suspendSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { action, reason } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: '유저를 찾을 수 없습니다.' }, { status: 404 });
    }

    // Validate state transitions
    if (action === 'SUSPEND' && user.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: '활성 상태인 유저만 정지할 수 있습니다.' },
        { status: 400 },
      );
    }

    if (action === 'UNSUSPEND' && user.status !== 'SUSPENDED') {
      return NextResponse.json(
        { error: '정지 상태인 유저만 해제할 수 있습니다.' },
        { status: 400 },
      );
    }

    if (action === 'BAN' && user.status === 'BANNED') {
      return NextResponse.json(
        { error: '이미 차단된 유저입니다.' },
        { status: 400 },
      );
    }

    const now = new Date();
    let newStatus: string;
    let updateData: any;

    switch (action) {
      case 'SUSPEND':
        newStatus = 'SUSPENDED';
        updateData = {
          status: 'SUSPENDED',
          suspendedAt: now,
          suspendReason: reason,
        };
        break;
      case 'UNSUSPEND':
        newStatus = 'ACTIVE';
        updateData = {
          status: 'ACTIVE',
          suspendedAt: null,
          suspendReason: null,
        };
        break;
      case 'BAN':
        newStatus = 'BANNED';
        updateData = {
          status: 'BANNED',
          suspendedAt: now,
          suspendReason: reason,
        };
        break;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        suspendedAt: true,
        suspendReason: true,
      },
    });

    // If suspending/banning, cancel all active campaigns
    if (action === 'SUSPEND' || action === 'BAN') {
      await prisma.smsCampaign.updateMany({
        where: {
          userId: id,
          status: { in: ['DRAFT', 'QUEUED', 'SENDING'] },
        },
        data: { status: 'CANCELLED' },
      });
    }

    const actionLabels: Record<string, string> = {
      SUSPEND: '유저 정지',
      UNSUSPEND: '유저 정지 해제',
      BAN: '유저 차단',
    };

    await logAdminAction(
      admin,
      `USER_${action}`,
      'User',
      id,
      reason,
      req,
      {
        previousValue: { status: user.status },
        newValue: { status: newStatus! },
      },
    );

    return NextResponse.json({
      success: true,
      message: `${actionLabels[action]} 처리되었습니다.`,
      user: updated,
    });
  } catch (err) {
    return handleError(err);
  }
}
