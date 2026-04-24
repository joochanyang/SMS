import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import { handleApiError } from '@shared/api-error';


// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const stopSchema = z.object({
  reason: z.string().min(5, '사유를 5자 이상 입력하세요.').optional().default('관리자에 의한 긴급 중지'),
});

// ---------------------------------------------------------------------------
// POST /api/campaigns/[id]/stop — Emergency stop campaign
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'campaign:stop');
    const { id } = await context.params;

    let reason = '관리자에 의한 긴급 중지';
    try {
      const body = await req.json();
      const parsed = stopSchema.safeParse(body);
      if (parsed.success) reason = parsed.data.reason;
    } catch {
      // Body may be empty — use default reason
    }

    const campaign = await prisma.smsCampaign.findUnique({
      where: { id },
      select: { id: true, status: true, userId: true, name: true, totalRecipients: true, deliveredCount: true, costPerMessage: true },
    });

    if (!campaign) {
      return NextResponse.json({ error: '캠페인을 찾을 수 없습니다.' }, { status: 404 });
    }

    // Only stop campaigns that are actively sending or queued
    const stoppableStatuses = ['QUEUED', 'SENDING'];
    if (!stoppableStatuses.includes(campaign.status)) {
      return NextResponse.json(
        { error: `현재 상태(${campaign.status})에서는 중지할 수 없습니다. 발송 중이거나 대기 중인 캠페인만 중지 가능합니다.` },
        { status: 400 },
      );
    }

    // Stop the campaign + refund unprocessed messages
    const result = await prisma.$transaction(async (tx) => {
      // Cancel pending SMS logs
      const cancelResult = await tx.smsLog.updateMany({
        where: {
          campaignId: id,
          status: { in: ['PENDING', 'RETRY_PENDING'] },
        },
        data: { status: 'FAILED', providerError: '관리자에 의한 캠페인 중지' },
      });

      const unprocessedCount = cancelResult.count;
      const refundAmount = unprocessedCount * Number(campaign.costPerMessage);

      // 미처리 건 크레딧 환불
      if (refundAmount > 0) {
        const updatedUser = await tx.user.update({
          where: { id: campaign.userId },
          data: { credits: { increment: refundAmount } },
        });

        await tx.creditLedger.create({
          data: {
            userId: campaign.userId,
            type: 'REFUND',
            amount: refundAmount,
            balanceAfter: updatedUser.credits,
            description: `관리자 캠페인 중지 환불 (${unprocessedCount}건)`,
            adminId: admin.id,
            referenceType: 'CAMPAIGN',
            referenceId: id,
          },
        });

        await tx.transaction.create({
          data: {
            userId: campaign.userId,
            amount: refundAmount,
            type: 'DEPOSIT',
            description: `[관리자 중지 환불] ${campaign.name ?? campaign.id}`,
          },
        });
      }

      // Update campaign status
      const updatedCampaign = await tx.smsCampaign.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      return { campaign: updatedCampaign, unprocessedCount, refundAmount };
    });

    await logAdminAction(admin, 'CAMPAIGN_STOP', 'SmsCampaign', id, reason, req, {
      previousValue: { status: campaign.status },
      newValue: { status: 'CANCELLED' },
      metadata: {
        userId: campaign.userId,
        totalRecipients: campaign.totalRecipients,
        deliveredBeforeStop: campaign.deliveredCount,
        refundedCount: result.unprocessedCount,
        refundAmount: result.refundAmount,
      },
    });

    return NextResponse.json({
      success: true,
      message: result.refundAmount > 0
        ? `캠페인이 중지되었습니다. ${result.unprocessedCount}건 환불 처리됨.`
        : '캠페인이 중지되었습니다.',
      campaign: {
        id: result.campaign.id,
        status: result.campaign.status,
      },
      ...(result.refundAmount > 0 && {
        refunded: true,
        refundAmount: result.refundAmount,
        refundedCount: result.unprocessedCount,
      }),
    });
  } catch (err) {
    return handleApiError(err, 'campaigns/[id]/stop');
  }
}
