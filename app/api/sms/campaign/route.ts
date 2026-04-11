import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  SMS_POLICY,
  normalizeRecipients,
  getSmsSegmentInfo,
  getBlacklistedNumbers,
} from "@/lib/sms-policy";
import { withRateLimit } from "@/lib/api-rate-limit";

type CreateCampaignBody = {
  name?: string;
  message: string;
  recipients: string[];
};

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 분당 10회, 시간당 100회
    const rl = await withRateLimit(req, { maxPerMinute: 10, maxPerHour: 100 });
    if (!rl.allowed) return rl.response!;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // Kill Switch 확인
    const killSwitch = await prisma.systemSetting.findUnique({ where: { key: 'kill_switch' } });
    const ksLevel = (killSwitch?.value as any)?.level ?? 'NORMAL';
    if (ksLevel === 'GLOBAL_STOP' || ksLevel === 'GLOBAL_PAUSE') {
      return NextResponse.json({ error: "서비스가 일시 중지되었습니다." }, { status: 503 });
    }

    logger.info("캠페인 생성 요청", { context: "campaign", userId: session.user.id });

    const body = (await req.json()) as CreateCampaignBody;
    const message = body.message?.trim();
    const recipients = normalizeRecipients(body.recipients ?? []);
    // 단가는 서버에서 결정 (클라이언트 조작 방지)
    const costPerMessage = SMS_POLICY.defaultCostPerMessageUsd;

    if (!message) return NextResponse.json({ error: "메시지를 입력하세요." }, { status: 400 });
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "유효한 전화번호가 없습니다. E.164 형식을 사용하세요. (예: +821012345678)" },
        { status: 400 },
      );
    }

    // Enforce single-SMS limit: GSM-7 = 160 chars, UCS-2 = 70 chars
    const segmentInfo = getSmsSegmentInfo(message);
    if (segmentInfo.parts > 1) {
      return NextResponse.json(
        {
          error: `메시지가 ${segmentInfo.charCount}자입니다. ${segmentInfo.encoding} 인코딩 기준 최대 ${segmentInfo.maxCharsPerSms}자까지만 발송 가능합니다.`,
          encoding: segmentInfo.encoding,
          charCount: segmentInfo.charCount,
          maxChars: segmentInfo.maxCharsPerSms,
        },
        { status: 400 },
      );
    }

    // Filter out blacklisted numbers
    const blacklisted = await getBlacklistedNumbers(recipients, session.user.id);
    const filteredRecipients = blacklisted.size > 0
      ? recipients.filter((r) => !blacklisted.has(r))
      : recipients;

    if (filteredRecipients.length === 0) {
      return NextResponse.json(
        {
          error: "모든 수신번호가 블랙리스트에 등록되어 있습니다.",
          blacklistedCount: blacklisted.size,
        },
        { status: 400 },
      );
    }

    // Single SMS per recipient (multi-part is blocked above)
    const estimatedCost = filteredRecipients.length * costPerMessage;

    const campaign = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, credits: true, status: true, maxCampaignSize: true, dailySendLimit: true },
      });
      if (!user) throw new Error("USER_NOT_FOUND");

      // 유저 상태 확인
      if (user.status !== 'ACTIVE') {
        throw new Error("ACCOUNT_SUSPENDED");
      }

      // maxCampaignSize 확인
      if (filteredRecipients.length > user.maxCampaignSize) {
        throw new Error("MAX_CAMPAIGN_SIZE_EXCEEDED");
      }

      // dailySendLimit 확인
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todaySentCount = await tx.smsLog.count({
        where: {
          userId: user.id,
          createdAt: { gte: todayStart },
          status: { not: "CANCELLED" },
        },
      });
      if (todaySentCount + filteredRecipients.length > user.dailySendLimit) {
        throw new Error("DAILY_SEND_LIMIT_EXCEEDED");
      }

      // 크레딧 atomic 차감 — WHERE 조건으로 잔액 검증 (race condition 방지)
      try {
        await tx.user.update({
          where: { id: user.id, credits: { gte: estimatedCost } },
          data: { credits: { decrement: estimatedCost } },
        });
      } catch (e: any) {
        // Prisma P2025: 조건에 맞는 레코드 없음 = 크레딧 부족
        if (e?.code === 'P2025') {
          throw new Error("INSUFFICIENT_CREDITS");
        }
        throw e;
      }

      const created = await tx.smsCampaign.create({
        data: {
          userId: user.id,
          name: body.name?.trim().slice(0, 200) || null,
          messageBody: message,
          messageType: "TRANSACTIONAL",
          status: "QUEUED",
          totalRecipients: filteredRecipients.length,
          costPerMessage: costPerMessage,
          estimatedCost,
          dynamicBatchSize: SMS_POLICY.maxBatchSize,
          tempFailureStreak: 0,
        },
      });

      await tx.smsLog.createMany({
        data: filteredRecipients.map((to) => ({
          userId: user.id,
          campaignId: created.id,
          targetNumber: to,
          messageBody: message,
          status: "PENDING",
          cost: costPerMessage,
        })),
      });

      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: -estimatedCost,
          type: "WITHDRAWAL",
          description: `SMS 캠페인 예약 (${filteredRecipients.length}건 × ${segmentInfo.parts}파트)`,
        },
      });

      return created;
    });

    return NextResponse.json(
      {
        campaignId: campaign.id,
        totalRecipients: campaign.totalRecipients,
        estimatedCost: campaign.estimatedCost,
        costPerMessage: campaign.costPerMessage,
        status: campaign.status,
        smsInfo: {
          encoding: segmentInfo.encoding,
          charCount: segmentInfo.charCount,
          parts: segmentInfo.parts,
          warning: segmentInfo.warning,
        },
        ...(blacklisted.size > 0 && { blacklistedCount: blacklisted.size }),
      },
      { status: 201 },
    );
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.message === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    if (err.message === "ACCOUNT_SUSPENDED") {
      return NextResponse.json({ error: "계정이 정지되었습니다." }, { status: 403 });
    }
    if (err.message === "INSUFFICIENT_CREDITS") {
      return NextResponse.json({ error: "크레딧이 부족합니다." }, { status: 402 });
    }
    if (err.message === "MAX_CAMPAIGN_SIZE_EXCEEDED") {
      return NextResponse.json({ error: "캠페인 최대 수신자 수를 초과했습니다." }, { status: 400 });
    }
    if (err.message === "DAILY_SEND_LIMIT_EXCEEDED") {
      return NextResponse.json({ error: "일일 발송 한도를 초과했습니다." }, { status: 429 });
    }
    logger.error("캠페인 생성 오류", {
      context: "campaign",
      error: { message: err.message },
    });
    return NextResponse.json({ error: "내부 서버 오류입니다." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    logger.info("캠페인 목록 조회 요청", { context: "campaign", userId: session.user.id });

    const campaigns = await prisma.smsCampaign.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        messageType: true,
        status: true,
        totalRecipients: true,
        processedCount: true,
        deliveredCount: true,
        failedCount: true,
        costPerMessage: true,
        estimatedCost: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ campaigns }, { status: 200 });
  } catch (e) {
    logger.error("캠페인 목록 조회 오류", {
      context: "campaign",
      error: { message: (e as Error).message },
    });
    return NextResponse.json({ error: "내부 서버 오류입니다." }, { status: 500 });
  }
}
