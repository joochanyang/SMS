// ---------------------------------------------------------------------------
// Cron API — Infobip SMS 상태 보강 (DLR 누락 보험)
// ---------------------------------------------------------------------------
// DLR webhook이 누락/지연되거나, 통신사 정보(mccMnc / networkName)가 비어있는
// SmsLog 행을 Infobip /sms/1/logs API로 다시 조회해 채운다.
//
// - status='SENT' + providerName='infobip' + createdAt >= NOW()-WINDOW_HOURS
// - messageId 청크(50개)로 GET /sms/1/logs?messageId=...&messageId=... 조회
// - 응답의 status.groupName / mccMnc / price.pricePerMessage 를 SmsLog에 반영
// - 새로 DELIVERED/FAILED 로 전이된 행만 캠페인 카운터를 1씩 증가 (멱등)
//
// 호출:
//   curl -X POST https://<host>/api/cron/infobip-reconcile \
//        -H "Authorization: Bearer $CRON_SECRET"
//
// 권장 주기: 매분 또는 30초. Infobip /sms/1/logs는 일반적으로 48시간 보존되므로
// WINDOW_HOURS는 36 정도로 잡아 조회 누락 위험을 낮춘다.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withRateLimit } from '@/lib/api-rate-limit';
import { logger, toLogError } from '@/lib/logger';
import { mccMncToCarrier } from '@/lib/sms-providers/mccmnc';

/** 한 cron 실행에서 reconcile 시도할 최대 SmsLog 행 수 */
const MAX_ROWS_PER_RUN = 500;
/** Infobip /sms/1/logs 한 번 호출당 messageId 개수 (URL 길이 한계 고려) */
const CHUNK_SIZE = 50;
/** 조회 대상 시간 범위 (Infobip logs API 보존기간 ~48h 기준) */
const WINDOW_HOURS = 36;

type InfobipLogResult = {
  messageId?: unknown;
  to?: unknown;
  mccMnc?: unknown;
  price?: { pricePerMessage?: unknown; currency?: unknown };
  status?: { groupName?: unknown; name?: unknown; description?: unknown };
  error?: { name?: unknown; description?: unknown; permanent?: unknown };
};

type InfobipLogsResponse = {
  results?: InfobipLogResult[];
};

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function classifyStatus(groupName: string | null): 'DELIVERED' | 'FAILED' | null {
  if (!groupName) return null;
  const upper = groupName.toUpperCase();
  if (upper.includes('DELIVER')) return 'DELIVERED';
  if (upper.includes('UNDELIVER') || upper.includes('REJECT') || upper.includes('FAIL') || upper.includes('EXPIRED'))
    return 'FAILED';
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchInfobipLogs(
  baseUrl: string,
  apiKey: string,
  messageIds: string[],
): Promise<InfobipLogResult[]> {
  if (messageIds.length === 0) return [];
  const params = new URLSearchParams();
  for (const id of messageIds) params.append('messageId', id);
  params.set('limit', String(messageIds.length));

  const url = `${baseUrl.replace(/\/$/, '')}/sms/1/logs?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `App ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Infobip logs API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as InfobipLogsResponse;
  return Array.isArray(body?.results) ? body.results : [];
}

export async function POST(req: NextRequest) {
  // Rate limit: 분당 6회 (10초 간격), 시간당 240회
  const rl = await withRateLimit(req, { maxPerMinute: 6, maxPerHour: 240 });
  if (!rl.allowed) return rl.response!;

  // CRON_SECRET 인증 (timing-safe)
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('[InfobipReconcile] CRON_SECRET 환경변수가 설정되지 않았습니다.');
    return NextResponse.json({ error: '접근이 거부되었습니다.' }, { status: 403 });
  }
  const expected = `Bearer ${cronSecret}`;
  const isValid =
    authHeader &&
    authHeader.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  if (!isValid) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const baseUrl = process.env.INFOBIP_URL;
  const apiKey = process.env.INFOBIP_API_KEY;
  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { error: 'Infobip API 자격증명이 설정되지 않았습니다.' },
      { status: 503 },
    );
  }

  try {
    const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

    // 보강 대상: SENT(아직 종결 안 된 것) 또는 통신사 정보 미보강 행
    const candidates = await prisma.smsLog.findMany({
      where: {
        providerName: 'infobip',
        messageId: { not: null },
        createdAt: { gte: since },
        OR: [
          { status: 'SENT' },
          { networkCode: null },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS_PER_RUN,
      select: {
        id: true,
        messageId: true,
        status: true,
        campaignId: true,
        networkCode: true,
        networkName: true,
      },
    });

    if (candidates.length === 0) {
      return NextResponse.json({ message: '보강 대상 없음', scanned: 0, updated: 0 });
    }

    // messageId → SmsLog 인덱스 (응답 매칭용)
    const byMessageId = new Map(
      candidates.filter((c) => c.messageId).map((c) => [c.messageId as string, c]),
    );
    const messageIds = Array.from(byMessageId.keys());

    let totalUpdated = 0;
    let totalUnknown = 0;
    const counterDelta: Record<string, { delivered: number; failed: number }> = {};

    for (const ids of chunk(messageIds, CHUNK_SIZE)) {
      let results: InfobipLogResult[] = [];
      try {
        results = await fetchInfobipLogs(baseUrl, apiKey, ids);
      } catch (e) {
        logger.error('[InfobipReconcile] /sms/1/logs 호출 실패', { error: toLogError(e) });
        // 다음 청크는 계속 시도 (네트워크 일시 장애 대비)
        continue;
      }

      const seen = new Set<string>();

      for (const r of results) {
        const messageId = asString(r.messageId);
        if (!messageId) continue;
        const log = byMessageId.get(messageId);
        if (!log) continue;
        seen.add(messageId);

        const groupName = asString(r.status?.groupName) ?? asString(r.status?.name);
        const nextStatus = classifyStatus(groupName);
        const mccMnc = asString(r.mccMnc);
        const networkName = mccMnc ? mccMncToCarrier(mccMnc) : null;
        const providerStatus = asString(r.status?.name) ?? asString(r.status?.description);
        const providerError =
          asString(r.error?.description) ??
          (asString(r.error?.name) && asString(r.error?.name) !== 'NO_ERROR'
            ? asString(r.error?.name)
            : null);
        const pricePerMessage = asNumber(r.price?.pricePerMessage);

        // 변경할 필드만 골라 데이터 구성 (불필요한 write 방지)
        const data: Record<string, unknown> = {};
        if (nextStatus && log.status !== nextStatus) data.status = nextStatus;
        if (providerStatus) data.providerStatus = providerStatus;
        if (providerError) data.providerError = providerError;
        if (mccMnc && log.networkCode !== mccMnc) data.networkCode = mccMnc;
        if (networkName && log.networkName !== networkName) data.networkName = networkName;
        if (pricePerMessage !== null && pricePerMessage > 0) data.cost = pricePerMessage;

        if (Object.keys(data).length === 0) continue;

        // 멱등성: 상태 전이가 있는 경우 status 조건으로 race 방어
        const updateWhere = nextStatus
          ? { id: log.id, status: { not: nextStatus } }
          : { id: log.id };

        const updated = await prisma.smsLog.updateMany({
          where: updateWhere,
          data,
        });

        if (updated.count > 0) {
          totalUpdated++;
          if (log.campaignId && nextStatus && nextStatus !== log.status) {
            const bucket = (counterDelta[log.campaignId] ??= { delivered: 0, failed: 0 });
            if (nextStatus === 'DELIVERED') bucket.delivered++;
            else if (nextStatus === 'FAILED') bucket.failed++;
          }
        }
      }

      // logs API에 없는 messageId 카운트 (일반적으로 보존기간 초과)
      for (const id of ids) if (!seen.has(id)) totalUnknown++;

      // 무한루프 방지용 — pollRetryCount 증가는 별도 update로
      const unseenIds = ids.filter((id) => !seen.has(id));
      if (unseenIds.length > 0) {
        await prisma.smsLog.updateMany({
          where: { messageId: { in: unseenIds } },
          data: { pollRetryCount: { increment: 1 } },
        });
      }
    }

    // 캠페인 카운터 일괄 반영
    for (const [campaignId, delta] of Object.entries(counterDelta)) {
      if (delta.delivered === 0 && delta.failed === 0) continue;
      await prisma.smsCampaign.update({
        where: { id: campaignId },
        data: {
          ...(delta.delivered > 0 && { deliveredCount: { increment: delta.delivered } }),
          ...(delta.failed > 0 && { failedCount: { increment: delta.failed } }),
        },
      });
    }

    return NextResponse.json({
      message: 'reconcile 완료',
      scanned: candidates.length,
      queriedChunks: chunk(messageIds, CHUNK_SIZE).length,
      updated: totalUpdated,
      unknownInProvider: totalUnknown,
      campaignsTouched: Object.keys(counterDelta).length,
    });
  } catch (e) {
    logger.error('[InfobipReconcile] 처리 오류', { error: toLogError(e) });
    return NextResponse.json({ error: '내부 서버 오류입니다.' }, { status: 500 });
  }
}
