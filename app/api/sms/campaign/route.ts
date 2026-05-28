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
import { generateSenderId, isValidSenderId } from "@/lib/sender-id";
import { substituteVars } from "@/lib/variable-substitution";
import { withRateLimit } from "@/lib/api-rate-limit";
import { resolveUserProvider } from "@/lib/sms-providers/router";

type RecipientWithVars = {
  phone: string;
  name?: string;
  nickname?: string;
};

type CreateCampaignBody = {
  name?: string;
  senderId?: string;
  message: string;
  recipients: string[];
  recipientsWithVars?: RecipientWithVars[];
  scheduledAt?: string;
};

type KillSwitchValue = {
  level?: string;
};

function readKillSwitchLevel(value: unknown): string {
  if (typeof value === "object" && value !== null && "level" in value) {
    return String((value as KillSwitchValue).level ?? "NORMAL");
  }
  return "NORMAL";
}

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
    const ksLevel = readKillSwitchLevel(killSwitch?.value);
    if (ksLevel === 'GLOBAL_STOP' || ksLevel === 'GLOBAL_PAUSE') {
      return NextResponse.json({ error: "서비스가 일시 중지되었습니다." }, { status: 503 });
    }

    logger.info("캠페인 생성 요청", { context: "campaign", userId: session.user.id });

    const body = (await req.json()) as CreateCampaignBody;
    const message = body.message?.trim();

    // 치환 모드: recipientsWithVars가 있으면 주소록 발송
    const hasVars = Array.isArray(body.recipientsWithVars) && body.recipientsWithVars.length > 0;
    const varsMap = new Map<string, RecipientWithVars>();
    let recipients: string[];

    if (hasVars) {
      const rawPhones = body.recipientsWithVars!.map((r) => r.phone);
      recipients = normalizeRecipients(rawPhones);
      // 정규화된 번호 → 변수 매핑 (개별 정규화로 중복 제거 후에도 올바르게 매칭)
      for (const recipientWithVars of body.recipientsWithVars!) {
        const normalizedPhone = normalizeRecipients([recipientWithVars.phone])[0];
        if (normalizedPhone && !varsMap.has(normalizedPhone)) {
          varsMap.set(normalizedPhone, recipientWithVars);
        }
      }
    } else {
      recipients = normalizeRecipients(body.recipients ?? []);
    }

    // 발신번호: 유저 입력값 검증 또는 자동 생성
    let senderId: string;
    if (body.senderId?.trim()) {
      const trimmed = body.senderId.trim();
      if (!isValidSenderId(trimmed)) {
        return NextResponse.json(
          { error: "발신번호는 영문/숫자 조합 1~11자여야 합니다." },
          { status: 400 },
        );
      }
      senderId = trimmed;
    } else {
      senderId = generateSenderId();
    }

    // 예약 발송 시간 검증
    let scheduledAt: Date | null = null;
    if (body.scheduledAt) {
      scheduledAt = new Date(body.scheduledAt);
      if (isNaN(scheduledAt.getTime())) {
        return NextResponse.json({ error: "예약 시간 형식이 올바르지 않습니다." }, { status: 400 });
      }
      if (scheduledAt.getTime() <= Date.now()) {
        return NextResponse.json({ error: "예약 시간은 현재 시간 이후여야 합니다." }, { status: 400 });
      }
    }
    // 단가는 유저별 설정값 사용 (서버에서 결정, 클라이언트 조작 방지)
    const userForCost = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { costPerMessage: true },
    });
    const costPerMessage = Number(userForCost?.costPerMessage ?? SMS_POLICY.defaultCostPerMessageKrw);

    // 유저별 발송 라인 결정 (미배정 시 전역 기본 infobip 폴백)
    const userProvider = await resolveUserProvider(session.user.id);
    const campaignProviderName = userProvider.name;

    if (!message) return NextResponse.json({ error: "메시지를 입력하세요." }, { status: 400 });
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "유효한 전화번호가 없습니다. E.164 형식을 사용하세요. (예: +821012345678)" },
        { status: 400 },
      );
    }

    // 치환 모드 길이 정책:
    //   - 절대 한도(GSM-7 1530자 / UCS-2 670자, 즉 concat 10파트) 초과 → 해당 수신자만 스킵
    //   - 1파트 한도 초과 ~ 절대 한도 이하 → 분할 과금 경고와 함께 통과
    //   - 비치환 모드는 아래의 단일 메시지 검증을 그대로 사용
    type SkippedRecipient = { phone: string; reason: string; length: number };
    type OverLimitWarning = { phone: string; parts: number; length: number };
    const skippedRecipients: SkippedRecipient[] = [];
    const overLimitWarnings: OverLimitWarning[] = [];

    if (hasVars) {
      for (const [phone, vars] of varsMap.entries()) {
        const substituted = substituteVars(message!, vars);
        const info = getSmsSegmentInfo(substituted);
        // concat 절대 한도: 단일 SMS 최대 파트 수(10)와 파트당 글자수의 곱
        const maxConcatChars =
          (info.encoding === 'GSM-7'
            ? SMS_POLICY.gsm7ConcatChars
            : SMS_POLICY.ucs2ConcatChars) * 10;

        if (info.charCount > maxConcatChars) {
          skippedRecipients.push({
            phone,
            reason: 'TOO_LONG',
            length: info.charCount,
          });
          continue;
        }
        if (info.charCount > info.maxCharsPerSms) {
          overLimitWarnings.push({
            phone,
            parts: info.parts,
            length: info.charCount,
          });
        }
      }

      // 길이 초과로 스킵된 수신자를 발송 대상에서 제외
      if (skippedRecipients.length > 0) {
        const skippedSet = new Set(skippedRecipients.map((s) => s.phone));
        recipients = recipients.filter((p) => !skippedSet.has(p));
        for (const phone of skippedSet) varsMap.delete(phone);
      }

      if (recipients.length === 0) {
        return NextResponse.json(
          {
            error: '치환 후 모든 수신자의 메시지가 최대 길이를 초과했습니다.',
            skipped: skippedRecipients,
          },
          { status: 400 },
        );
      }
    }

    const segmentInfo = getSmsSegmentInfo(message);
    if (!hasVars && segmentInfo.parts > 1) {
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
        select: { id: true, credits: true, status: true },
      });
      if (!user) throw new Error("USER_NOT_FOUND");

      // 유저 상태 확인
      if (user.status !== 'ACTIVE') {
        throw new Error("ACCOUNT_SUSPENDED");
      }

      // 크레딧 atomic 차감 — WHERE 조건으로 잔액 검증 (race condition 방지)
      let updatedUser;
      try {
        updatedUser = await tx.user.update({
          where: { id: user.id, credits: { gte: estimatedCost } },
          data: { credits: { decrement: estimatedCost } },
          select: { credits: true },
        });
      } catch (e) {
        // Prisma P2025: 조건에 맞는 레코드 없음 = 크레딧 부족
        if ((e as { code?: string })?.code === 'P2025') {
          throw new Error("INSUFFICIENT_CREDITS");
        }
        throw e;
      }

      const created = await tx.smsCampaign.create({
        data: {
          userId: user.id,
          name: body.name?.trim().slice(0, 200) || null,
          senderId,
          messageBody: message,
          messageType: "TRANSACTIONAL",
          status: scheduledAt ? "SCHEDULED" : "QUEUED",
          totalRecipients: filteredRecipients.length,
          costPerMessage: costPerMessage,
          estimatedCost,
          tempFailureStreak: 0,
          ...(scheduledAt && { scheduledAt }),
        },
      });

      await tx.smsLog.createMany({
        data: filteredRecipients.map((to) => ({
          userId: user.id,
          campaignId: created.id,
          targetNumber: to,
          messageBody: hasVars && varsMap.has(to) ? substituteVars(message, varsMap.get(to)!) : message,
          status: "PENDING",
          cost: costPerMessage,
          providerName: campaignProviderName,
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

      // CreditLedger 감사 추적
      await tx.creditLedger.create({
        data: {
          userId: user.id,
          type: "CAMPAIGN_DEDUCT",
          amount: -estimatedCost,
          balanceAfter: updatedUser.credits,
          referenceType: "CAMPAIGN",
          referenceId: created.id,
          description: `SMS 캠페인 차감: ${filteredRecipients.length}건`,
        },
      });

      return created;
    });

    return NextResponse.json(
      {
        campaignId: campaign.id,
        senderId,
        totalRecipients: campaign.totalRecipients,
        estimatedCost: campaign.estimatedCost,
        costPerMessage: campaign.costPerMessage,
        status: campaign.status,
        ...(scheduledAt && { scheduledAt: scheduledAt.toISOString() }),
        smsInfo: {
          encoding: segmentInfo.encoding,
          charCount: segmentInfo.charCount,
          parts: segmentInfo.parts,
          warning: segmentInfo.warning,
        },
        ...(blacklisted.size > 0 && { blacklistedCount: blacklisted.size }),
        ...(skippedRecipients.length > 0 && { skipped: skippedRecipients }),
        ...(overLimitWarnings.length > 0 && { warnings: overLimitWarnings }),
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

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    // 페이지네이션 파라미터 파싱
    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
    const skip = (page - 1) * limit;

    logger.info("캠페인 목록 조회 요청", { context: "campaign", userId: session.user.id, metadata: { page, limit } });

    const where = { userId: session.user.id };

    const [campaigns, total] = await Promise.all([
      prisma.smsCampaign.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          messageBody: true,
          messageType: true,
          status: true,
          totalRecipients: true,
          processedCount: true,
          deliveredCount: true,
          failedCount: true,
          costPerMessage: true,
          estimatedCost: true,
          scheduledAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.smsCampaign.count({ where }),
    ]);

    return NextResponse.json({ campaigns, total, page, limit }, { status: 200 });
  } catch (e) {
    logger.error("캠페인 목록 조회 오류", {
      context: "campaign",
      error: { message: (e as Error).message },
    });
    return NextResponse.json({ error: "내부 서버 오류입니다." }, { status: 500 });
  }
}
