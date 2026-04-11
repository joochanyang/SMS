import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const setupSecret = process.env.SETUP_SECRET;
    if (!setupSecret) {
      return NextResponse.json({ error: 'Setup disabled.' }, { status: 403 });
    }

    const body = await request.json();
    const { secret, password } = body as { secret?: string; password?: string };

    if (!secret || secret !== setupSecret) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters.' },
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
    console.error('Setup error:', error);
    return NextResponse.json({ error: 'Setup failed.' }, { status: 500 });
  }
}
