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
  console.error('[API] users/[id]:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  costPerMessage: z.number().min(0).optional(),
  dailySendLimit: z.number().int().min(0).optional(),
  maxCampaignSize: z.number().int().min(0).optional(),
  reason: z.string().min(5, '사유를 5자 이상 입력하세요.').optional(),
});

// ---------------------------------------------------------------------------
// GET /api/users/[id] — User detail
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'user:read');
    const { id } = await context.params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: '유저를 찾을 수 없습니다.' }, { status: 404 });

    const recentLedger = await prisma.creditLedger.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const recentCampaigns = await prisma.smsCampaign.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        status: true,
        totalRecipients: true,
        deliveredCount: true,
        failedCount: true,
        estimatedCost: true,
        createdAt: true,
      },
    });

    const { passwordHash, ...safeUser } = user;
    return NextResponse.json({ user: safeUser, recentLedger, recentCampaigns });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/users/[id] — Update user profile/limits
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'user:update');
    const { id } = await context.params;

    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { name, costPerMessage, dailySendLimit, maxCampaignSize, reason } = parsed.data;

    const current = await prisma.user.findUnique({ where: { id } });
    if (!current) {
      return NextResponse.json({ error: '유저를 찾을 수 없습니다.' }, { status: 404 });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (costPerMessage !== undefined) updateData.costPerMessage = costPerMessage;
    if (dailySendLimit !== undefined) updateData.dailySendLimit = dailySendLimit;
    if (maxCampaignSize !== undefined) updateData.maxCampaignSize = maxCampaignSize;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        credits: true,
        costPerMessage: true,
        status: true,
        dailySendLimit: true,
        maxCampaignSize: true,
        updatedAt: true,
      },
    });

    await logAdminAction(admin, 'USER_UPDATE', 'User', id, reason ?? '유저 정보 수정', req, {
      previousValue: {
        name: current.name,
        costPerMessage: Number(current.costPerMessage),
        dailySendLimit: current.dailySendLimit,
        maxCampaignSize: current.maxCampaignSize,
      },
      newValue: updateData,
    });

    return NextResponse.json({ user: updated });
  } catch (err) {
    return handleError(err);
  }
}
