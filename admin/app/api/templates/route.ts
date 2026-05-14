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
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  userId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});


// ---------------------------------------------------------------------------
// GET /api/templates — List message templates
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'template:read');

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

    const where: Prisma.MessageTemplateWhereInput = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const skip = (page - 1) * limit;

    const [templates, total] = await Promise.all([
      prisma.messageTemplate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      }),
      prisma.messageTemplate.count({ where }),
    ]);

    return NextResponse.json({ templates, total, page, limit });
  } catch (err) {
    return handleApiError(err, 'templates');
  }
}
