import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 분당 5회, 시간당 30회 (쿠폰 브루트포스 방지)
    const rl = await withRateLimit(req, { maxPerMinute: 5, maxPerHour: 30 });
    if (!rl.allowed) return rl.response!;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const code = (body.code as string)?.trim().toUpperCase();

    if (!code) {
      return NextResponse.json({ error: "쿠폰 코드를 입력하세요." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const coupon = await tx.creditCoupon.findUnique({ where: { code } });

      if (!coupon) {
        throw new RedeemError("유효하지 않은 쿠폰 코드입니다.", 404);
      }

      if (coupon.isUsed) {
        throw new RedeemError("이미 사용된 쿠폰입니다.", 409);
      }

      if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        throw new RedeemError("만료된 쿠폰입니다.", 410);
      }

      await tx.creditCoupon.update({
        where: { id: coupon.id },
        data: {
          isUsed: true,
          usedById: session.user.id,
          usedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: session.user.id },
        data: { credits: { increment: coupon.amount } },
      });

      await tx.transaction.create({
        data: {
          userId: session.user.id,
          amount: coupon.amount,
          type: "DEPOSIT",
          description: `쿠폰 충전: ${coupon.code} ($${coupon.amount})`,
        },
      });

      return { amount: coupon.amount, description: coupon.description };
    });

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { credits: true },
    });

    return NextResponse.json({
      success: true,
      credited: result.amount,
      description: result.description,
      newBalance: user?.credits ?? 0,
    });
  } catch (e) {
    if (e instanceof RedeemError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Redeem coupon error:", e);
    return NextResponse.json({ error: "쿠폰 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}

class RedeemError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
