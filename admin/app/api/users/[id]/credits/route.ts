import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission, hasPermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// CRITICAL: Credit adjustment — real money operations
// Requirements: transaction, atomic, idempotency, audit trail
// ---------------------------------------------------------------------------

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
  console.error('[API] users/[id]/credits:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const creditAdjustSchema = z.object({
  amount: z.number().refine((v) => v !== 0, '금액은 0이 될 수 없습니다.'),
  type: z.enum(['ADMIN_ADD', 'ADMIN_DEDUCT', 'CORRECTION', 'BONUS']),
  reason: z.string().min(10, '사유를 10자 이상 입력하세요.'),
  idempotencyKey: z.string().min(1, '멱등성 키를 입력하세요.').optional(),
});

// ---------------------------------------------------------------------------
// POST /api/users/[id]/credits — Credit adjustment (CRITICAL)
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    const { id } = await context.params;

    const body = await req.json();
    const parsed = creditAdjustSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { amount, type, reason, idempotencyKey } = parsed.data;
    const absAmount = Math.abs(amount);

    // Permission check: small vs large adjustment
    // Small: <= 100,000 KRW, Large: > 100,000 KRW
    const LARGE_THRESHOLD = 100_000;
    if (absAmount > LARGE_THRESHOLD) {
      requirePermission(admin, 'credit:adjust_large');
    } else {
      requirePermission(admin, 'credit:adjust_small');
    }

    // Generate idempotency key if not provided
    const idemKey = idempotencyKey ?? crypto.randomUUID();

    // Check idempotency — prevent duplicate operations
    const existingLedger = await prisma.creditLedger.findUnique({
      where: { idempotencyKey: idemKey },
    });

    if (existingLedger) {
      return NextResponse.json(
        { error: '이미 처리된 요청입니다.', ledger: existingLedger },
        { status: 409 },
      );
    }

    const isDeduction = type === 'ADMIN_DEDUCT' || amount < 0;

    // CRITICAL: Atomic transaction — balance check + credit update + ledger entry
    const result = await prisma.$transaction(async (tx) => {
      // Balance check INSIDE transaction to prevent TOCTOU
      const user = await tx.user.findUnique({
        where: { id },
        select: { id: true, email: true, credits: true, status: true },
      });

      if (!user) {
        throw Object.assign(new Error('유저를 찾을 수 없습니다.'), { status: 404 });
      }

      const userCredits = Number(user.credits);
      if (isDeduction && userCredits < absAmount) {
        throw Object.assign(
          new Error(`잔액 부족: 현재 ${userCredits.toLocaleString('ko-KR')}원, 차감 요청 ${absAmount.toLocaleString('ko-KR')}원`),
          { status: 400, code: 'INSUFFICIENT_BALANCE', currentBalance: userCredits },
        );
      }

      const creditChange = isDeduction ? -absAmount : absAmount;

      const updatedUser = await tx.user.update({
        where: { id },
        data: { credits: { increment: creditChange } },
        select: { id: true, credits: true },
      });

      const ledger = await tx.creditLedger.create({
        data: {
          userId: id,
          type,
          amount: creditChange,
          balanceAfter: updatedUser.credits,
          referenceType: 'ADMIN_ADJUSTMENT',
          referenceId: admin.id,
          description: reason,
          adminId: admin.id,
          idempotencyKey: idemKey,
        },
      });

      return { user, updatedUser, ledger };
    });

    // Audit log (outside transaction — non-blocking)
    await logAdminAction(admin, 'CREDIT_ADJUST', 'User', id, reason, req, {
      previousValue: { credits: result.user.credits },
      newValue: { credits: result.updatedUser.credits },
      metadata: {
        amount: isDeduction ? -absAmount : absAmount,
        type,
        idempotencyKey: idemKey,
        ledgerId: result.ledger.id,
      },
    });

    return NextResponse.json({
      success: true,
      previousBalance: result.user.credits,
      newBalance: result.updatedUser.credits,
      adjustment: isDeduction ? -absAmount : absAmount,
      ledger: result.ledger,
    });
  } catch (err: any) {
    if (err?.status && err?.message) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return handleError(err);
  }
}
