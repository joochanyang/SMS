// ---------------------------------------------------------------------------
// SmsLog 폴러 — TXG 활성일 때 PENDING/RETRY_PENDING 행을 claim 후 SMPP 송신
// ---------------------------------------------------------------------------
//
// 기존 lib/campaign-processor.ts의 안전 가드를 그대로 미러링한다:
//   - getActiveProvider() == 'txg' 가 아니면 폴링 자체를 건너뜀
//   - Kill Switch (GLOBAL_STOP/PAUSE) 시 처리 중단
//   - 캠페인이 CANCELLED/COMPLETED/FAILED 면 스킵
//   - 유저가 ACTIVE 가 아니면 스킵
//   - PostgreSQL FOR UPDATE SKIP LOCKED 로 다중 인스턴스 race 차단
//     (운영 상 단일 워커 강제이지만 안전 그물로 유지)
//   - 블랙리스트 필터 + 자동 환불 (CreditLedger 감사 기록 포함)
//
// SMPP 발송 후 결과 매핑:
//   - accepted    → SENT  + messageId (DLR 대기)
//   - rejected.retryable → RETRY_PENDING (지수 backoff)
//   - rejected.permanent → FAILED + 거절 사유
//   - ambiguous   → FAILED + SUBMIT_AMBIGUOUS  (이중과금 위험 — 재시도 금지)
//
// 멀티파트(UDH)는 첫 segment의 message_id를 SmsLog.messageId로 기록하고,
// DLR은 첫 segment 기준으로 종결한다 (TXG submit billing — 모든 segment에 과금).
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import { logger, toLogError } from "@/lib/logger";
import {
  getRetryDelayMs,
  SMS_POLICY,
  getBlacklistedNumbers,
} from "@/lib/sms-policy";
import { generateSenderId } from "@/lib/sender-id";
import type { SmppConnection, SubmitOutcome } from "./connection";
import { segmentMessage, nextReferenceNumber } from "./segmenter";

const PROVIDER_NAME = "txg";

interface ClaimedLog {
  id: string;
  campaignId: string | null;
  userId: string;
  targetNumber: string;
  messageBody: string;
  cost: number;
  retryCount: number;
}

/**
 * 활성 SMS 프로바이더가 TXG 인지 조회.
 * 그렇지 않으면 워커는 폴링을 건너뛴다 (Infobip/SMS.to 활성 시 워커가 임의로 발송 금지).
 */
async function isTxgActive(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "active_sms_provider" },
  });
  const provider = (setting?.value as { provider?: string } | null)?.provider;
  return provider === PROVIDER_NAME;
}

/** Kill Switch — GLOBAL_STOP/GLOBAL_PAUSE 시 모든 발송 중단 */
async function isKillSwitchActive(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "kill_switch" },
  });
  const level = (setting?.value as { level?: string } | null)?.level ?? "NORMAL";
  return level === "GLOBAL_STOP" || level === "GLOBAL_PAUSE";
}

// ---------------------------------------------------------------------------
// 단일 캠페인 1배치 처리
// ---------------------------------------------------------------------------

interface CampaignContext {
  id: string;
  userId: string;
  status: string;
  senderId: string | null;
}

async function loadCampaignContext(
  campaignId: string,
): Promise<CampaignContext | null> {
  const campaign = await prisma.smsCampaign.findUnique({
    where: { id: campaignId },
    select: { id: true, userId: true, status: true, senderId: true },
  });
  return campaign ?? null;
}

async function ensureSenderId(campaign: CampaignContext): Promise<string> {
  if (campaign.senderId) return campaign.senderId;
  const generated = generateSenderId();
  await prisma.smsCampaign.update({
    where: { id: campaign.id },
    data: { senderId: generated },
  });
  return generated;
}

/**
 * 캠페인 1개에 대해 1배치 발송을 시도한다.
 * 처리한 행 수 반환. 0이면 더 이상 발송할 게 없다는 의미.
 */
async function processCampaignOnce(
  conn: SmppConnection,
  campaignId: string,
  batchSize: number,
): Promise<number> {
  const campaign = await loadCampaignContext(campaignId);
  if (!campaign) return 0;

  if (["CANCELLED", "COMPLETED", "FAILED"].includes(campaign.status)) {
    return 0;
  }

  // 유저 상태 확인 — 정지/차단 시 발송 금지
  const user = await prisma.user.findUnique({
    where: { id: campaign.userId },
    select: { status: true },
  });
  if (!user || user.status !== "ACTIVE") {
    return 0;
  }

  // PENDING / RETRY_PENDING 행을 atomic 하게 SENDING 으로 선점
  const now = new Date();
  const claimed = await prisma.$queryRaw<ClaimedLog[]>`
    WITH picked AS (
      SELECT id FROM "SmsLog"
      WHERE "campaignId" = ${campaignId}
        AND (status = 'PENDING' OR (status = 'RETRY_PENDING' AND "nextRetryAt" <= ${now}))
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "SmsLog" SET status = 'SENDING'
    FROM picked
    WHERE "SmsLog".id = picked.id
    RETURNING "SmsLog".id, "SmsLog"."campaignId", "SmsLog"."userId",
              "SmsLog"."targetNumber", "SmsLog"."messageBody",
              "SmsLog".cost, "SmsLog"."retryCount"
  `;

  if (claimed.length === 0) {
    // 더 이상 처리할 PENDING이 없음 → 캠페인 완료 여부 확인
    const remaining = await prisma.smsLog.count({
      where: {
        campaignId,
        status: { in: ["PENDING", "RETRY_PENDING", "SENDING"] },
      },
    });
    if (remaining === 0) {
      await prisma.smsCampaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED" },
      });
    }
    return 0;
  }

  // 캠페인 상태를 SENDING으로 (이미 SENDING이면 no-op)
  if (campaign.status !== "SENDING") {
    await prisma.smsCampaign.update({
      where: { id: campaignId },
      data: { status: "SENDING" },
    });
  }

  // 블랙리스트 필터링 + 환불
  const blacklisted = await getBlacklistedNumbers(
    claimed.map((l) => l.targetNumber),
    campaign.userId,
  );

  const blocked = claimed.filter((l) => blacklisted.has(l.targetNumber));
  const sendable = blacklisted.size > 0
    ? claimed.filter((l) => !blacklisted.has(l.targetNumber))
    : claimed;

  if (blocked.length > 0) {
    await applyBlacklistRefund(blocked, campaign);
  }

  if (sendable.length === 0) {
    return blocked.length;
  }

  // 캠페인 메타데이터로 senderId만 보존 (실제 SMPP 송신 시에는 사용 안 함)
  // 한국 통신사 정책상 source_addr는 빈 값으로 보내야 하므로 sendOneLog에 전달하지 않는다.
  await ensureSenderId(campaign);

  // SMPP 발송 (segmenter로 분할 후 첫 segment의 message_id를 기록)
  let processedDelta = 0;
  let failedDelta = 0;

  // 각 행을 병렬로 처리하되 SMPP 윈도우가 자동으로 throttle 한다 (connection.submit 내부)
  await Promise.all(
    sendable.map(async (log) => {
      const outcome = await sendOneLog(conn, log);
      const result = await persistOutcome(log, outcome);
      processedDelta += 1;
      if (result === "FAILED") failedDelta += 1;
    }),
  );

  // 캠페인 카운터 일괄 업데이트
  if (processedDelta > 0) {
    await prisma.smsCampaign.update({
      where: { id: campaignId },
      data: {
        processedCount: { increment: processedDelta },
        ...(failedDelta > 0 && { failedCount: { increment: failedDelta } }),
      },
    });
  }

  // 잔여 확인 후 COMPLETED 전환
  const remaining = await prisma.smsLog.count({
    where: {
      campaignId,
      status: { in: ["PENDING", "RETRY_PENDING", "SENDING"] },
    },
  });
  if (remaining === 0) {
    await prisma.smsCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" },
    });
  }

  return claimed.length;
}

// ---------------------------------------------------------------------------
// 1행 SMPP 송신 — segmenter + connection.submit
// ---------------------------------------------------------------------------

interface PerLogOutcome {
  /** 첫 segment의 message_id (SmsLog.messageId 에 기록) */
  messageId: string | null;
  /** 최종 매핑된 SmsLog status */
  nextStatus: "SENT" | "RETRY_PENDING" | "FAILED";
  providerStatus: string;
  providerError: string | null;
}

async function sendOneLog(
  conn: SmppConnection,
  log: ClaimedLog,
): Promise<PerLogOutcome> {
  const ref = nextReferenceNumber();
  const segments = segmentMessage(log.messageBody, ref);

  // source_addr는 항상 빈 값으로 송신.
  // 한국 통신사가 알파벳 sender_id를 차단(UNDELIV err=267)하므로 비워서 보내야 한다.
  // 통신사가 자체 게이트웨이 번호로 덮어쓰므로 수신자에게 표시되는 발신번호는
  // TXG가 통제할 수 없다. (2026-04-27 검증 — sender_id 채울 시 100% UNDELIV)
  // senderId는 SmsCampaign.senderId 컬럼에 메타데이터로만 보존.

  // 첫 segment 결과로 SmsLog 상태 결정. 나머지 segment는 송신만 하고 결과는 로깅만.
  // (TXG submit billing — 모든 segment에 과금되지만 DLR 추적은 첫 part로 단순화)
  const firstOutcome = await conn.submit({
    destination_addr: log.targetNumber,
    source_addr: "",
    short_message: segments[0].shortMessage,
    data_coding: segments[0].dataCoding,
    registered_delivery: 1, // SMSC delivery receipt 요청
  });

  const firstResult = mapOutcome(firstOutcome, log.retryCount);

  // 멀티파트 — 나머지 segment 발송 (첫 part가 ambiguous/permanent fail 이면 더 보내지 않음)
  if (
    segments.length > 1 &&
    firstOutcome.kind === "accepted"
  ) {
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const outcome = await conn.submit({
        destination_addr: log.targetNumber,
        source_addr: "",
        short_message: seg.shortMessage,
        data_coding: seg.dataCoding,
        registered_delivery: 1,
      });
      logSegmentResult(log, i + 1, segments.length, outcome);
    }
  } else if (segments.length > 1) {
    logger.warn(
      `[smpp-worker] 멀티파트 첫 segment 실패 — 후속 segment ${segments.length - 1}건 미발송`,
      {
        campaignId: log.campaignId ?? undefined,
        metadata: {
          smsLogId: log.id,
          firstOutcome: firstOutcome.kind,
        },
      },
    );
  }

  return firstResult;
}

function mapOutcome(
  outcome: SubmitOutcome,
  retryCount: number,
): PerLogOutcome {
  if (outcome.kind === "accepted") {
    return {
      messageId: outcome.messageId,
      nextStatus: "SENT",
      providerStatus: "SUBMITTED",
      providerError: null,
    };
  }

  if (outcome.kind === "rejected") {
    const isRetryExceeded = retryCount + 1 >= SMS_POLICY.maxRetries;
    if (outcome.retryable && !isRetryExceeded) {
      return {
        messageId: null,
        nextStatus: "RETRY_PENDING",
        providerStatus: `SMPP_${outcome.commandStatus.toString(16).toUpperCase()}`,
        providerError: `SMPP 일시 거절 (status=0x${outcome.commandStatus.toString(16)})`,
      };
    }
    return {
      messageId: null,
      nextStatus: "FAILED",
      providerStatus: `SMPP_${outcome.commandStatus.toString(16).toUpperCase()}`,
      providerError: outcome.retryable
        ? "SMPP 일시 거절 — 최대 재시도 초과"
        : `SMPP 거절 (status=0x${outcome.commandStatus.toString(16)})`,
    };
  }

  // ambiguous — 응답 미수신 (timeout 또는 disconnect). 재시도 금지 = 이중과금 방지.
  return {
    messageId: null,
    nextStatus: "FAILED",
    providerStatus: "SUBMIT_AMBIGUOUS",
    providerError:
      outcome.reason === "timeout"
        ? "SMPP submit_sm 응답 미수신 (timeout) — 이중과금 방지를 위해 재시도하지 않음. 운영자 확인 필요"
        : "SMPP 연결 끊김 (disconnect) 시점 in-flight — 이중과금 방지를 위해 재시도하지 않음. 운영자 확인 필요",
  };
}

function logSegmentResult(
  log: ClaimedLog,
  partNum: number,
  totalParts: number,
  outcome: SubmitOutcome,
): void {
  if (outcome.kind === "accepted") {
    logger.debug(
      `[smpp-worker] multipart ${partNum}/${totalParts} ok messageId=${outcome.messageId}`,
      {
        campaignId: log.campaignId ?? undefined,
        metadata: { smsLogId: log.id },
      },
    );
  } else {
    logger.warn(
      `[smpp-worker] multipart ${partNum}/${totalParts} 실패 — 일부만 전달될 수 있음`,
      {
        campaignId: log.campaignId ?? undefined,
        metadata: {
          smsLogId: log.id,
          outcome: outcome.kind,
          ...(outcome.kind === "rejected" && {
            commandStatus: outcome.commandStatus,
          }),
          ...(outcome.kind === "ambiguous" && { reason: outcome.reason }),
        },
      },
    );
  }
}

// ---------------------------------------------------------------------------
// 발송 결과를 SmsLog에 반영
// ---------------------------------------------------------------------------

async function persistOutcome(
  log: ClaimedLog,
  outcome: PerLogOutcome,
): Promise<"SENT" | "RETRY_PENDING" | "FAILED"> {
  const data: Record<string, unknown> = {
    status: outcome.nextStatus,
    providerName: PROVIDER_NAME,
    providerStatus: outcome.providerStatus,
    providerError: outcome.providerError,
  };

  if (outcome.messageId) {
    data.messageId = outcome.messageId;
  }

  if (outcome.nextStatus === "RETRY_PENDING") {
    data.retryCount = log.retryCount + 1;
    data.nextRetryAt = new Date(Date.now() + getRetryDelayMs(log.retryCount));
  } else {
    data.nextRetryAt = null;
  }

  await prisma.smsLog.update({
    where: { id: log.id },
    data,
  });

  return outcome.nextStatus;
}

// ---------------------------------------------------------------------------
// 블랙리스트 환불 — campaign-processor.ts 와 동일 패턴
// ---------------------------------------------------------------------------

async function applyBlacklistRefund(
  blocked: ClaimedLog[],
  campaign: CampaignContext,
): Promise<void> {
  const refundAmount = blocked.reduce((sum, l) => sum + Number(l.cost), 0);
  await prisma.$transaction(async (tx) => {
    for (const log of blocked) {
      await tx.smsLog.update({
        where: { id: log.id },
        data: {
          status: "FAILED",
          providerName: PROVIDER_NAME,
          providerError: "블랙리스트 차단",
        },
      });
    }
    await tx.smsCampaign.update({
      where: { id: campaign.id },
      data: {
        processedCount: { increment: blocked.length },
        failedCount: { increment: blocked.length },
      },
    });
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
          description: `블랙리스트 차단 환불 (${blocked.length}건)`,
        },
      });
      await tx.creditLedger.create({
        data: {
          userId: campaign.userId,
          type: "CAMPAIGN_REFUND",
          amount: refundAmount,
          balanceAfter: updatedUser.credits,
          referenceType: "CAMPAIGN",
          referenceId: campaign.id,
          description: `블랙리스트 차단 환불 (${blocked.length}건)`,
          idempotencyKey: `blacklist-refund-${campaign.id}-${Date.now()}`,
        },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// 메인 폴링 루프 — 진행 가능한 캠페인을 순회 처리
// ---------------------------------------------------------------------------

export interface PollerOptions {
  pollIntervalMs: number;
  batchSize: number;
}

export class CampaignPoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopRequested = false;

  constructor(
    private readonly conn: SmppConnection,
    private readonly opts: PollerOptions,
  ) {}

  start(): void {
    if (this.timer) return;
    const tick = async () => {
      if (this.stopRequested) return;
      if (this.running) {
        this.scheduleNext();
        return;
      }
      this.running = true;
      try {
        await this.runOnce();
      } catch (e) {
        logger.error("[smpp-worker] 폴링 루프 예외", { error: toLogError(e) });
      } finally {
        this.running = false;
        this.scheduleNext();
      }
    };
    void tick();
  }

  private scheduleNext(): void {
    if (this.stopRequested) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.start();
    }, this.opts.pollIntervalMs);
  }

  private async runOnce(): Promise<void> {
    if (!this.conn.isReady()) {
      // SMPP 미연결 시 대기 (재접속 backoff 동안 처리 안 함)
      return;
    }

    if (!(await isTxgActive())) return;
    if (await isKillSwitchActive()) {
      logger.warn("[smpp-worker] Kill Switch 활성 — 발송 일시 중단");
      return;
    }

    // 처리 가능한 캠페인 조회 (PENDING/RETRY_PENDING 행이 있는 캠페인)
    const now = new Date();
    const candidates = await prisma.smsLog.groupBy({
      by: ["campaignId"],
      where: {
        campaignId: { not: null },
        OR: [
          { status: "PENDING" },
          { status: "RETRY_PENDING", nextRetryAt: { lte: now } },
        ],
      },
      _count: { _all: true },
      orderBy: { _count: { campaignId: "desc" } },
      take: 20, // 한 tick에서 최대 20개 캠페인 순회
    });

    if (candidates.length === 0) return;

    for (const c of candidates) {
      if (this.stopRequested) return;
      if (!c.campaignId) continue;
      try {
        await processCampaignOnce(this.conn, c.campaignId, this.opts.batchSize);
      } catch (e) {
        logger.error("[smpp-worker] 캠페인 처리 예외", {
          campaignId: c.campaignId,
          error: toLogError(e),
        });
      }
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // 진행 중이면 종료까지 대기 (최대 30초)
    const deadline = Date.now() + 30_000;
    while (this.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
