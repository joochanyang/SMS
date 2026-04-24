import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logger, toLogError } from "@/lib/logger";
import { withRateLimit } from "@/lib/api-rate-limit";
import { mapTxgEventToStatus } from "@/lib/sms-providers/txg";

// ---------------------------------------------------------------------------
// TXG-TEL Push Report 수신 엔드포인트 (PUT /api/txg/report)
//
// 보안: TXG_DLR_SECRET 환경변수 필수. 요청 헤더 `x-txg-token`으로 전달해야 한다.
// 시크릿은 URL query 대신 헤더로만 전달 (S-14: 쿼리 로그 유출 방지 패턴 준수).
//
// Push 형식: {"type":"report","cnt":2,"array":[[id,number,time,sendStatus,deliverStatus?],...]}
//
//   sendStatus     (필수): 0=성공, 1=미전송, 2=전송중, non-0=실패
//   deliverStatus  (선택): 0=보고불필요, 1=미전달, 2=전달실패, 3=전달성공,
//                         4=시간초과, 5=알수없음
//
// 상태 결정 규칙:
//   - sendStatus !== 0 → FAILED (발송 자체 실패)
//   - sendStatus === 0 && deliverStatus === 3 → DELIVERED
//   - sendStatus === 0 && deliverStatus ∈ {1,2,4} → FAILED (전달 실패/시간초과)
//   - sendStatus === 0 && deliverStatus === 0 → SENT (보고 불필요, 상태 유지)
//   - sendStatus === 0 && deliverStatus === 5 → 현재 상태 유지 (알 수 없음)
//   - sendStatus === 0 && deliverStatus 없음 → 현재 상태 유지
// ---------------------------------------------------------------------------

const TXG_DLR_EVENT_LIMIT = 1000; // 단일 요청당 처리할 이벤트 상한 (DoS 방지)

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// TXG는 push DLR과 /getreport에서 동일 array 포맷을 사용한다고 명시했으나,
// 실제 push DLR이 도착한 적이 없어 정확한 포맷은 미확인 상태.
// /getreport 실측 포맷: [id, number, time, sendStatus, sendStatusLabel, deliverTime?, deliverStatus?]
// 안전을 위해 두 가지 포맷 모두 수용하도록 unknown[]으로 받고 길이로 분기한다.
type TxgReportEvent = unknown[];

export async function PUT(req: NextRequest) {
  try {
    // Rate limit: 분당 200회, 시간당 5000회 (Infobip DLR과 동일 수준)
    const rl = await withRateLimit(req, { maxPerMinute: 200, maxPerHour: 5000 });
    if (!rl.allowed) return rl.response!;

    // 시크릿 검증 — 미설정/플레이스홀더 값 시 전면 차단 (S-08/S-14 패턴)
    const secret = process.env.TXG_DLR_SECRET;
    if (!secret || secret.length < 16 || secret.startsWith("generate-with")) {
      logger.error(
        "TXG_DLR_SECRET 미설정 또는 플레이스홀더 값 — 모든 DLR 요청을 거부합니다.",
        { context: "txg-dlr" },
      );
      return NextResponse.json(
        { status: "error", message: "웹훅이 설정되지 않았습니다." },
        { status: 503 },
      );
    }

    const token = req.headers.get("x-txg-token");
    if (!token || !safeCompare(token, secret)) {
      return NextResponse.json(
        { status: "error", message: "인증이 필요합니다." },
        { status: 401 },
      );
    }

    const payload = await req.json().catch(() => null);
    if (
      !payload ||
      payload.type !== "report" ||
      !Array.isArray(payload.array)
    ) {
      return NextResponse.json(
        { status: "error", message: "잘못된 요청 형식입니다." },
        { status: 400 },
      );
    }

    // DoS 방지: 요청당 처리 이벤트 상한 (초과분은 후속 Push에서 재전송됨)
    const events = (payload.array as TxgReportEvent[]).slice(0, TXG_DLR_EVENT_LIMIT);
    let updated = 0;

    for (const event of events) {
      if (!Array.isArray(event) || event.length < 4) continue;
      // 두 가지 포맷 호환:
      //   5필드: [id, number, time, sendStatus, deliverStatus?]
      //   7필드: [id, number, time, sendStatus, sendStatusLabel, deliverTime, deliverStatus]
      // 길이로 분기하여 deliverStatus 인덱스를 결정.
      const id = event[0];
      const sendStatus = event[3];
      const deliverStatus = event.length >= 7 ? event[6] : event[4];
      if (id == null) continue;

      const messageId = String(id);
      const { nextStatus, providerStatus, providerError } = mapTxgEventToStatus(
        Number(sendStatus),
        deliverStatus != null ? Number(deliverStatus) : undefined,
      );

      // 상태 변화가 없는 이벤트(deliverStatus=5 알수없음 등)는 DB 업데이트 대상이 아님
      if (!nextStatus) continue;

      const log = await prisma.smsLog.findUnique({
        where: { messageId },
        select: { id: true, status: true, campaignId: true },
      });

      if (!log) continue;
      // 이미 종결 상태면 스킵 — 아래 updateMany의 notIn 가드가 다시 막아주지만 조회 비용 절약
      if (log.status === "DELIVERED" || log.status === "FAILED") continue;

      await prisma.$transaction(async (tx) => {
        // 멱등성 + 종결 상태 재전이 방지:
        //   - 이미 DELIVERED/FAILED 면 업데이트 자체를 차단해 카운터 중복 증가 근절
        //   - TXG가 timeout(4) 이후 뒤늦은 성공(3) Push를 보내는 경우도 안전
        const updatedRows = await tx.smsLog.updateMany({
          where: {
            id: log.id,
            status: { notIn: ["DELIVERED", "FAILED"] },
          },
          data: {
            status: nextStatus,
            providerStatus,
            providerError,
          },
        });

        // 실제로 상태가 전이된 경우에만 캠페인 카운터 증가
        if (log.campaignId && updatedRows.count > 0) {
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

    return NextResponse.json({ status: "ok", updated }, { status: 200 });
  } catch (e) {
    logger.error("TXG DLR 웹훅 처리 오류", {
      context: "txg-dlr",
      error: toLogError(e),
    });
    return NextResponse.json(
      { status: "error", message: "내부 서버 오류입니다." },
      { status: 500 },
    );
  }
}
