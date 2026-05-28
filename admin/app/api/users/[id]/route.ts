import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission, requireRole } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import { requireSudo } from '@/lib/sudo';
import { handleApiError } from '@shared/api-error';
import type { Prisma } from '@prisma/client';


// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  telegramId: z.string().trim().min(1).nullable().optional(),
  costPerMessage: z.number().positive('건당 단가는 0보다 커야 합니다.').optional(),
  smsProvider: z.enum(['infobip', 'smsto', 'txg']).nullable().optional(),
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

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        telegramId: true,
        name: true,
        credits: true,
        status: true,
        suspendedAt: true,
        suspendReason: true,
        costPerMessage: true,
        smsProvider: true,
        failedLoginCount: true,
        lockedUntil: true,
        createdAt: true,
        updatedAt: true,
      },
    });
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

    return NextResponse.json({ user, recentLedger, recentCampaigns });
  } catch (err) {
    return handleApiError(err, 'users/[id]');
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

    const { name, telegramId, costPerMessage, smsProvider, reason } = parsed.data;
    if (costPerMessage !== undefined) {
      requireRole(admin, 'SUPER_ADMIN');
      await requireSudo(req, admin);
      if (!reason) {
        return NextResponse.json({ error: '건당 단가 변경 사유를 입력하세요.' }, { status: 400 });
      }
    }
    if (smsProvider !== undefined) {
      requireRole(admin, 'SUPER_ADMIN');
      await requireSudo(req, admin);
      if (!reason) {
        return NextResponse.json({ error: '발송 라인 변경 사유를 입력하세요.' }, { status: 400 });
      }
    }

    const current = await prisma.user.findUnique({ where: { id } });
    if (!current) {
      return NextResponse.json({ error: '유저를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 텔레그램 아이디 중복 검사 (다른 유저와 충돌 시 거부)
    if (telegramId) {
      const conflict = await prisma.user.findFirst({
        where: { telegramId, NOT: { id } },
        select: { id: true },
      });
      if (conflict) {
        return NextResponse.json({ error: '이미 등록된 텔레그램 아이디입니다.' }, { status: 409 });
      }
    }

    const updateData: Prisma.UserUpdateInput = {};
    const auditNewValue: Record<string, string | number | null> = {};
    if (name !== undefined) {
      updateData.name = name;
      auditNewValue.name = name;
    }
    if (telegramId !== undefined) {
      updateData.telegramId = telegramId; // null 이면 해제
      auditNewValue.telegramId = telegramId;
    }
    if (costPerMessage !== undefined) {
      updateData.costPerMessage = costPerMessage;
      auditNewValue.costPerMessage = costPerMessage;
    }
    if (smsProvider !== undefined) {
      updateData.smsProvider = smsProvider; // null 이면 전역 기본으로 복귀
      auditNewValue.smsProvider = smsProvider ?? '전역 기본';
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '변경할 항목이 없습니다.' }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        telegramId: true,
        name: true,
        credits: true,
        costPerMessage: true,
        smsProvider: true,
        status: true,
        updatedAt: true,
      },
    });

    await logAdminAction(admin, 'USER_UPDATE', 'User', id, reason ?? '유저 정보 수정', req, {
      previousValue: {
        name: current.name,
        telegramId: current.telegramId,
        costPerMessage: Number(current.costPerMessage),
        smsProvider: current.smsProvider ?? '전역 기본',
      },
      newValue: auditNewValue,
    });

    return NextResponse.json({ user: updated });
  } catch (err) {
    return handleApiError(err, 'users/[id]');
  }
}
