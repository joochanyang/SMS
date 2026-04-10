import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission, isRoleAtLeast } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const querySchema = z.object({
  adminId: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  result: z.enum(['SUCCESS', 'FAILURE']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
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
  console.error('[API] audit:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// GET /api/audit — Audit log query
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'audit:read');

    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const parsed = querySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 검색 파라미터입니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { adminId, action, targetType, targetId, dateFrom, dateTo, result, page, limit } = parsed.data;

    const where: any = {};

    // ADMIN sees own logs only, SUPER_ADMIN sees all
    if (!isRoleAtLeast(admin.role, 'SUPER_ADMIN')) {
      where.adminId = admin.id;
    } else if (adminId) {
      where.adminId = adminId;
    }

    if (action) where.action = action;
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;
    if (result) where.result = result;

    if (dateFrom || dateTo) {
      where.timestamp = {};
      if (dateFrom) where.timestamp.gte = dateFrom;
      if (dateTo) where.timestamp.lte = dateTo;
    }

    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          timestamp: true,
          adminId: true,
          adminEmail: true,
          action: true,
          targetType: true,
          targetId: true,
          previousValue: true,
          newValue: true,
          reason: true,
          ipAddress: true,
          result: true,
          metadata: true,
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Log this query itself in audit (fire-and-forget)
    logAdminAction(
      admin,
      'AUDIT_QUERY',
      'AuditLog',
      undefined,
      '감사 로그 조회',
      request,
      {
        metadata: {
          filters: { adminId, action, targetType, targetId, dateFrom, dateTo, result },
          resultCount: total,
        },
      },
    ).catch(() => { /* swallow audit-of-audit failures */ });

    return NextResponse.json({ logs, total, page, limit });
  } catch (err) {
    return handleError(err);
  }
}
