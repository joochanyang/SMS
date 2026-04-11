import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Rate limit: 분당 10회, 시간당 60회
  const rl = await withRateLimit(req, { maxPerMinute: 10, maxPerHour: 60 });
  if (!rl.allowed) return rl.response!;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { id: campaignId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { logIds?: string[] };
  const logIds = body.logIds;

  if (!Array.isArray(logIds) || logIds.length === 0) {
    return NextResponse.json({ error: "재발송할 로그를 선택하세요." }, { status: 400 });
  }

  if (logIds.length > 100) {
    return NextResponse.json(
      { error: "한 번에 최대 100건까지 재발송할 수 있습니다." },
      { status: 400 },
    );
  }

  // 캠페인 소유권 확인
  const campaign = await prisma.smsCampaign.findUnique({
    where: { id: campaignId },
    select: { userId: true, status: true },
  });

  if (!campaign || campaign.userId !== session.user.id) {
    return NextResponse.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
  }

  // FAILED 상태인 로그만 대상
  const result = await prisma.smsLog.updateMany({
    where: {
      id: { in: logIds },
      campaignId,
      status: "FAILED",
    },
    data: {
      status: "PENDING",
      retryCount: 0,
      nextRetryAt: null,
      providerError: null,
    },
  });

  // 캠페인을 다시 QUEUED로 변경 (cron이 재처리하도록)
  if (result.count > 0 && ["COMPLETED", "FAILED"].includes(campaign.status)) {
    await prisma.smsCampaign.update({
      where: { id: campaignId },
      data: { status: "QUEUED" },
    });
  }

  return NextResponse.json({
    retried: result.count,
    message: `${result.count}건 재발송 대기열에 추가되었습니다.`,
  });
}
