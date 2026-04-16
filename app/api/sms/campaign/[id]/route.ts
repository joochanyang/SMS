import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";
import { logger, toLogError } from "@/lib/logger";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // Rate limit: 분당 30회, 시간당 300회
    const rl = await withRateLimit(req, { maxPerMinute: 30, maxPerHour: 300 });
    if (!rl.allowed) return rl.response!;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const { id } = await context.params;

    const campaign = await prisma.smsCampaign.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
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
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!campaign || campaign.userId !== session.user.id) {
      return NextResponse.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
    }

    const remaining = Math.max(0, campaign.totalRecipients - campaign.processedCount);
    const progressPct =
      campaign.totalRecipients > 0
        ? Math.round((campaign.processedCount / campaign.totalRecipients) * 1000) / 10
        : 0;

    // SmsLog 목록 조회 (userId 필터로 방어적 접근 제어)
    const logs = await prisma.smsLog.findMany({
      where: { campaignId: id, userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        targetNumber: true,
        status: true,
        providerStatus: true,
        retryCount: true,
        cost: true,
        createdAt: true,
      },
    });

    // 상태별 요약
    const summary = { pending: 0, sent: 0, delivered: 0, failed: 0, retryPending: 0 };
    for (const log of logs) {
      switch (log.status) {
        case "PENDING": summary.pending++; break;
        case "SENT": summary.sent++; break;
        case "DELIVERED": summary.delivered++; break;
        case "FAILED": summary.failed++; break;
        case "RETRY_PENDING": summary.retryPending++; break;
      }
    }

    return NextResponse.json(
      {
        campaign: {
          ...campaign,
          remaining,
          progressPct,
        },
        logs,
        summary,
      },
      { status: 200 }
    );
  } catch (e) {
    logger.error("Get campaign error", { error: toLogError(e) });
    return NextResponse.json({ error: "내부 서버 오류입니다." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const { id } = await context.params;

    const campaign = await prisma.smsCampaign.findUnique({ where: { id } });
    if (!campaign || campaign.userId !== session.user.id) {
      return NextResponse.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
    }

    // 활성 캠페인은 삭제 불가 — 먼저 취소(cancel)해야 함
    if (["QUEUED", "SENDING"].includes(campaign.status)) {
      return NextResponse.json(
        { error: "발송 중이거나 대기 중인 캠페인은 삭제할 수 없습니다. 먼저 취소하세요." },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      // 미처리 메시지가 남아있으면 환불 처리
      const unprocessedCount = await tx.smsLog.count({
        where: { campaignId: id, status: { in: ["PENDING", "RETRY_PENDING"] } },
      });

      if (unprocessedCount > 0) {
        const refundAmount = unprocessedCount * Number(campaign.costPerMessage);
        if (refundAmount > 0) {
          const updatedUser = await tx.user.update({
            where: { id: campaign.userId },
            data: { credits: { increment: refundAmount } },
            select: { credits: true },
          });
          await tx.transaction.create({
            data: {
              userId: campaign.userId,
              amount: refundAmount,
              type: "DEPOSIT",
              description: `캠페인 삭제 환불 (미처리 ${unprocessedCount}건)`,
            },
          });
          // CreditLedger 감사 추적
          await tx.creditLedger.create({
            data: {
              userId: campaign.userId,
              type: "CAMPAIGN_REFUND",
              amount: refundAmount,
              balanceAfter: updatedUser.credits,
              referenceType: "CAMPAIGN",
              referenceId: id,
              description: `캠페인 삭제 환불 (미처리 ${unprocessedCount}건)`,
            },
          });
        }
      }

      await tx.smsLog.deleteMany({ where: { campaignId: id } });
      await tx.smsCampaign.delete({ where: { id } });
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e) {
    logger.error("Delete campaign error", { error: toLogError(e) });
    return NextResponse.json({ error: "삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };

    if (body.action !== "cancel") {
      return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    }

    const campaign = await prisma.smsCampaign.findUnique({ where: { id } });
    if (!campaign || campaign.userId !== session.user.id) {
      return NextResponse.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
    }

    if (["COMPLETED", "CANCELLED"].includes(campaign.status)) {
      return NextResponse.json({ status: campaign.status }, { status: 200 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 미처리 로그 상태 일괄 변경 — updateMany 결과로 건수 확인 (race condition 방지)
      const updateResult = await tx.smsLog.updateMany({
        where: { campaignId: id, status: { in: ["PENDING", "RETRY_PENDING"] } },
        data: { status: "CANCELLED" },
      });
      const unprocessedCount = updateResult.count;

      // 환불 금액 계산
      const refundAmount = unprocessedCount * Number(campaign.costPerMessage);

      if (refundAmount > 0) {
        // 크레딧 환불 (atomic increment)
        const updatedUser = await tx.user.update({
          where: { id: campaign.userId },
          data: { credits: { increment: refundAmount } },
          select: { credits: true },
        });

        // 환불 트랜잭션 기록
        await tx.transaction.create({
          data: {
            userId: campaign.userId,
            amount: refundAmount,
            type: "DEPOSIT",
            description: `캠페인 취소 환불 (미처리 ${unprocessedCount}건)`,
          },
        });

        // CreditLedger 감사 추적
        await tx.creditLedger.create({
          data: {
            userId: campaign.userId,
            type: "CAMPAIGN_REFUND",
            amount: refundAmount,
            balanceAfter: updatedUser.credits,
            referenceType: "CAMPAIGN",
            referenceId: id,
            description: `캠페인 취소 환불 (${campaign.id})`,
            idempotencyKey: `cancel-${campaign.id}`,
          },
        });
      }

      // 캠페인 상태 업데이트
      const updated = await tx.smsCampaign.update({
        where: { id },
        data: { status: "CANCELLED" },
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

      return { campaign: updated, refundAmount, unprocessedCount };
    });

    return NextResponse.json(
      { campaign: result.campaign, refunded: result.refundAmount > 0, refundAmount: result.refundAmount, unprocessedCount: result.unprocessedCount },
      { status: 200 }
    );
  } catch (e) {
    logger.error("Cancel campaign error", { error: toLogError(e) });
    return NextResponse.json({ error: "내부 서버 오류입니다." }, { status: 500 });
  }
}

