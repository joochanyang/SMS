import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { withRateLimit } from "@/lib/api-rate-limit";

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 분당 3회, 시간당 10회 (회원가입 남용 방지)
    const rl = await withRateLimit(req, { maxPerMinute: 3, maxPerHour: 10 });
    if (!rl.allowed) return rl.response!;

    const body = await req.json();
    const { username, password, name } = body as {
      username?: string;
      password?: string;
      name?: string;
    };

    if (!username || !password) {
      return NextResponse.json(
        { error: "아이디와 비밀번호는 필수입니다." },
        { status: 400 },
      );
    }

    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    if (!usernameRegex.test(username)) {
      return NextResponse.json(
        { error: "아이디는 3~30자의 영문, 숫자, 밑줄(_)만 사용할 수 있습니다." },
        { status: 400 },
      );
    }

    if (password.length < 4) {
      return NextResponse.json(
        { error: "비밀번호는 최소 4자 이상이어야 합니다." },
        { status: 400 },
      );
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json(
        { error: "이미 사용 중인 아이디입니다." },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        name: name?.trim().slice(0, 100) || null,
      },
      select: {
        id: true,
        username: true,
        name: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    console.error("Register error:", e);
    return NextResponse.json(
      { error: "회원가입 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
