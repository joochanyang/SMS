import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { logAdminAction } from '@/lib/audit';
import bcrypt from 'bcryptjs';
import { handleApiError } from '@shared/api-error';
import type { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']).optional(),
  minCredits: z.coerce.number().optional(),
  maxCredits: z.coerce.number().optional(),
  sortBy: z.enum(['createdAt', 'credits', 'name', 'username']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const createUserSchema = z.object({
  username: z.string().min(3, '아이디는 최소 3자 이상이어야 합니다.'),
  name: z.string().min(1, '이름을 입력하세요.'),
  password: z.string().min(8, '비밀번호는 최소 8자 이상이어야 합니다.'),
  telegramId: z.string().trim().min(1).optional(),
}).strict();

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
    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { telegramId: { contains: search, mode: 'insensitive' } },
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
          username: true,
          email: true,
          telegramId: true,
          name: true,
          credits: true,
          costPerMessage: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          suspendedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({ users, total, page, limit });
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

    const { username, name, password, telegramId } = parsed.data;

    // 아이디 중복 검사
    const existingUsername = await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existingUsername) {
      return NextResponse.json({ error: '이미 등록된 아이디입니다.' }, { status: 409 });
    }

    // 텔레그램 아이디 중복 검사 (입력 시에만)
    if (telegramId) {
      const existingTg = await prisma.user.findUnique({
        where: { telegramId },
        select: { id: true },
      });
      if (existingTg) {
        return NextResponse.json({ error: '이미 등록된 텔레그램 아이디입니다.' }, { status: 409 });
      }
    }

    // 유저 로그인(lib/auth.ts)이 bcrypt.compare를 사용하므로 bcrypt로 해싱
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        name,
        passwordHash,
        credits: 0,
        ...(telegramId && { telegramId }),
      },
      select: {
        id: true,
        username: true,
        telegramId: true,
        name: true,
        credits: true,
        status: true,
        createdAt: true,
      },
    });

    await logAdminAction(admin, 'USER_CREATE', 'User', user.id, `유저 생성: ${username}`, request, {
      newValue: { username, name, telegramId, credits: 0 },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'users');
  }
}
