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
  console.error('[API] credits/refunds/[id]:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().min(5, '사유를 5자 이상 입력하세요.').optional(),
});

// ---------------------------------------------------------------------------
// PATCH /api/credits/refunds/[id] — Approve or reject refund
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    const { id } = await context.params;

    const body = await req.json();
    const parsed = reviewSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { action, reason } = parsed.data;

    const refund = await prisma.refundRequest.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, credits: true } },
      },
    });

    if (!refund) {
      return NextResponse.json({ error: '환불 요청을 찾을 수 없습니다.' }, { status: 404 });
    }

    const now = new Date();

    // Reject flow
    if (action === 'REJECT') {
      requirePermission(admin, 'refund:approve_l1');

      if (refund.status !== 'PENDING' && refund.status !== 'APPROVED_L1') {
        return NextResponse.json(
          { error: `현재 상태(${refund.status})에서는 거절할 수 없습니다.` },
          { status: 400 },
        );
      }

      const updated = await prisma.refundRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectReason: reason ?? '거절',
        },
      });

      await logAdminAction(admin, 'REFUND_REJECT', 'RefundRequest', id, reason ?? '환불 거절', req, {
        previousValue: { status: refund.status },
        newValue: { status: 'REJECTED' },
        metadata: { amount: refund.amount, userId: refund.userId },
      });

      return NextResponse.json({ refund: updated });
    }

    // Approve flow — two-level approval
    if (refund.status === 'PENDING') {
      // L1 approval
      requirePermission(admin, 'refund:approve_l1');

      // Cannot approve own request
      if (refund.l1ApprovedById === admin.id) {
        return NextResponse.json({ error: '본인이 생성한 요청은 승인할 수 없습니다.' }, { status: 400 });
      }

      const updated = await prisma.refundRequest.update({
        where: { id },
        data: {
          status: 'APPROVED_L1',
          l1ApprovedById: admin.id,
          l1ApprovedAt: now,
        },
      });

      await logAdminAction(admin, 'REFUND_APPROVE_L1', 'RefundRequest', id, reason ?? '1차 승인', req, {
        previousValue: { status: 'PENDING' },
        newValue: { status: 'APPROVED_L1' },
        metadata: { amount: refund.amount, userId: refund.userId },
      });

      return NextResponse.json({ refund: updated, message: '1차 승인 완료. 2차 승인이 필요합니다.' });

    } else if (refund.status === 'APPROVED_L1') {
      // L2 approval — requires higher permission
      requirePermission(admin, 'refund:approve_l2');

      // L2 approver must be different from L1
      if (refund.l1ApprovedById === admin.id) {
        return NextResponse.json(
          { error: '1차 승인자와 동일인은 2차 승인할 수 없습니다.' },
          { status: 400 },
        );
      }

      // Execute refund in transaction
      const result = await prisma.$transaction(async (tx) => {
        // Credit the user
        const updatedUser = await tx.user.update({
          where: { id: refund.userId },
          data: { credits: { increment: refund.amount } },
          select: { id: true, credits: true },
        });

        // Create ledger entry
        await tx.creditLedger.create({
          data: {
            userId: refund.userId,
            type: 'REFUND',
            amount: refund.amount,
            balanceAfter: updatedUser.credits,
            referenceType: 'REFUND_REQUEST',
            referenceId: id,
            description: `환불 처리: ${refund.reason}`,
            adminId: admin.id,
          },
        });

        // Update refund status
        const updatedRefund = await tx.refundRequest.update({
          where: { id },
          data: {
            status: 'EXECUTED',
            l2ApprovedById: admin.id,
            l2ApprovedAt: now,
            executedAt: now,
          },
        });

        return { updatedUser, updatedRefund };
      });

      await logAdminAction(admin, 'REFUND_EXECUTE', 'RefundRequest', id, reason ?? '환불 실행', req, {
        previousValue: { status: 'APPROVED_L1', userCredits: refund.user.credits },
        newValue: { status: 'EXECUTED', userCredits: result.updatedUser.credits },
        metadata: { amount: refund.amount, userId: refund.userId },
      });

      return NextResponse.json({
        refund: result.updatedRefund,
        message: '환불이 실행되었습니다.',
        newBalance: result.updatedUser.credits,
      });

    } else {
      return NextResponse.json(
        { error: `현재 상태(${refund.status})에서는 승인할 수 없습니다.` },
        { status: 400 },
      );
    }
  } catch (err) {
    return handleError(err);
  }
}
