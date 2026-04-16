import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  processCampaignBatch,
  CampaignProcessError,
} from "@/lib/campaign-processor";
import { withRateLimit } from "@/lib/api-rate-limit";
import { logger, toLogError } from "@/lib/logger";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Rate limit: 분당 30회, 시간당 300회
  const rl = await withRateLimit(req, { maxPerMinute: 30, maxPerHour: 300 });
  if (!rl.allowed) return rl.response!;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await context.params;

  let batchSize: number | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { batchSize?: number };
    if (typeof body.batchSize === "number") batchSize = body.batchSize;
  } catch {
    // 무시
  }

  try {
    const result = await processCampaignBatch(id, session.user.id, batchSize);

    // 폴링 한 번으로 캠페인 최신 상태까지 받을 수 있도록 함께 반환
    const campaign = await prisma.smsCampaign.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        processedCount: true,
        totalRecipients: true,
        failedCount: true,
        deliveredCount: true,
      },
    });

    return NextResponse.json(
      {
        ...result,
        campaign,
      },
      { status: 200 },
    );
  } catch (e) {
    if (e instanceof CampaignProcessError) {
      switch (e.code) {
        case "NOT_FOUND":
          return NextResponse.json({ error: e.message }, { status: 404 });
        case "COOLDOWN":
          return NextResponse.json(
            {
              status: "SENDING",
              cooldownUntil: e.meta?.cooldownUntil,
              retryAfterMs: e.meta?.retryAfterMs,
            },
            { status: 429 },
          );
        case "PROVIDER_ERROR":
          return NextResponse.json({ error: e.message }, { status: 502 });
        case "KILL_SWITCH":
          return NextResponse.json({ error: e.message }, { status: 503 });
      }
    }

    logger.error("캠페인 처리 오류", { error: toLogError(e) });
    return NextResponse.json({ error: "내부 서버 오류입니다." }, { status: 500 });
  }
}
