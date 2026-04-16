// ---------------------------------------------------------------------------
// Cron API — 만료된 USDT 입금 요청 자동 정리
// PENDING/SUBMITTED/VERIFYING 상태에서 expiresAt이 지난 입금을 EXPIRED로 전환
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";
import { logger, toLogError } from "@/lib/logger";

export async function POST(req: NextRequest) {
  // Rate limit: 분당 5회, 시간당 120회
  const rl = await withRateLimit(req, { maxPerMinute: 5, maxPerHour: 120 });
  if (!rl.allowed) return rl.response!;

  // 인증: CRON_SECRET 검증
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.error("[Cron] CRON_SECRET 환경변수가 설정되지 않았습니다.");
    return NextResponse.json(
      { error: "접근이 거부되었습니다." },
      { status: 403 },
    );
  }

  const expected = `Bearer ${cronSecret}`;
  const isValid =
    authHeader &&
    authHeader.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  if (!isValid) {
    return NextResponse.json(
      { error: "인증이 필요합니다." },
      { status: 401 },
    );
  }

  try {
    const now = new Date();

    // expiresAt < now인 PENDING/SUBMITTED/VERIFYING 입금을 EXPIRED로 일괄 업데이트
    const result = await prisma.usdtDeposit.updateMany({
      where: {
        status: { in: ["PENDING", "SUBMITTED", "VERIFYING"] },
        expiresAt: { lt: now },
      },
      data: {
        status: "EXPIRED",
      },
    });

    logger.info(
      `[Cron] 만료 입금 정리 완료: ${result.count}건 EXPIRED 처리`,
    );

    return NextResponse.json({
      message: `${result.count}건의 만료된 입금 요청을 정리했습니다.`,
      expiredCount: result.count,
    });
  } catch (e) {
    logger.error("[Cron] 만료 입금 정리 오류", { error: toLogError(e) });
    return NextResponse.json(
      { error: "내부 서버 오류입니다." },
      { status: 500 },
    );
  }
}
