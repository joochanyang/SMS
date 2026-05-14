import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import { handleApiError } from '@shared/api-error';
import type { Prisma } from '@prisma/client';


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
    let updateData: Prisma.UserUpdateInput;

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

    // If suspending/banning, cancel active campaigns AND refund unprocessed SMS logs
    // 원자적 처리: 유저 상태 변경 + 캠페인 취소 + 미발송 건 실패 처리 + 크레딧 환불 + 원장 기록
    let refundSummary: { refundedCount: number; refundAmount: number } = {
      refundedCount: 0,
      refundAmount: 0,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
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

      if (action !== 'SUSPEND' && action !== 'BAN') {
        return u;
      }

      // 환불 대상 캠페인 조회 (costPerMessage 포함)
      const activeCampaigns = await tx.smsCampaign.findMany({
        where: {
          userId: id,
          status: { in: ['DRAFT', 'QUEUED', 'SENDING'] },
        },
        select: { id: true, name: true, costPerMessage: true },
      });

      let totalRefund = 0;
      let totalRefundCount = 0;

      for (const c of activeCampaigns) {
        const cancelResult = await tx.smsLog.updateMany({
          where: {
            campaignId: c.id,
            status: { in: ['PENDING', 'RETRY_PENDING'] },
          },
          data: { status: 'FAILED', providerError: '유저 정지/차단으로 캠페인 중지' },
        });

        const unprocessed = cancelResult.count;
        if (unprocessed <= 0) continue;

        const refundAmount = unprocessed * Number(c.costPerMessage);
        totalRefund += refundAmount;
        totalRefundCount += unprocessed;

        const updatedUser = await tx.user.update({
          where: { id },
          data: { credits: { increment: refundAmount } },
        });

        await tx.creditLedger.create({
          data: {
            userId: id,
            type: 'REFUND',
            amount: refundAmount,
            balanceAfter: updatedUser.credits,
            description: `유저 ${action === 'BAN' ? '차단' : '정지'} 환불 (${unprocessed}건, ${c.name ?? c.id})`,
            adminId: admin.id,
            referenceType: 'CAMPAIGN',
            referenceId: c.id,
          },
        });

        await tx.transaction.create({
          data: {
            userId: id,
            amount: refundAmount,
            type: 'DEPOSIT',
            description: `[유저 ${action === 'BAN' ? '차단' : '정지'} 환불] ${c.name ?? c.id}`,
          },
        });
      }

      // 캠페인 상태를 CANCELLED로 일괄 변경
      await tx.smsCampaign.updateMany({
        where: {
          userId: id,
          status: { in: ['DRAFT', 'QUEUED', 'SENDING'] },
        },
        data: { status: 'CANCELLED' },
      });

      refundSummary = { refundedCount: totalRefundCount, refundAmount: totalRefund };
      return u;
    });

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
        metadata: {
          refundedCount: refundSummary.refundedCount,
          refundAmount: refundSummary.refundAmount,
        },
      },
    );

    return NextResponse.json({
      success: true,
      message: refundSummary.refundAmount > 0
        ? `${actionLabels[action]} 처리되었습니다. ${refundSummary.refundedCount}건 환불됨.`
        : `${actionLabels[action]} 처리되었습니다.`,
      user: updated,
      ...(refundSummary.refundAmount > 0 && {
        refunded: true,
        refundAmount: refundSummary.refundAmount,
        refundedCount: refundSummary.refundedCount,
      }),
    });
  } catch (err) {
    return handleApiError(err, 'users/[id]/suspend');
  }
}
