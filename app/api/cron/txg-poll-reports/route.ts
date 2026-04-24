// ---------------------------------------------------------------------------
// Cron API — TXG getreport 주기 폴링
// Push DLR이 누락/지연될 경우를 대비한 이중화 장치.
// 최근 24시간 내 SENT 상태인 TXG SmsLog를 모아 /getreport로 상태를 조회하고,
// 결과에 따라 SmsLog 상태와 캠페인 카운터를 업데이트한다.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-rate-limit";
import { logger, toLogError } from "@/lib/logger";
import { getProviderByName } from "@/lib/sms-providers/router";
import {
  mapTxgEventToStatus,
  type TxgProvider,
  type TxgReportResult,
} from "@/lib/sms-providers/txg";

// 상한/청크 크기 — getreport는 ids 쿼리 파라미터이므로 URL 길이 보호 차원에서 500건 단위로 끊는다.
const POLL_WINDOW_MS = 24 * 60 * 60 * 1000; // 최근 24시간
const MAX_POLL_TARGETS = 5000; // 단일 실행에서 폴링할 최대 로그 수
const CHUNK_SIZE = 500;
// 5분 주기 × 12회 = 60분. 60분간 TXG DLR이 종결 상태를 주지 않으면 "전달 불가 판정 불가능"으로 간주하여
// FAILED + providerStatus=DELIVERY_UNKNOWN으로 종결 (좀비 SENT 박제 방지).
const MAX_POLL_ATTEMPTS = 12;

export async function POST(req: NextRequest) {
  // Rate limit: 분당 5회, 시간당 120회
  const rl = await withRateLimit(req, { maxPerMinute: 5, maxPerHour: 120 });
  if (!rl.allowed) return rl.response!;

  // 인증: CRON_SECRET 검증
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.error("[Cron] CRON_SECRET 환경변수가 설정되지 않았습니다.");
    return NextResponse.json(
      { error: "접근이 거부되었습니다." },
      { status: 403 },
    );
  }

  const expected = `Bearer ${cronSecret}`;
  const isValid =
    authHeader &&
    authHeader.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  if (!isValid) {
    return NextResponse.json(
      { error: "인증이 필요합니다." },
      { status: 401 },
    );
  }

  try {
    // TXG 프로바이더 인스턴스 확보 — 미설정이면 즉시 스킵
    // instanceof 대신 name 비교로 HMR/모듈 중복 로드 환경에서도 안전하게 판별
    const provider = getProviderByName("txg") as TxgProvider;
    if (provider.name !== "txg" || !provider.isConfigured()) {
      logger.warn(
        "[Cron] TXG 프로바이더 미설정 — 폴링을 건너뜁니다 (TXG_ACCOUNT/TXG_PASSWORD 확인 필요).",
      );
      return NextResponse.json({
        message: "TXG 프로바이더가 설정되지 않아 폴링을 건너뛰었습니다.",
        polled: 0,
        updated: 0,
        skipped: "provider_not_configured",
      });
    }

    // 폴링 대상: 최근 24시간 내 SENT 상태인 TXG 로그
    const windowStart = new Date(Date.now() - POLL_WINDOW_MS);
    const targets = await prisma.smsLog.findMany({
      where: {
        providerName: "txg",
        status: "SENT",
        messageId: { not: null },
        createdAt: { gte: windowStart },
      },
      select: {
        id: true,
        messageId: true,
        campaignId: true,
        status: true,
      },
      take: MAX_POLL_TARGETS,
    });

    if (targets.length === 0) {
      return NextResponse.json({
        message: "폴링할 대상이 없습니다.",
        polled: 0,
        updated: 0,
        skippedChunks: 0,
      });
    }

    // messageId(문자열) → 숫자 변환 + 로그 조회용 맵 구성
    const logByMessageId = new Map<
      string,
      { id: string; campaignId: string | null; status: string }
    >();
    const numericIds: number[] = [];
    for (const log of targets) {
      if (!log.messageId) continue;
      const numeric = Number(log.messageId);
      if (!Number.isFinite(numeric)) continue;
      logByMessageId.set(log.messageId, {
        id: log.id,
        campaignId: log.campaignId,
        status: log.status,
      });
      numericIds.push(numeric);
    }

    let polled = 0;
    let updated = 0;
    let skippedChunks = 0;
    // 이번 런에서 종결 상태(DELIVERED/FAILED)로 업데이트된 로그 ID — pollRetryCount 증가 대상에서 제외
    const terminalIds = new Set<string>();
    // 이번 런에서 유효한 /getreport 응답을 받은(= TXG가 정상적으로 답한) 로그 ID —
    // 이 집합에 속한 로그 중 종결되지 않은 것만 pollRetryCount 증가.
    // TXG 장애로 전체 청크가 실패한 경우는 제외되어 정상 로그가 부당하게 DELIVERY_UNKNOWN이 되지 않도록 보호.
    const successfullyCheckedIds = new Set<string>();

    // 500건 단위 청크로 /getreport 호출
    for (let i = 0; i < numericIds.length; i += CHUNK_SIZE) {
      const chunk = numericIds.slice(i, i + CHUNK_SIZE);

      let report: TxgReportResult;
      try {
        report = await provider.getReport(chunk);
      } catch (e) {
        logger.warn("[Cron] TXG getreport 호출 실패, 청크 스킵", {
          error: toLogError(e),
          metadata: { chunkSize: chunk.length },
        });
        skippedChunks++;
        continue;
      }

      if (report.status !== 0 || !Array.isArray(report.array)) {
        logger.warn("[Cron] TXG getreport 비정상 응답, 청크 스킵", {
          metadata: { status: report.status, chunkSize: chunk.length },
        });
        skippedChunks++;
        continue;
      }

      // 유효 응답을 받은 청크의 모든 로그를 "체크됨"으로 마킹
      for (const numericId of chunk) {
        const log = logByMessageId.get(String(numericId));
        if (log) successfullyCheckedIds.add(log.id);
      }

      polled += report.array.length;

      for (const event of report.array) {
        if (!Array.isArray(event) || event.length < 4) continue;
        const [id, , , sendStatus, deliverStatus] = event;
        if (id == null) continue;

        const messageId = String(id);
        const log = logByMessageId.get(messageId);
        if (!log) continue;

        const { nextStatus, providerStatus, providerError } =
          mapTxgEventToStatus(
            Number(sendStatus),
            deliverStatus != null ? Number(deliverStatus) : undefined,
          );

        // 상태 변화 없음 또는 이미 종결 상태면 스킵
        if (!nextStatus) continue;
        if (log.status === "DELIVERED" || log.status === "FAILED") continue;

        // app/api/txg/report/route.ts와 동일한 멱등성 + 종결 상태 재전이 방지 패턴
        await prisma.$transaction(async (tx) => {
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

          // 종결 상태로 전이된 경우에만 terminalIds에 기록 (count > 0 = 실제로 업데이트 발생)
          if (
            updatedRows.count > 0 &&
            (nextStatus === "DELIVERED" || nextStatus === "FAILED")
          ) {
            terminalIds.add(log.id);
          }
        });

        updated++;
      }
    }

    // 좀비 SENT 종결 루틴 — 유효 응답을 받았지만 아직 종결되지 않은 로그의 pollRetryCount 증가,
    // 한도 초과 시 FAILED + DELIVERY_UNKNOWN으로 종결하여 24h 폴링 윈도우 이탈 후 박제되는 것을 방지.
    let terminated = 0;
    const unresolvedIds: string[] = [];
    for (const id of successfullyCheckedIds) {
      if (!terminalIds.has(id)) unresolvedIds.push(id);
    }

    if (unresolvedIds.length > 0) {
      // 1) 체크됐지만 종결되지 않은 로그의 pollRetryCount 증가
      await prisma.smsLog.updateMany({
        where: { id: { in: unresolvedIds }, status: "SENT" },
        data: { pollRetryCount: { increment: 1 } },
      });

      // 2) 증가 후 한도(MAX_POLL_ATTEMPTS) 초과한 로그를 조회
      const zombies = await prisma.smsLog.findMany({
        where: {
          id: { in: unresolvedIds },
          status: "SENT",
          pollRetryCount: { gte: MAX_POLL_ATTEMPTS },
        },
        select: { id: true, campaignId: true },
      });

      // 3) 좀비 로그를 FAILED + DELIVERY_UNKNOWN으로 종결
      //    기존 Push DLR과의 경합은 status: { notIn: ["DELIVERED", "FAILED"] } 가드로 차단.
      for (const zombie of zombies) {
        await prisma.$transaction(async (tx) => {
          const updatedRows = await tx.smsLog.updateMany({
            where: {
              id: zombie.id,
              status: { notIn: ["DELIVERED", "FAILED"] },
            },
            data: {
              status: "FAILED",
              providerStatus: "DELIVERY_UNKNOWN",
              providerError: `TXG DLR 응답 없음 — 폴링 ${MAX_POLL_ATTEMPTS}회 한도 초과 (delivery unknown)`,
            },
          });

          if (updatedRows.count > 0) {
            if (zombie.campaignId) {
              await tx.smsCampaign.update({
                where: { id: zombie.campaignId },
                data: { failedCount: { increment: 1 } },
              });
            }
            terminated++;
          }
        });
      }
    }

    logger.info(
      `[Cron] TXG 폴링 완료: ${polled}건 조회, ${updated}건 상태 업데이트, ${terminated}건 DELIVERY_UNKNOWN 종결, ${skippedChunks}개 청크 스킵`,
    );

    return NextResponse.json({
      message: `${polled}건 폴링, ${updated}건 상태 업데이트, ${terminated}건 DELIVERY_UNKNOWN 종결`,
      polled,
      updated,
      terminated,
      skippedChunks,
    });
  } catch (e) {
    logger.error("[Cron] TXG 폴링 오류", { error: toLogError(e) });
    return NextResponse.json(
      { error: "내부 서버 오류입니다." },
      { status: 500 },
    );
  }
}
