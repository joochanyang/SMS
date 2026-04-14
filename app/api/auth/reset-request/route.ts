import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 분당 3회, 시간당 10회
    const rl = await withRateLimit(req, { maxPerMinute: 3, maxPerHour: 10 });
    if (!rl.allowed) return rl.response!;

    const body = await req.json();
    const { username } = body as { username?: string };

    if (!username || typeof username !== "string") {
      return NextResponse.json(
        { error: "아이디를 입력해주세요." },
        { status: 400 },
      );
    }

    // 정보 유출 방지: 유저 존재 여부와 무관하게 동일한 응답
    const successResponse = NextResponse.json({
      success: true,
      message: "비밀번호 재설정 요청이 처리되었습니다.",
    });

    const user = await prisma.user.findUnique({
      where: { username: username.trim() },
      select: { id: true },
    });

    if (!user) {
      return successResponse;
    }

    // 토큰 생성: 32바이트 hex (64자)
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1시간

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // TODO: 이메일 발송 연동 필요
    // 현재는 토큰만 DB에 저장하며, 이메일 인프라 구축 후 연동 예정
    // 관리자는 DB에서 토큰을 직접 확인하여 유저에게 전달할 수 있음

    return successResponse;
  } catch (e) {
    console.error("Password reset request error:", e);
    return NextResponse.json(
      { error: "비밀번호 재설정 요청 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
