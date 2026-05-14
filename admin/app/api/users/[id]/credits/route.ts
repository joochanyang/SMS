import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import { requireSudo } from '@/lib/sudo';
import { handleApiError } from '@shared/api-error';

// ---------------------------------------------------------------------------
// CRITICAL: Credit adjustment — real money operations
// Requirements: transaction, atomic, idempotency, audit trail
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const creditAdjustSchema = z
  .object({
    unit: z.enum(['KRW', 'COUNT']).default('KRW'),
    amount: z.number().optional(),
    count: z.number().int().min(1, '1건 이상 입력하세요.').max(1_000_000, '최대 1,000,000건까지 가능합니다.').optional(),
    type: z.enum(['ADMIN_ADD', 'ADMIN_DEDUCT', 'CORRECTION', 'BONUS']),
    reason: z.string().min(10, '사유를 10자 이상 입력하세요.'),
    idempotencyKey: z.string().uuid('유효한 멱등성 키를 입력하세요.'),
  })
  .refine(
    (d) => {
      if (d.unit === 'KRW') return d.amount !== undefined && d.amount !== 0;
      return d.count !== undefined;
    },
    { message: '단위에 맞는 값을 입력하세요.' },
  );

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function getKstDayRange(now = new Date()): { start: Date; end: Date } {
  const startMs = Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

// ---------------------------------------------------------------------------
// POST /api/users/[id]/credits — Credit adjustment (CRITICAL)
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    await requireSudo(req, admin);
    const { id } = await context.params;

    const body = await req.json();
    const parsed = creditAdjustSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { unit, amount, count, type, reason, idempotencyKey } = parsed.data;

    // 타입과 부호 일관성 검증: ADMIN_ADD는 양수, ADMIN_DEDUCT는 음수여야 함
    if (unit === 'KRW' && amount !== undefined) {
      if (type === 'ADMIN_ADD' && amount < 0) {
        return NextResponse.json(
          { error: 'ADMIN_ADD 유형은 양수 금액이어야 합니다. 차감은 ADMIN_DEDUCT 유형을 사용하세요.' },
          { status: 400 },
        );
      }
      if (type === 'ADMIN_DEDUCT' && amount > 0) {
        return NextResponse.json(
          { error: 'ADMIN_DEDUCT 유형은 음수 금액이어야 합니다. 지급은 ADMIN_ADD 유형을 사용하세요.' },
          { status: 400 },
        );
      }
    }

    // Check idempotency — prevent duplicate operations
    const existingLedger = await prisma.creditLedger.findUnique({
      where: { idempotencyKey },
    });

    if (existingLedger) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        newBalance: existingLedger.balanceAfter,
        adjustment: existingLedger.amount,
        unit,
        count: unit === 'COUNT' ? count : undefined,
        ledger: existingLedger,
      });
    }

    const isDeduction =
      type === 'ADMIN_DEDUCT' || (unit === 'KRW' && (amount ?? 0) < 0);

    // CRITICAL: Atomic transaction — balance check + credit update + ledger entry
    const result = await prisma.$transaction(async (tx) => {
      const adminRecord = await tx.adminUser.findUnique({
        where: { id: admin.id },
        select: { id: true, dailyCreditLimit: true },
      });

      if (!adminRecord) {
        throw Object.assign(new Error('관리자 계정을 찾을 수 없습니다.'), { status: 401 });
      }

      // Balance check INSIDE transaction to prevent TOCTOU
      const user = await tx.user.findUnique({
        where: { id },
        select: { id: true, email: true, credits: true, status: true, costPerMessage: true },
      });

      if (!user) {
        throw Object.assign(new Error('유저를 찾을 수 없습니다.'), { status: 404 });
      }

      // Compute absolute KRW amount from input (unit-aware)
      const costPerMessage = Number(user.costPerMessage);
      let absAmount: number;
      if (unit === 'COUNT') {
        if (costPerMessage <= 0) {
          throw Object.assign(
            new Error('단가(costPerMessage)가 설정되지 않아 건수 기반 지급/차감이 불가합니다.'),
            { status: 400 },
          );
        }
        absAmount = (count as number) * costPerMessage;
      } else {
        absAmount = Math.abs(amount as number);
      }

      // Permission check (inside tx so rollback on throw): small vs large
      const LARGE_THRESHOLD = 100_000;
      if (absAmount > LARGE_THRESHOLD) {
        requirePermission(admin, 'credit:adjust_large');
      } else {
        requirePermission(admin, 'credit:adjust_small');
      }

      const userCredits = Number(user.credits);
      if (isDeduction && userCredits < absAmount) {
        throw Object.assign(
          new Error(
            `잔액 부족: 현재 ${userCredits.toLocaleString('ko-KR')}원, 차감 요청 ${absAmount.toLocaleString('ko-KR')}원`,
          ),
          { status: 400, code: 'INSUFFICIENT_BALANCE', currentBalance: userCredits },
        );
      }

      const creditChange = isDeduction ? -absAmount : absAmount;
      if (creditChange > 0) {
        const { start, end } = getKstDayRange();
        const todaySum = await tx.creditLedger.aggregate({
          where: {
            adminId: admin.id,
            referenceType: 'ADMIN_ADJUSTMENT',
            amount: { gt: 0 },
            createdAt: { gte: start, lt: end },
          },
          _sum: { amount: true },
        });

        const usedToday = Number(todaySum._sum.amount ?? 0);
        const dailyLimit = Number(adminRecord.dailyCreditLimit);
        if (usedToday + creditChange > dailyLimit) {
          throw Object.assign(
            new Error(
              `관리자 일일 지급 한도 초과: 한도 ${dailyLimit.toLocaleString('ko-KR')}원, 오늘 사용 ${usedToday.toLocaleString('ko-KR')}원, 요청 ${creditChange.toLocaleString('ko-KR')}원`,
            ),
            { status: 403 },
          );
        }
      }

      const updatedUser = await tx.user.update({
        where: { id },
        data: { credits: { increment: creditChange } },
        select: { id: true, credits: true },
      });

      const description =
        unit === 'COUNT'
          ? `건수 ${(count as number).toLocaleString('ko-KR')}건 ${isDeduction ? '차감' : '지급'} (단가 ${costPerMessage.toLocaleString('ko-KR')}원, 환산 ${absAmount.toLocaleString('ko-KR')}원) — ${reason}`
          : reason;

      const ledger = await tx.creditLedger.create({
        data: {
          userId: id,
          type,
          amount: creditChange,
          balanceAfter: updatedUser.credits,
          referenceType: 'ADMIN_ADJUSTMENT',
          referenceId: admin.id,
          description,
          adminId: admin.id,
          idempotencyKey,
        },
      });

      return { user, updatedUser, ledger, absAmount, costPerMessage };
    });

    // Audit log (outside transaction — non-blocking)
    await logAdminAction(admin, 'CREDIT_ADJUST', 'User', id, reason, req, {
      previousValue: { credits: result.user.credits },
      newValue: { credits: result.updatedUser.credits },
      metadata: {
        unit,
        amount: isDeduction ? -result.absAmount : result.absAmount,
        count: unit === 'COUNT' ? count : undefined,
        costPerMessage: result.costPerMessage,
        type,
        idempotencyKey,
        ledgerId: result.ledger.id,
      },
    });

    return NextResponse.json({
      success: true,
      previousBalance: result.user.credits,
      newBalance: result.updatedUser.credits,
      adjustment: isDeduction ? -result.absAmount : result.absAmount,
      unit,
      count: unit === 'COUNT' ? count : undefined,
      costPerMessage: result.costPerMessage,
      ledger: result.ledger,
    });
  } catch (err) {
    const apiError = err as { status?: number; message?: string; requireSudo?: boolean };
    if (apiError.status && apiError.message) {
      const response: { error: string; requireSudo?: boolean } = { error: apiError.message };
      if (apiError.requireSudo) response.requireSudo = true;
      return NextResponse.json(response, { status: apiError.status });
    }
    return handleApiError(err, 'users/[id]/credits');
  }
}
