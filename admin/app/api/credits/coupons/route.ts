import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import crypto from 'crypto';

function generateCode(length = 8): string {
  return crypto.randomBytes(length).toString('hex').toUpperCase().slice(0, length);
}

function handleError(err: unknown): NextResponse {
  if (err instanceof Error) {
    const status = (err as any).status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  console.error('[API] coupons:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

const createSchema = z.object({
  amount: z.number().positive('금액은 0보다 커야 합니다.'),
  count: z.number().int().min(1).max(100).optional().default(1),
  description: z.string().optional(),
  expiresAt: z.coerce.date().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/credits/coupons — List coupons
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'credit:read');

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
    const skip = (page - 1) * limit;

    const [coupons, total] = await Promise.all([
      prisma.creditCoupon.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.creditCoupon.count(),
    ]);

    return NextResponse.json({ coupons, total, page, limit });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/credits/coupons — Create coupons
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'credit:adjust_small');

    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { amount, count, description, expiresAt } = parsed.data;

    const coupons = [];
    for (let i = 0; i < count; i++) {
      const code = generateCode(10);
      const coupon = await prisma.creditCoupon.create({
        data: {
          code,
          amount,
          description: description || `크레딧 쿠폰 $${amount}`,
          expiresAt: expiresAt ?? null,
          createdById: admin.id,
        },
      });
      coupons.push(coupon);
    }

    await logAdminAction(
      admin,
      'COUPON_CREATE',
      'CreditCoupon',
      coupons[0].id,
      `쿠폰 ${count}개 생성 (각 $${amount})`,
      request,
      { newValue: { amount, count, codes: coupons.map((c) => c.code) } },
    );

    return NextResponse.json({ coupons }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
