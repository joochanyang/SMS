import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { handleApiError } from '@shared/api-error';
import type { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const querySchema = z.object({
  userId: z.string().optional(),
  type: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});


// ---------------------------------------------------------------------------
// GET /api/credits/ledger — Credit ledger (transaction history)
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

    const { userId, type, dateFrom, dateTo, page, limit } = parsed.data;

    const where: Prisma.CreditLedgerWhereInput = {};

    if (userId) where.userId = userId;
    if (type) where.type = type;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      prisma.creditLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, username: true, name: true, costPerMessage: true },
          },
        },
      }),
      prisma.creditLedger.count({ where }),
    ]);

    return NextResponse.json({ entries, total, page, limit });
  } catch (err) {
    return handleApiError(err, 'credits/ledger');
  }
}
