import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import { validatePasswordPolicy } from '@/lib/admin-auth';
import bcrypt from 'bcryptjs';
import { handleApiError } from '@shared/api-error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskPhone(phone: string): string {
  if (!phone || phone.length < 8) return '***';
  return phone.slice(0, 3) + '-****-' + phone.slice(-4);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const masked = local.length <= 2 ? '*'.repeat(local.length) : local.slice(0, 2) + '*'.repeat(local.length - 2);
  return `${masked}@${domain}`;
}


// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']).optional(),
  minCredits: z.coerce.number().optional(),
  maxCredits: z.coerce.number().optional(),
  sortBy: z.enum(['createdAt', 'credits', 'name', 'email']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const createUserSchema = z.object({
  email: z.string().email('유효한 이메일을 입력하세요.'),
  name: z.string().min(1, '이름을 입력하세요.'),
  password: z.string().min(8, '비밀번호는 최소 8자 이상이어야 합니다.'),
  credits: z.number().min(0).optional().default(0),
  dailySendLimit: z.number().int().min(0).optional(),
  maxCampaignSize: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/users — List users
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'user:read');

    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const parsed = searchSchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '잘못된 검색 파라미터입니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { search, status, minCredits, maxCredits, sortBy, sortOrder, page, limit } = parsed.data;

    // Build where clause
    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (minCredits !== undefined || maxCredits !== undefined) {
      where.credits = {};
      if (minCredits !== undefined) where.credits.gte = minCredits;
      if (maxCredits !== undefined) where.credits.lte = maxCredits;
    }

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          credits: true,
          costPerMessage: true,
          status: true,
          dailySendLimit: true,
          maxCampaignSize: true,
          createdAt: true,
          updatedAt: true,
          suspendedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Mask sensitive data
    const masked = users.map((u) => ({
      ...u,
      email: u.email ? maskEmail(u.email) : null,
    }));

    return NextResponse.json({ users: masked, total, page, limit });
  } catch (err) {
    return handleApiError(err, 'users');
  }
}

// ---------------------------------------------------------------------------
// POST /api/users — Create user
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'user:create');

    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '입력값이 올바르지 않습니다.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { email, name, password, credits, dailySendLimit, maxCampaignSize } = parsed.data;

    // Check duplicate by username OR email (username is unique, email column is not)
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: email }, { email }] },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: '이미 등록된 계정입니다.' }, { status: 409 });
    }

    // 유저 로그인(lib/auth.ts)이 bcrypt.compare를 사용하므로 bcrypt로 해싱
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username: email,
        email,
        name,
        passwordHash,
        credits,
        ...(dailySendLimit !== undefined && { dailySendLimit }),
        ...(maxCampaignSize !== undefined && { maxCampaignSize }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        credits: true,
        status: true,
        dailySendLimit: true,
        maxCampaignSize: true,
        createdAt: true,
      },
    });

    await logAdminAction(admin, 'USER_CREATE', 'User', user.id, `유저 생성: ${email}`, request, {
      newValue: { email, name, credits, dailySendLimit, maxCampaignSize },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'users');
  }
}
