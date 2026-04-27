// ---------------------------------------------------------------------------
// SMPP deliver_sm DLR 파서 + DB 적용기
// ---------------------------------------------------------------------------
//
// SMPP 3.4 표준 delivery receipt format (short_message body):
//   "id:IIII sub:SSS dlvrd:DDD submit date:YYMMDDhhmm done date:YYMMDDhhmm
//    stat:SSSSSSS err:E text:XXXXX"
//
// 핵심 필드:
//   id   — 원래 submit_sm_resp의 message_id 와 일치 (DLR 매칭 키)
//   stat — 7자 코드: DELIVRD, EXPIRED, DELETED, UNDELIV, ACCEPTD, UNKNOWN, REJECTD
//   err  — 3자리 SMSC 에러 코드 (실패 시)
//
// 일부 SMSC는 receipted_message_id (TLV 0x001E) + message_state (TLV 0x0427)를
// 함께 보내므로 둘 다 시도하고, body 파싱은 fallback.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import { logger, toLogError } from "@/lib/logger";
import type { PDU } from "smpp";

const ESM_CLASS_DELIVERY_RECEIPT_BIT = 0x04;

const STAT_TO_INTERNAL: Record<
  string,
  { nextStatus: "DELIVERED" | "FAILED" | null; reason: string | null }
> = {
  DELIVRD: { nextStatus: "DELIVERED", reason: null },
  EXPIRED: { nextStatus: "FAILED", reason: "전달 시간 초과 (EXPIRED)" },
  DELETED: { nextStatus: "FAILED", reason: "메시지 삭제됨 (DELETED)" },
  UNDELIV: { nextStatus: "FAILED", reason: "전달 실패 (UNDELIV)" },
  REJECTD: { nextStatus: "FAILED", reason: "수신 거절 (REJECTD)" },
  // ACCEPTD / UNKNOWN은 종결 상태가 아님 — 상태 유지
  ACCEPTD: { nextStatus: null, reason: null },
  UNKNOWN: { nextStatus: null, reason: null },
};

// SMPP message_state TLV 값 → 내부 상태
// (1=ENROUTE, 2=DELIVERED, 3=EXPIRED, 4=DELETED, 5=UNDELIVERABLE,
//  6=ACCEPTED, 7=UNKNOWN, 8=REJECTED)
const MESSAGE_STATE_MAP: Record<
  number,
  { nextStatus: "DELIVERED" | "FAILED" | null; reason: string | null }
> = {
  1: { nextStatus: null, reason: null }, // ENROUTE
  2: { nextStatus: "DELIVERED", reason: null }, // DELIVERED
  3: { nextStatus: "FAILED", reason: "전달 시간 초과 (message_state=EXPIRED)" },
  4: { nextStatus: "FAILED", reason: "메시지 삭제됨 (message_state=DELETED)" },
  5: { nextStatus: "FAILED", reason: "전달 불가 (message_state=UNDELIVERABLE)" },
  6: { nextStatus: null, reason: null }, // ACCEPTED
  7: { nextStatus: null, reason: null }, // UNKNOWN
  8: { nextStatus: "FAILED", reason: "수신 거절 (message_state=REJECTED)" },
};

interface ParsedDlr {
  messageId: string;
  /** null이면 종결 상태 아님 — 상태 유지 (ACCEPTED/ENROUTE/UNKNOWN 등) */
  nextStatus: "DELIVERED" | "FAILED" | null;
  providerStatus: string;
  providerError: string | null;
}

/**
 * deliver_sm short_message 본문에서 표준 DLR 필드를 파싱한다.
 *
 * SMPP 3.4 부속서 delivery receipt 형식 — `id:` 와 `stat:` 만 우선 추출.
 * 일부 SMSC가 추가 공백/누락이 있어도 정규식으로 관대하게 처리.
 */
function parseReceiptBody(body: string): {
  id?: string;
  stat?: string;
  err?: string;
} {
  const idMatch = body.match(/\bid:\s*(\S+)/i);
  const statMatch = body.match(/\bstat:\s*([A-Z]+)/i);
  const errMatch = body.match(/\berr:\s*(\S+)/i);
  return {
    id: idMatch?.[1],
    stat: statMatch?.[1]?.toUpperCase(),
    err: errMatch?.[1],
  };
}

/**
 * deliver_sm PDU에서 DLR 정보를 추출한다.
 *
 * 1) TLV (receipted_message_id + message_state) 우선
 * 2) 누락 시 short_message 본문 파싱
 * 3) 어느 쪽에서도 추출 실패 시 null 반환
 */
export function parseDeliverSm(pdu: PDU): ParsedDlr | null {
  const esmClass = pdu.esm_class ?? 0;
  const isReceipt = (esmClass & ESM_CLASS_DELIVERY_RECEIPT_BIT) !== 0;

  if (!isReceipt) {
    // MO (Mobile Originated) — 우리는 SMS 서비스 발송만 다루므로 무시
    return null;
  }

  // 1) TLV 우선 — 일부 SMSC는 본문 포맷이 비표준이므로 TLV가 더 신뢰 가능
  const tlvMessageId = pdu.receipted_message_id?.trim();
  const tlvState = pdu.message_state;

  // 2) short_message 본문 파싱 fallback
  const rawBody = pdu.short_message;
  let bodyText = "";
  if (typeof rawBody === "string") {
    bodyText = rawBody;
  } else if (Buffer.isBuffer(rawBody)) {
    bodyText = rawBody.toString("utf-8");
  } else if (
    rawBody &&
    typeof rawBody === "object" &&
    "message" in rawBody &&
    rawBody.message
  ) {
    const m = rawBody.message;
    bodyText = typeof m === "string" ? m : Buffer.from(m).toString("utf-8");
  }
  const parsedBody = parseReceiptBody(bodyText);

  // message_id 결정 — TLV → body 순으로 fallback
  const messageId = tlvMessageId || parsedBody.id;
  if (!messageId) {
    logger.warn("[smpp-worker] DLR에서 message_id 추출 실패", {
      metadata: { bodyText: bodyText.slice(0, 200) },
    });
    return null;
  }

  // 상태 결정 — message_state TLV 우선, body stat fallback
  if (tlvState != null) {
    const mapped = MESSAGE_STATE_MAP[tlvState];
    if (mapped) {
      return {
        messageId,
        nextStatus: mapped.nextStatus,
        providerStatus: `MSG_STATE_${tlvState}`,
        providerError: mapped.reason,
      };
    }
  }

  if (parsedBody.stat) {
    const mapped = STAT_TO_INTERNAL[parsedBody.stat];
    if (mapped) {
      const errSuffix = parsedBody.err ? ` (err=${parsedBody.err})` : "";
      return {
        messageId,
        nextStatus: mapped.nextStatus,
        providerStatus: parsedBody.stat,
        providerError: mapped.reason ? mapped.reason + errSuffix : null,
      };
    }
    // 알 수 없는 stat 코드 — 상태 유지하되 providerStatus에 기록
    return {
      messageId,
      nextStatus: null,
      providerStatus: `STAT_${parsedBody.stat}`,
      providerError: null,
    };
  }

  // 둘 다 비어있으면 알 수 없음
  return {
    messageId,
    nextStatus: null,
    providerStatus: "DLR_NO_STATUS",
    providerError: null,
  };
}

// ---------------------------------------------------------------------------
// DB 적용 — 멱등성 + 종결 상태 재전이 방지 (HTTP DLR 라우트와 동일 패턴)
// ---------------------------------------------------------------------------

/**
 * DLR 1건을 DB에 적용한다.
 *
 * - status가 이미 DELIVERED/FAILED 인 행은 업데이트 차단
 *   → 종결 후 늦게 도착한 deliver_sm이 카운터를 잘못 움직이는 것 방지
 * - updateMany.count > 0 일 때만 캠페인 카운터 증가 (중복 증가 차단)
 */
export async function applyDlr(parsed: ParsedDlr): Promise<boolean> {
  if (!parsed.nextStatus) {
    // ENROUTE/ACCEPTED/UNKNOWN 은 종결 아님 — 무시 (다음 deliver_sm을 기다림)
    return false;
  }

  try {
    const log = await prisma.smsLog.findUnique({
      where: { messageId: parsed.messageId },
      select: { id: true, status: true, campaignId: true },
    });

    if (!log) {
      logger.debug("[smpp-worker] DLR 매칭 SmsLog 없음", {
        metadata: { messageId: parsed.messageId },
      });
      return false;
    }

    if (log.status === "DELIVERED" || log.status === "FAILED") {
      // 이미 종결 — 카운터 중복 증가 방지
      return false;
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.smsLog.updateMany({
        where: {
          id: log.id,
          status: { notIn: ["DELIVERED", "FAILED"] },
        },
        data: {
          status: parsed.nextStatus!,
          providerStatus: parsed.providerStatus,
          providerError: parsed.providerError,
        },
      });

      if (log.campaignId && updated.count > 0) {
        if (parsed.nextStatus === "DELIVERED") {
          await tx.smsCampaign.update({
            where: { id: log.campaignId },
            data: { deliveredCount: { increment: 1 } },
          });
        } else if (parsed.nextStatus === "FAILED") {
          await tx.smsCampaign.update({
            where: { id: log.campaignId },
            data: { failedCount: { increment: 1 } },
          });
        }
      }
    });

    return true;
  } catch (e) {
    logger.error("[smpp-worker] DLR DB 적용 실패", {
      error: toLogError(e),
      metadata: { messageId: parsed.messageId },
    });
    return false;
  }
}
