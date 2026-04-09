import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { infobipClient } from "@/lib/infobip";
import { getRetryDelayMs, isTemporaryProviderError, KR_POLICY } from "@/lib/sms-policy";

const DEFAULT_BATCH_SIZE = KR_POLICY.maxBatchSize;
const MIN_DYNAMIC_BATCH_SIZE = 20;

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;

  let batchSize = DEFAULT_BATCH_SIZE;
  try {
    const body = (await req.json().catch(() => ({}))) as { batchSize?: number };
    if (typeof body.batchSize === "number") batchSize = clampInt(body.batchSize, 1, 1000);
  } catch {
    // ignore
  }

  try {
    const campaign = await prisma.smsCampaign.findUnique({ where: { id } });
    if (!campaign || campaign.userId !== session.user.id) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (["CANCELLED", "COMPLETED", "FAILED"].includes(campaign.status)) {
      return NextResponse.json({ status: campaign.status }, { status: 200 });
    }

    if (campaign.cooldownUntil && campaign.cooldownUntil > new Date()) {
      return NextResponse.json(
        {
          status: campaign.status,
          cooldownUntil: campaign.cooldownUntil,
          retryAfterMs: campaign.cooldownUntil.getTime() - Date.now(),
        },
        { status: 429 }
      );
    }

    const effectiveBatchSize = clampInt(
      Math.min(batchSize, campaign.dynamicBatchSize || DEFAULT_BATCH_SIZE, KR_POLICY.maxBatchSize),
      1,
      KR_POLICY.maxBatchSize
    );

    // 가져올 배치: 아직 처리되지 않은 PENDING 로그
    const now = new Date();
    const pendingLogs = await prisma.smsLog.findMany({
      where: {
        campaignId: id,
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

    if (pendingLogs.length === 0) {
      // 더 이상 처리할 게 없으면 COMPLETED
      const final = await prisma.smsCampaign.update({
        where: { id },
        data: { status: "COMPLETED" },
        select: {
          id: true,
          status: true,
          totalRecipients: true,
          processedCount: true,
          deliveredCount: true,
          failedCount: true,
          updatedAt: true,
        },
      });
      return NextResponse.json({ campaign: final, processed: 0 }, { status: 200 });
    }

    // 캠페인 상태를 SENDING으로 올려서 UI에서 진행중 표시
    if (campaign.status !== "SENDING") {
      await prisma.smsCampaign.update({ where: { id }, data: { status: "SENDING" } });
    }

    // Infobip로 발송 요청 (단일 호출에 여러 destination)
    let infobipResponse: any = null;
    try {
      infobipResponse = await infobipClient.channels.sms.send({
        messages: pendingLogs.map((log) => ({
          destinations: [{ to: log.targetNumber }],
          text: log.messageBody,
        })),
      } as any);
    } catch (e) {
      console.error("Infobip send batch error:", e);
      // 네트워크/일시 장애로 보고 재시도 대기열로 이동
      await prisma.$transaction(async (tx) => {
        for (const log of pendingLogs) {
          const nextRetry = log.retryCount + 1;
          if (nextRetry >= KR_POLICY.maxRetries) {
            await tx.smsLog.update({
              where: { id: log.id },
              data: {
                status: "FAILED",
                retryCount: nextRetry,
                providerError: "Batch send failed (max retries reached)",
              },
            });
            await tx.smsCampaign.update({
              where: { id },
              data: { processedCount: { increment: 1 }, failedCount: { increment: 1 } },
            });
          } else {
            await tx.smsLog.update({
              where: { id: log.id },
              data: {
                status: "RETRY_PENDING",
                retryCount: nextRetry,
                providerError: "Batch send temporary failure",
                nextRetryAt: new Date(Date.now() + getRetryDelayMs(log.retryCount)),
              },
            });
          }
        }

        const nextStreak = (campaign.tempFailureStreak || 0) + 1;
        const nextDynamic = Math.max(
          MIN_DYNAMIC_BATCH_SIZE,
          Math.floor((campaign.dynamicBatchSize || DEFAULT_BATCH_SIZE) / 2)
        );
        const cooldownSeconds = Math.min(120, 15 * nextStreak);
        await tx.smsCampaign.update({
          where: { id },
          data: {
            tempFailureStreak: nextStreak,
            dynamicBatchSize: nextDynamic,
            cooldownUntil: new Date(Date.now() + cooldownSeconds * 1000),
          },
        });
      });

      return NextResponse.json({ error: "Infobip temporary failure. Batch queued for retry." }, { status: 502 });
    }

    const responseMessages: any[] =
      (Array.isArray(infobipResponse?.messages) && infobipResponse.messages) ||
      (Array.isArray(infobipResponse?.data?.messages) && infobipResponse.data.messages) ||
      [];

    // DB 업데이트: 응답을 최대한 개별 매핑
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < pendingLogs.length; i++) {
        const log = pendingLogs[i];
        const msg = responseMessages[i] || null;
        const messageId = msg?.messageId ?? msg?.message_id ?? msg?.id ?? null;
        const providerStatus =
          msg?.status?.name ??
          msg?.status?.groupName ??
          msg?.status?.description ??
          "SENT";

        const tempError = isTemporaryProviderError(String(providerStatus));
        const isRetryExceeded = log.retryCount + 1 >= KR_POLICY.maxRetries;
        const nextStatus = tempError ? (isRetryExceeded ? "FAILED" : "RETRY_PENDING") : "SENT";

        await tx.smsLog.update({
          where: { id: pendingLogs[i].id },
          data: {
            messageId: typeof messageId === "string" ? messageId : null,
            providerStatus: String(providerStatus),
            status: nextStatus,
            retryCount: tempError ? log.retryCount + 1 : log.retryCount,
            nextRetryAt:
              nextStatus === "RETRY_PENDING"
                ? new Date(Date.now() + getRetryDelayMs(log.retryCount))
                : null,
            providerError: nextStatus === "FAILED" ? "Temporary failure max retries reached" : null,
          },
        });

        if (nextStatus === "FAILED") {
          await tx.smsCampaign.update({
            where: { id },
            data: { processedCount: { increment: 1 }, failedCount: { increment: 1 } },
          });
        } else if (nextStatus === "SENT") {
          await tx.smsCampaign.update({
            where: { id },
            data: { processedCount: { increment: 1 } },
          });
        }
      }

      const nextDynamic = Math.min(
        KR_POLICY.maxBatchSize,
        (campaign.dynamicBatchSize || DEFAULT_BATCH_SIZE) + 20
      );
      await tx.smsCampaign.update({
        where: { id },
        data: {
          tempFailureStreak: 0,
          dynamicBatchSize: nextDynamic,
          cooldownUntil: null,
        },
      });
    });

    const updatedCampaign = await prisma.smsCampaign.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        totalRecipients: true,
        processedCount: true,
        deliveredCount: true,
        failedCount: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        campaign: updatedCampaign,
        processed: pendingLogs.length,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("Process campaign error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

