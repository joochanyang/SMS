import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { withRateLimit } from '@/lib/api-rate-limit';
import { logger, toLogError } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 분당 3회, 시간당 10회
    const rl = await withRateLimit(request, { maxPerMinute: 3, maxPerHour: 10 });
    if (!rl.allowed) return rl.response!;

    const setupSecret = process.env.SETUP_SECRET;
    if (!setupSecret) {
      return NextResponse.json({ error: '셋업이 비활성화되어 있습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const { secret, password } = body as { secret?: string; password?: string };

    if (
      !secret ||
      secret.length !== setupSecret.length ||
      !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(setupSecret))
    ) {
      return NextResponse.json({ error: '접근이 거부되었습니다.' }, { status: 403 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: '비밀번호는 최소 8자 이상이어야 합니다.' },
        { status: 400 }
      );
    }

    const adminUsername = 'admin';

    const existingUser = await prisma.user.findUnique({
      where: { username: adminUsername }
    });

    if (existingUser) {
      return NextResponse.json({ message: '관리자 계정이 이미 존재합니다.' }, { status: 200 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        username: adminUsername,
        passwordHash: hashedPassword,
        name: '관리자',
        credits: 1000.0
      }
    });

    return NextResponse.json({
      message: '관리자 계정이 생성되었습니다.',
      user: { username: adminUsername }
    }, { status: 201 });

  } catch (error) {
    logger.error('Setup error', { error: toLogError(error) });
    return NextResponse.json({ error: '셋업 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
