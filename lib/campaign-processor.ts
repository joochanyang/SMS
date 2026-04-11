// ---------------------------------------------------------------------------
// 캠페인 배치 발송 처리기 — Cron API 및 수동 process API에서 공유
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import { infobipClient } from "@/lib/infobip";
import {
  getRetryDelayMs,
  isTemporaryProviderError,
  SMS_POLICY,
  getBlacklistedNumbers,
} from "@/lib/sms-policy";

const DEFAULT_BATCH_SIZE = SMS_POLICY.maxBatchSize;
const MIN_DYNAMIC_BATCH_SIZE = 20;

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export interface CampaignBatchResult {
  processed: number;
  remaining: number;
  status: string;
  blacklistedCount?: number;
}

/**
 * 단일 캠페인에 대해 1회 배치 발송을 처리한다.
 *
 * @param campaignId 캠페인 ID
 * @param userId     캠페인 소유자 ID (크레딧 환불 등에 사용)
 * @param batchSize  배치 크기 (기본: SMS_POLICY.maxBatchSize)
 * @returns 처리 결과
 */
export async function processCampaignBatch(
  campaignId: string,
  userId: string,
  batchSize?: number,
): Promise<CampaignBatchResult> {
  const effectiveBatchSizeInput = batchSize
    ? clampInt(batchSize, 1, 1000)
    : DEFAULT_BATCH_SIZE;

  const campaign = await prisma.smsCampaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new CampaignProcessError("캠페인을 찾을 수 없습니다.", "NOT_FOUND");
  }

  if (campaign.userId !== userId) {
    throw new CampaignProcessError("캠페인을 찾을 수 없습니다.", "NOT_FOUND");
  }

  // Kill Switch 확인
  const killSwitch = await prisma.systemSetting.findUnique({ where: { key: 'kill_switch' } });
  const ksLevel = (killSwitch?.value as any)?.level ?? 'NORMAL';
  if (ksLevel === 'GLOBAL_STOP' || ksLevel === 'GLOBAL_PAUSE') {
    throw new CampaignProcessError("서비스가 일시 중지되었습니다.", "KILL_SWITCH");
  }

  // 유저 상태 확인
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status !== 'ACTIVE') {
    throw new CampaignProcessError("계정이 정지되었습니다.", "NOT_FOUND");
  }

  // 이미 종료된 상태
  if (["CANCELLED", "COMPLETED", "FAILED"].includes(campaign.status)) {
    return { processed: 0, remaining: 0, status: campaign.status };
  }

  // 쿨다운 중
  if (campaign.cooldownUntil && campaign.cooldownUntil > new Date()) {
    throw new CampaignProcessError("쿨다운 대기 중입니다.", "COOLDOWN", {
      cooldownUntil: campaign.cooldownUntil,
      retryAfterMs: campaign.cooldownUntil.getTime() - Date.now(),
    });
  }

  const effectiveBatchSize = clampInt(
    Math.min(
      effectiveBatchSizeInput,
      campaign.dynamicBatchSize || DEFAULT_BATCH_SIZE,
      SMS_POLICY.maxBatchSize,
    ),
    1,
    SMS_POLICY.maxBatchSize,
  );

  // PENDING / RETRY_PENDING 로그 조회
  const now = new Date();
  const pendingLogs = await prisma.smsLog.findMany({
    where: {
      campaignId,
      OR: [
        { status: "PENDING" },
        { status: "RETRY_PENDING", nextRetryAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: effectiveBatchSize,
    select: {
      id: true,
      targetNumber: true,
      messageBody: true,
      cost: true,
      retryCount: true,
    },
  });

  // 블랙리스트 필터링
  const blacklisted = await getBlacklistedNumbers(
    pendingLogs.map((l) => l.targetNumber),
    userId,
  );
  const blockedLogs = pendingLogs.filter((l) => blacklisted.has(l.targetNumber));
  const sendableLogs =
    blacklisted.size > 0
      ? pendingLogs.filter((l) => !blacklisted.has(l.targetNumber))
      : pendingLogs;

  // 블랙리스트 차단 처리 + 환불
  if (blockedLogs.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const log of blockedLogs) {
        await tx.smsLog.update({
          where: { id: log.id },
          data: {
            status: "FAILED",
            providerError: "블랙리스트 차단",
          },
        });
      }
      const refundAmount = blockedLogs.reduce((sum, l) => sum + Number(l.cost), 0);
      await tx.smsCampaign.update({
        where: { id: campaignId },
        data: {
          processedCount: { increment: blockedLogs.length },
          failedCount: { increment: blockedLogs.length },
        },
      });
      if (refundAmount > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { credits: { increment: refundAmount } },
        });
        await tx.transaction.create({
          data: {
            userId,
            amount: refundAmount,
            type: "DEPOSIT",
            description: `블랙리스트 차단 환불 (${blockedLogs.length}건)`,
          },
        });
      }
    });
  }

  // 모든 건이 블랙리스트 차단된 경우
  if (sendableLogs.length === 0 && pendingLogs.length === blockedLogs.length) {
    const remainingCount = await prisma.smsLog.count({
      where: { campaignId, status: { in: ["PENDING", "RETRY_PENDING"] } },
    });
    if (remainingCount === 0) {
      await prisma.smsCampaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED" },
      });
    }
    return {
      processed: 0,
      remaining: remainingCount,
      status: remainingCount === 0 ? "COMPLETED" : campaign.status,
      blacklistedCount: blockedLogs.length,
    };
  }

  // 발송할 건이 없으면 완료 처리
  if (sendableLogs.length === 0) {
    await prisma.smsCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" },
    });
    return { processed: 0, remaining: 0, status: "COMPLETED" };
  }

  // SENDING 상태로 전환
  if (campaign.status !== "SENDING") {
    await prisma.smsCampaign.update({
      where: { id: campaignId },
      data: { status: "SENDING" },
    });
  }

  // Infobip 발송
  let infobipResponse: any = null;
  try {
    infobipResponse = await infobipClient.channels.sms.send({
      messages: sendableLogs.map((log) => ({
        destinations: [{ to: log.targetNumber }],
        text: log.messageBody,
      })),
    } as any);
  } catch (e) {
    console.error("Infobip 배치 발송 오류:", e);

    // 일시 장애 — 재시도 대기열로 이동
    await prisma.$transaction(async (tx) => {
      for (const log of sendableLogs) {
        const nextRetry = log.retryCount + 1;
        if (nextRetry >= SMS_POLICY.maxRetries) {
          await tx.smsLog.update({
            where: { id: log.id },
            data: {
              status: "FAILED",
              retryCount: nextRetry,
              providerError: "배치 발송 실패 (최대 재시도 초과)",
            },
          });
          await tx.smsCampaign.update({
            where: { id: campaignId },
            data: {
              processedCount: { increment: 1 },
              failedCount: { increment: 1 },
            },
          });
        } else {
          await tx.smsLog.update({
            where: { id: log.id },
            data: {
              status: "RETRY_PENDING",
              retryCount: nextRetry,
              providerError: "배치 발송 일시 장애",
              nextRetryAt: new Date(
                Date.now() + getRetryDelayMs(log.retryCount),
              ),
            },
          });
        }
      }

      const nextStreak = (campaign.tempFailureStreak || 0) + 1;
      const nextDynamic = Math.max(
        MIN_DYNAMIC_BATCH_SIZE,
        Math.floor((campaign.dynamicBatchSize || DEFAULT_BATCH_SIZE) / 2),
      );
      const cooldownSeconds = Math.min(120, 15 * nextStreak);
      await tx.smsCampaign.update({
        where: { id: campaignId },
        data: {
          tempFailureStreak: nextStreak,
          dynamicBatchSize: nextDynamic,
          cooldownUntil: new Date(Date.now() + cooldownSeconds * 1000),
        },
      });
    });

    throw new CampaignProcessError(
      "일시적 발송 오류. 재시도 대기열에 추가되었습니다.",
      "PROVIDER_ERROR",
    );
  }

  // Infobip 응답 파싱
  const responseMessages: any[] =
    (Array.isArray(infobipResponse?.messages) && infobipResponse.messages) ||
    (Array.isArray(infobipResponse?.data?.messages) &&
      infobipResponse.data.messages) ||
    [];

  // DB 업데이트 — 개별 메시지 상태 반영 + 캠페인 카운터 일괄 업데이트
  await prisma.$transaction(async (tx) => {
    let sentCount = 0;
    let failedFromProviderCount = 0;

    for (let i = 0; i < sendableLogs.length; i++) {
      const log = sendableLogs[i];
      const msg = responseMessages[i] || null;
      const messageId =
        msg?.messageId ?? msg?.message_id ?? msg?.id ?? null;
      const providerStatus =
        msg?.status?.name ??
        msg?.status?.groupName ??
        msg?.status?.description ??
        "SENT";

      const tempError = isTemporaryProviderError(String(providerStatus));
      const isRetryExceeded = log.retryCount + 1 >= SMS_POLICY.maxRetries;
      const nextStatus = tempError
        ? isRetryExceeded
          ? "FAILED"
          : "RETRY_PENDING"
        : "SENT";

      await tx.smsLog.update({
        where: { id: sendableLogs[i].id },
        data: {
          messageId: typeof messageId === "string" ? messageId : null,
          providerStatus: String(providerStatus),
          status: nextStatus,
          retryCount: tempError ? log.retryCount + 1 : log.retryCount,
          nextRetryAt:
            nextStatus === "RETRY_PENDING"
              ? new Date(Date.now() + getRetryDelayMs(log.retryCount))
              : null,
          providerError:
            nextStatus === "FAILED"
              ? "일시 장애 최대 재시도 초과"
              : null,
        },
      });

      if (nextStatus === "FAILED") {
        failedFromProviderCount++;
      } else if (nextStatus === "SENT") {
        sentCount++;
      }
    }

    // 캠페인 카운터 + 배치 크기 복구를 단일 UPDATE로 처리 (N+1 제거)
    const totalProcessed = sentCount + failedFromProviderCount;
    const nextDynamic = Math.min(
      SMS_POLICY.maxBatchSize,
      (campaign.dynamicBatchSize || DEFAULT_BATCH_SIZE) + 20,
    );
    await tx.smsCampaign.update({
      where: { id: campaignId },
      data: {
        ...(totalProcessed > 0 && { processedCount: { increment: totalProcessed } }),
        ...(failedFromProviderCount > 0 && { failedCount: { increment: failedFromProviderCount } }),
        tempFailureStreak: 0,
        dynamicBatchSize: nextDynamic,
        cooldownUntil: null,
      },
    });
  });

  // 남은 PENDING/RETRY_PENDING 확인
  const remainingCount = await prisma.smsLog.count({
    where: {
      campaignId,
      status: { in: ["PENDING", "RETRY_PENDING"] },
    },
  });

  if (remainingCount === 0) {
    await prisma.smsCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" },
    });
  }

  const updatedCampaign = await prisma.smsCampaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });

  return {
    processed: sendableLogs.length,
    remaining: remainingCount,
    status: updatedCampaign?.status ?? "SENDING",
    ...(blockedLogs.length > 0 && { blacklistedCount: blockedLogs.length }),
  };
}

// ---------------------------------------------------------------------------
// 커스텀 에러 클래스
// ---------------------------------------------------------------------------

export type CampaignErrorCode =
  | "NOT_FOUND"
  | "COOLDOWN"
  | "PROVIDER_ERROR"
  | "KILL_SWITCH";

export class CampaignProcessError extends Error {
  code: CampaignErrorCode;
  meta?: Record<string, any>;

  constructor(
    message: string,
    code: CampaignErrorCode,
    meta?: Record<string, any>,
  ) {
    super(message);
    this.name = "CampaignProcessError";
    this.code = code;
    this.meta = meta;
  }
}
