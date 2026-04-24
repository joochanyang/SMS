import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { handleApiError } from '@shared/api-error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const masked = local.length <= 2 ? '*'.repeat(local.length) : local.slice(0, 2) + '*'.repeat(local.length - 2);
  return `${masked}@${domain}`;
}


// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const querySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: z.enum(['DRAFT', 'QUEUED', 'SENDING', 'COMPLETED', 'CANCELLED', 'FAILED', 'STOPPED']).optional(),
  userId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'totalRecipients', 'deliveredCount', 'status']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ---------------------------------------------------------------------------
// GET /api/campaigns — List all campaigns
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'campaign:read');

    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const parsed = querySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 검색 파라미터입니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { search, status, userId, dateFrom, dateTo, sortBy, sortOrder, page, limit } = parsed.data;

    const where: any = {};

    if (status) where.status = status === 'STOPPED' ? 'CANCELLED' : status;
    if (userId) where.userId = userId;
    if (search) {
      where.OR = [
        { messageBody: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    const skip = (page - 1) * limit;

    const [campaigns, total] = await Promise.all([
      prisma.smsCampaign.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      }),
      prisma.smsCampaign.count({ where }),
    ]);

    const masked = campaigns.map((c) => ({
      id: c.id,
      userName: c.user.name ?? (c.user.email ? maskEmail(c.user.email) : '-'),
      messagePreview: (c.messageBody ?? '').slice(0, 40),
      total: c.totalRecipients ?? 0,
      sent: c.deliveredCount ?? 0,
      failed: c.failedCount ?? 0,
      status: c.status,
      createdAt: c.createdAt,
      user: {
        ...c.user,
        email: c.user.email ? maskEmail(c.user.email) : null,
      },
    }));

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return NextResponse.json({ campaigns: masked, total, totalPages, page, limit });
  } catch (err) {
    return handleApiError(err, 'campaigns');
  }
}
