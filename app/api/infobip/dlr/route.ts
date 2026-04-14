import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withRateLimit } from "@/lib/api-rate-limit";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Infobip Delivery Reports webhook (best effort).
 * 보안: INFOBIP_DLR_SECRET 설정 시 `x-infobip-token` 헤더로 검증.
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit: 분당 200회, 시간당 5000회 (Infobip 웹훅)
    const rl = await withRateLimit(req, { maxPerMinute: 200, maxPerHour: 5000 });
    if (!rl.allowed) return rl.response!;

    const secret = process.env.INFOBIP_DLR_SECRET;
    if (!secret) {
      console.error("INFOBIP_DLR_SECRET not configured — rejecting all DLR requests");
      return NextResponse.json({ error: "웹훅이 설정되지 않았습니다." }, { status: 503 });
    }

    const token = req.headers.get("x-infobip-token");
    if (!token || !safeCompare(token, secret)) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
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

      // 통신사 정보 추출 (Infobip DLR network 필드)
      const networkName: string | null =
        (typeof item?.network?.networkName === "string" && item.network.networkName) ||
        (typeof item?.network?.name === "string" && item.network.name) ||
        null;
      const mccMnc: string | null =
        (typeof item?.network?.mccMnc === "string" && item.network.mccMnc) ||
        (typeof item?.mccmnc === "string" && item.mccmnc) ||
        null;

      const nextStatus =
        statusGroup.toUpperCase().includes("DELIVER")
          ? "DELIVERED"
          : statusGroup.toUpperCase().includes("FAIL") || statusGroup.toUpperCase().includes("REJECT")
            ? "FAILED"
            : null;

      if (!nextStatus && !networkName && !mccMnc) continue;

      const log = await prisma.smsLog.findUnique({
        where: { messageId },
        select: { id: true, status: true, campaignId: true },
      });

      if (!log) continue;
      if (log.status === nextStatus && !networkName && !mccMnc) continue;

      await prisma.$transaction(async (tx) => {
        const updateData: Record<string, unknown> = {};
        if (nextStatus) updateData.status = nextStatus;
        if (networkName) updateData.networkName = networkName;
        if (mccMnc) updateData.networkCode = mccMnc;

        // 멱등성 보장: 상태가 실제로 변경될 때만 업데이트
        const updatedRows = nextStatus
          ? await tx.smsLog.updateMany({
              where: { id: log.id, status: { not: nextStatus } },
              data: updateData,
            })
          : await tx.smsLog.updateMany({
              where: { id: log.id },
              data: updateData,
            });

        // 상태가 실제로 변경된 경우에만 캠페인 카운터 증가 (중복 방지)
        if (log.campaignId && nextStatus && updatedRows.count > 0) {
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
    logger.error("DLR 웹훅 처리 오류", {
      context: "dlr",
      error: { message: (e as Error).message },
    });
    return NextResponse.json({ error: "내부 서버 오류입니다." }, { status: 500 });
  }
}
