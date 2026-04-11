import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED_L1', 'EXECUTED', 'REJECTED']).optional(),
  userId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const createRefundSchema = z.object({
  userId: z.string().min(1, '유저 ID를 입력하세요.'),
  amount: z.number().positive('환불 금액은 0보다 커야 합니다.'),
  reason: z.string().min(10, '사유를 10자 이상 입력하세요.'),
  evidence: z.any().optional(),
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
  console.error('[API] credits/refunds:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// GET /api/credits/refunds — List refund requests
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'credit:read');

    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const parsed = querySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 검색 파라미터입니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { status, userId, page, limit } = parsed.data;

    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const skip = (page - 1) * limit;

    const [refunds, total] = await Promise.all([
      prisma.refundRequest.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      }),
      prisma.refundRequest.count({ where }),
    ]);

    // Mask emails
    const masked = refunds.map((r) => ({
      ...r,
      user: {
        ...r.user,
        email: r.user.email ? r.user.email.replace(/^(.{2}).*@/, (_, p1: string) => p1 + '***@') : null,
      },
    }));

    return NextResponse.json({ refunds: masked, total, page, limit });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/credits/refunds — Create refund request
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'refund:approve_l1');

    const body = await request.json();
    const parsed = createRefundSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { userId, amount, reason, evidence } = parsed.data;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ error: '유저를 찾을 수 없습니다.' }, { status: 404 });
    }

    const refund = await prisma.refundRequest.create({
      data: {
        userId,
        amount,
        reason,
        evidence: evidence ?? undefined,
        createdById: admin.id,
      },
    });

    await logAdminAction(
      admin,
      'REFUND_CREATE',
      'RefundRequest',
      refund.id,
      reason,
      request,
      { newValue: { userId, amount, reason } },
    );

    return NextResponse.json({ refund }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
