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

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@sovereign.com';

    const existingUser = await prisma.user.findUnique({
      where: { email: adminEmail }
    });

    if (existingUser) {
      return NextResponse.json({ message: 'Admin user already exists.' }, { status: 200 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: hashedPassword,
        name: 'Sovereign Admin',
        credits: 1000.0
      }
    });

    return NextResponse.json({
      message: 'Admin user created successfully.',
      user: { email: adminEmail }
    }, { status: 201 });

  } catch (error) {
    console.error('Setup error:', error);
    return NextResponse.json({ error: 'Setup failed.' }, { status: 500 });
  }
}
