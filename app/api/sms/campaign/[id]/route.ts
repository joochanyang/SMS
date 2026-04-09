import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const remaining = Math.max(0, campaign.totalRecipients - campaign.processedCount);
    const progressPct =
      campaign.totalRecipients > 0
        ? Math.round((campaign.processedCount / campaign.totalRecipients) * 1000) / 10
        : 0;

    return NextResponse.json(
      {
        campaign: {
          ...campaign,
          remaining,
          progressPct,
        },
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("Get campaign error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };

    if (body.action !== "cancel") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const campaign = await prisma.smsCampaign.findUnique({ where: { id } });
    if (!campaign || campaign.userId !== session.user.id) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (["COMPLETED", "CANCELLED"].includes(campaign.status)) {
      return NextResponse.json({ status: campaign.status }, { status: 200 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 미처리 건수 계산
      const unprocessedCount = await tx.smsLog.count({
        where: { campaignId: id, status: { in: ["PENDING", "RETRY_PENDING"] } },
      });

      // 미처리 로그 상태 일괄 변경
      await tx.smsLog.updateMany({
        where: { campaignId: id, status: { in: ["PENDING", "RETRY_PENDING"] } },
        data: { status: "CANCELLED" },
      });

      // 환불 금액 계산
      const refundAmount = unprocessedCount * campaign.costPerMessage;

      if (refundAmount > 0) {
        // 크레딧 환불 (atomic increment)
        await tx.user.update({
          where: { id: campaign.userId },
          data: { credits: { increment: refundAmount } },
        });

        // 환불 트랜잭션 기록
        await tx.transaction.create({
          data: {
            userId: campaign.userId,
            amount: refundAmount,
            type: "DEPOSIT",
            description: `Campaign cancelled refund (${unprocessedCount} unprocessed)`,
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
    console.error("Cancel campaign error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

