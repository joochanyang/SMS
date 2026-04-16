// ---------------------------------------------------------------------------
// Cron API — QUEUED/SENDING 캠페인 자동 처리
// 외부 cron 서비스에서 GET 요청으로 호출 (Authorization: Bearer {CRON_SECRET})
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";
import {
  processCampaignBatch,
  CampaignProcessError,
} from "@/lib/campaign-processor";
import { logger, toLogError } from "@/lib/logger";

/** 캠페인당 한 cron 실행에서 최대 배치 반복 횟수 */
const MAX_BATCHES_PER_CAMPAIGN = 3;

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
  const isValid = authHeader &&
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

    // 예약 시간이 도달한 SCHEDULED 캠페인을 QUEUED로 전환
    await prisma.smsCampaign.updateMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { lte: now },
      },
      data: { status: "QUEUED" },
    });

    // QUEUED 또는 SENDING 상태의 캠페인을 createdAt 순으로 조회
    // 쿨다운 중인 캠페인 제외
    const campaigns = await prisma.smsCampaign.findMany({
      where: {
        status: { in: ["QUEUED", "SENDING"] },
        OR: [
          { cooldownUntil: null },
          { cooldownUntil: { lte: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        status: true,
        updatedAt: true,
      },
    });

    if (campaigns.length === 0) {
      return NextResponse.json({
        message: "처리할 캠페인이 없습니다.",
        processed: 0,
      });
    }

    const results: Array<{
      campaignId: string;
      batches: number;
      totalProcessed: number;
      finalStatus: string;
      error?: string;
    }> = [];

    for (const campaign of campaigns) {
      let batchesRun = 0;
      let totalProcessed = 0;
      let finalStatus = campaign.status;
      let errorMsg: string | undefined;

      // 낙관적 잠금: updatedAt 기반 충돌 방지
      const lockCheck = await prisma.smsCampaign.findUnique({
        where: { id: campaign.id },
        select: { updatedAt: true, status: true },
      });

      if (!lockCheck) continue;

      // 다른 프로세스가 이미 업데이트했으면 스킵
      if (lockCheck.updatedAt.getTime() !== campaign.updatedAt.getTime()) {
        results.push({
          campaignId: campaign.id,
          batches: 0,
          totalProcessed: 0,
          finalStatus: lockCheck.status,
          error: "다른 프로세스에서 처리 중입니다.",
        });
        continue;
      }

      // 캠페인당 최대 MAX_BATCHES_PER_CAMPAIGN 회 배치 처리
      for (let i = 0; i < MAX_BATCHES_PER_CAMPAIGN; i++) {
        try {
          const result = await processCampaignBatch(
            campaign.id,
            campaign.userId,
          );

          batchesRun++;
          totalProcessed += result.processed;
          finalStatus = result.status;

          // 완료 또는 더 이상 처리할 게 없으면 중단
          if (
            result.remaining === 0 ||
            result.status === "COMPLETED" ||
            result.status === "FAILED" ||
            result.status === "CANCELLED"
          ) {
            break;
          }
        } catch (e) {
          if (e instanceof CampaignProcessError) {
            errorMsg = e.message;
            if (e.code === "COOLDOWN" || e.code === "PROVIDER_ERROR") {
              // 쿨다운이나 발송 오류 시 해당 캠페인 중단, 다음 캠페인으로
              break;
            }
          } else {
            logger.error(
              `[Cron] 캠페인 ${campaign.id} 처리 중 오류`,
              { error: toLogError(e) },
            );
            errorMsg = "내부 오류가 발생했습니다.";
          }
          break;
        }
      }

      results.push({
        campaignId: campaign.id,
        batches: batchesRun,
        totalProcessed,
        finalStatus,
        ...(errorMsg && { error: errorMsg }),
      });
    }

    return NextResponse.json({
      message: `${results.length}개 캠페인 처리 완료`,
      campaigns: results,
    });
  } catch (e) {
    logger.error("[Cron] 캠페인 자동 처리 오류", { error: toLogError(e) });
    return NextResponse.json(
      { error: "내부 서버 오류입니다." },
      { status: 500 },
    );
  }
}
