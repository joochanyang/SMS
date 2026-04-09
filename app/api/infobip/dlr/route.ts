import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Infobip Delivery Reports webhook (best effort).
 * 보안: INFOBIP_DLR_SECRET 설정 시 `?token=` 또는 `x-infobip-token` 헤더로 검증.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.INFOBIP_DLR_SECRET;
    if (!secret) {
      console.error("INFOBIP_DLR_SECRET not configured — rejecting all DLR requests");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }

    const url = new URL(req.url);
    const token = url.searchParams.get("token") || req.headers.get("x-infobip-token");
    if (!token || token !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await req.json().catch(() => null);
    if (!payload) return NextResponse.json({ ok: true }, { status: 200 });

    // Infobip DLR는 보통 { results: [...] } 형태. 환경에 따라 달라질 수 있어 유연하게 처리.
    const results = Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload)
        ? payload
        : [];

    let updated = 0;

    for (const item of results) {
      const messageId: string | null =
        (typeof item?.messageId === "string" && item.messageId) ||
        (typeof item?.message_id === "string" && item.message_id) ||
        null;

      if (!messageId) continue;

      const statusGroup: string =
        (typeof item?.status?.groupName === "string" && item.status.groupName) ||
        (typeof item?.status?.group_name === "string" && item.status.group_name) ||
        (typeof item?.status === "string" && item.status) ||
        "";

      const nextStatus =
        statusGroup.toUpperCase().includes("DELIVER")
          ? "DELIVERED"
          : statusGroup.toUpperCase().includes("FAIL") || statusGroup.toUpperCase().includes("REJECT")
            ? "FAILED"
            : null;

      if (!nextStatus) continue;

      const log = await prisma.smsLog.findUnique({
        where: { messageId },
        select: { id: true, status: true, campaignId: true },
      });

      if (!log) continue;
      if (log.status === nextStatus) continue;

      await prisma.$transaction(async (tx) => {
        await tx.smsLog.update({
          where: { id: log.id },
          data: { status: nextStatus },
        });

        if (log.campaignId) {
          if (nextStatus === "DELIVERED") {
            await tx.smsCampaign.update({
              where: { id: log.campaignId },
              data: { deliveredCount: { increment: 1 } },
            });
          } else if (nextStatus === "FAILED") {
            await tx.smsCampaign.update({
              where: { id: log.campaignId },
              data: { failedCount: { increment: 1 } },
            });
          }
        }
      });

      updated++;
    }

    return NextResponse.json({ ok: true, updated }, { status: 200 });
  } catch (e) {
    console.error("Infobip DLR webhook error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

