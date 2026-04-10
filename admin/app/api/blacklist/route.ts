import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashPhone(phone: string): string {
  return crypto.createHash('sha256').update(phone).digest('hex');
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return '***';
  return phone.slice(0, 3) + '-****-' + phone.slice(-4);
}

function handleError(err: unknown): NextResponse {
  if (err instanceof Error) {
    const status = (err as any).status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  console.error('[API] blacklist:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  phone: z.string().optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const addSchema = z.object({
  phoneNumber: z.string().min(8, '전화번호를 입력하세요.'),
  type: z.string().min(1, '유형을 입력하세요.'),
  reason: z.string().min(5, '사유를 5자 이상 입력하세요.'),
  isGlobal: z.boolean().optional().default(true),
  userId: z.string().optional(),
});

const removeSchema = z.object({
  id: z.string().min(1, 'ID를 입력하세요.'),
  reason: z.string().min(5, '사유를 5자 이상 입력하세요.'),
});

// ---------------------------------------------------------------------------
// GET /api/blacklist — List blacklist entries
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'blacklist:read');

    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const parsed = querySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 검색 파라미터입니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { phone, type, page, limit } = parsed.data;

    const where: any = {};

    if (phone) {
      // Search by hash for exact match
      where.phoneHash = hashPhone(phone);
    }

    if (type) {
      where.type = type;
    }

    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      prisma.blacklist.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.blacklist.count({ where }),
    ]);

    // Mask phone numbers
    const masked = entries.map((e) => ({
      ...e,
      phoneNumber: maskPhone(e.phoneNumber),
    }));

    return NextResponse.json({ entries: masked, total, page, limit });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/blacklist — Add to blacklist
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'blacklist:manage');

    const body = await request.json();
    const parsed = addSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { phoneNumber, type, reason, isGlobal, userId } = parsed.data;
    const phoneHash = hashPhone(phoneNumber);

    // Check if already exists
    const existing = await prisma.blacklist.findFirst({
      where: {
        phoneHash,
        userId: userId ?? null,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: '이미 블랙리스트에 등록된 번호입니다.' },
        { status: 409 },
      );
    }

    const entry = await prisma.blacklist.create({
      data: {
        phoneNumber,
        phoneHash,
        type,
        reason,
        isGlobal,
        userId: userId ?? null,
        createdById: admin.id,
      },
    });

    await logAdminAction(
      admin,
      'BLACKLIST_ADD',
      'Blacklist',
      entry.id,
      reason,
      request,
      {
        newValue: {
          phoneNumber: maskPhone(phoneNumber),
          type,
          isGlobal,
          userId,
        },
      },
    );

    return NextResponse.json({
      entry: { ...entry, phoneNumber: maskPhone(entry.phoneNumber) },
    }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/blacklist — Remove from blacklist
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'blacklist:manage');

    const body = await request.json();
    const parsed = removeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { id, reason } = parsed.data;

    const entry = await prisma.blacklist.findUnique({ where: { id } });

    if (!entry) {
      return NextResponse.json({ error: '블랙리스트 항목을 찾을 수 없습니다.' }, { status: 404 });
    }

    await prisma.blacklist.delete({ where: { id } });

    await logAdminAction(
      admin,
      'BLACKLIST_REMOVE',
      'Blacklist',
      id,
      reason,
      request,
      {
        previousValue: {
          phoneNumber: maskPhone(entry.phoneNumber),
          type: entry.type,
          isGlobal: entry.isGlobal,
        },
      },
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleError(err);
  }
}
