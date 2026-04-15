import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 분당 3회, 시간당 10회
    const rl = await withRateLimit(req, { maxPerMinute: 3, maxPerHour: 10 });
    if (!rl.allowed) return rl.response!;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 },
      );
    }

    const userId = session.user.id;

    const body = await req.json();
    const { amount, reason } = body as {
      amount?: number;
      reason?: string;
    };

    // amount 검증
    if (amount === undefined || amount === null || typeof amount !== "number") {
      return NextResponse.json(
        { error: "환불 금액을 입력해주세요." },
        { status: 400 },
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: "환불 금액은 0보다 커야 합니다." },
        { status: 400 },
      );
    }

    // reason 검증
    if (!reason || typeof reason !== "string" || reason.trim().length < 10) {
      return NextResponse.json(
        { error: "환불 사유를 10자 이상 입력해주세요." },
        { status: 400 },
      );
    }

    // 트랜잭션으로 크레딧 확인 + 중복 체크 + 생성을 원자적으로 수행
    const refundRequest = await prisma.$transaction(async (tx) => {
      // 유저 크레딧 확인
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });

      if (!user) {
        throw Object.assign(new Error("유저 정보를 찾을 수 없습니다."), { status: 404 });
      }

      if (amount > Number(user.credits)) {
        throw Object.assign(new Error("환불 금액이 보유 크레딧을 초과합니다."), { status: 400 });
      }

      // 동일 유저의 PENDING 상태 환불 요청이 이미 있는지 확인
      const existingPending = await tx.refundRequest.findFirst({
        where: { userId, status: "PENDING" },
      });

      if (existingPending) {
        throw Object.assign(new Error("이미 처리 대기 중인 환불 요청이 있습니다."), { status: 409 });
      }

      return tx.refundRequest.create({
        data: { userId, amount, reason: reason.trim() },
      });
    });

    return NextResponse.json(refundRequest, { status: 201 });
  } catch (e: any) {
    if (e?.status && e?.message) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Refund request error:", e);
    return NextResponse.json(
      { error: "환불 요청 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 },
      );
    }

    const refundRequests = await prisma.refundRequest.findMany({
      where: { userId: session.user.id },
      orderBy: { requestedAt: "desc" },
      take: 20,
    });

    return NextResponse.json(refundRequests);
  } catch (e) {
    console.error("Refund list error:", e);
    return NextResponse.json(
      { error: "환불 요청 목록 조회 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
