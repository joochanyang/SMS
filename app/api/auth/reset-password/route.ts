import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 분당 5회, 시간당 20회
    const rl = await withRateLimit(req, { maxPerMinute: 5, maxPerHour: 20 });
    if (!rl.allowed) return rl.response!;

    const body = await req.json();
    const { token, newPassword } = body as {
      token?: string;
      newPassword?: string;
    };

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "유효하지 않은 토큰입니다." },
        { status: 400 },
      );
    }

    if (!newPassword || typeof newPassword !== "string") {
      return NextResponse.json(
        { error: "새 비밀번호를 입력해주세요." },
        { status: 400 },
      );
    }

    // 비밀번호 정책: 8자 이상 + 영문+숫자 (register와 동일)
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "비밀번호는 최소 8자 이상이어야 합니다." },
        { status: 400 },
      );
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return NextResponse.json(
        { error: "비밀번호에 영문과 숫자를 모두 포함해야 합니다." },
        { status: 400 },
      );
    }

    // 토큰 검증: 존재 + 미사용 + 미만료
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetToken) {
      return NextResponse.json(
        { error: "유효하지 않은 토큰입니다." },
        { status: 400 },
      );
    }

    if (resetToken.usedAt) {
      return NextResponse.json(
        { error: "이미 사용된 토큰입니다." },
        { status: 400 },
      );
    }

    if (new Date() > resetToken.expiresAt) {
      return NextResponse.json(
        { error: "만료된 토큰입니다. 비밀번호 재설정을 다시 요청해주세요." },
        { status: 400 },
      );
    }

    // 트랜잭션: 비밀번호 변경 + 토큰 사용 처리 + 잠금 해제
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: "비밀번호가 변경되었습니다.",
    });
  } catch (e) {
    console.error("Password reset error:", e);
    return NextResponse.json(
      { error: "비밀번호 변경 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
