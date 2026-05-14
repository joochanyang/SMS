// ---------------------------------------------------------------------------
// Cron API — HLR Lookup 통신사 정확도 보강
// ---------------------------------------------------------------------------
// 발송 완료된 SmsLog의 통신사 정보(networkName / networkCode)는 DLR이 준
// "라우팅 통신사"라, 한국 번호이동(MNP) 가입자는 실제 가입 통신사와 다르다.
// 이 cron은 Infobip Number Lookup(HLR) API로 각 번호의 *실제 가입 통신사*를
// 조회해 SmsLog를 권위 있는 값으로 덮어쓴다. (발송 전 필터링이 아니라 사후 보강)
//
// 데이터 흐름 (설계 스펙 §4):
//   1. 최근 WINDOW_DAYS 내 status IN (SENT,DELIVERED) + providerName='infobip'
//      + hlrCheckedAt IS NULL 인 SmsLog → 고유 targetNumber 집합 수집
//   2. HlrLookup 캐시 조회 — lookedUpAt >= now-30d 면 캐시 HIT (재조회 안 함, 비용 0)
//   3. 캐시 MISS/만료 번호만 HLR_MAX_LOOKUPS_PER_RUN 상한 내에서 lookupNumbers() 호출
//   4. HLR 결과를 HlrLookup 테이블에 upsert (phone 유니크 키)
//   5. 캐시 HIT + 신규 조회 결과를 합쳐 해당 SmsLog 행을 정확값으로 updateMany (멱등)
//
// 호출:
//   curl -X POST https://<host>/api/cron/hlr-enrich \
//        -H "Authorization: Bearer $CRON_SECRET"
//
// 권장 주기: 10분. INFOBIP_HLR_ENABLED='true' 가 아니면 안전하게 no-op return.
// ⚠️ Infobip 계정에서 Number Lookup 서비스가 비활성이면 lookupNumbers()가
//   HlrAccountInactiveError를 던진다 — 경고 로그 1회 + 해당 실행 중단(부분 결과 응답).
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withRateLimit } from '@/lib/api-rate-limit';
import { logger, toLogError } from '@/lib/logger';
import { normalizePhone } from '@/lib/sms-policy';
import {
  lookupNumbers,
  isHlrEnabled,
  HlrAccountInactiveError,
  type HlrResult,
} from '@/lib/sms-providers/infobip-hlr';

/** 보강 대상 SmsLog 조회 시간 범위 (일) */
const WINDOW_DAYS = 7;
/** 한 cron 실행에서 스캔할 최대 SmsLog 행 수 */
const MAX_ROWS_PER_RUN = 2000;
/** HlrLookup 캐시 TTL (일) — lookedUpAt 이 이보다 오래되면 stale → 재조회 */
const CACHE_TTL_DAYS = 30;
/** 1회 실행당 신규 HLR 조회 수 하드 캡 (비용 가드). 환경변수로 조정 가능. */
const DEFAULT_MAX_LOOKUPS_PER_RUN = 500;

function getMaxLookupsPerRun(): number {
  const raw = process.env.HLR_MAX_LOOKUPS_PER_RUN;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_LOOKUPS_PER_RUN;
}

export async function POST(req: NextRequest) {
  // Rate limit: 분당 6회 (10초 간격), 시간당 240회
  const rl = await withRateLimit(req, { maxPerMinute: 6, maxPerHour: 240 });
  if (!rl.allowed) return rl.response!;

  // CRON_SECRET 인증 (timing-safe)
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('[HlrEnrich] CRON_SECRET 환경변수가 설정되지 않았습니다.');
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

  // 토글 가드: HLR 비활성 시 즉시 no-op return (계정 활성화 후 INFOBIP_HLR_ENABLED=true 로 켠다)
  if (!isHlrEnabled()) {
    return NextResponse.json({
      skipped: true,
      reason: 'INFOBIP_HLR_ENABLED 비활성',
    });
  }

  try {
    const now = Date.now();
    const since = new Date(now - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const cacheCutoff = new Date(now - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const maxLookups = getMaxLookupsPerRun();

    // --- 1단계: 보강 대상 SmsLog → 고유 번호 집합 수집 -----------------------
    const candidates = await prisma.smsLog.findMany({
      where: {
        providerName: 'infobip',
        status: { in: ['SENT', 'DELIVERED'] },
        hlrCheckedAt: null,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS_PER_RUN,
      select: { targetNumber: true },
    });

    // targetNumber 를 E.164 정규화하여 고유 집합으로 수집
    const uniqueNumbers = new Set<string>();
    for (const c of candidates) {
      const normalized = normalizePhone(c.targetNumber);
      if (normalized) uniqueNumbers.add(normalized);
    }
    const allNumbers = Array.from(uniqueNumbers);

    if (allNumbers.length === 0) {
      return NextResponse.json({
        message: '보강 대상 없음',
        scanned: 0,
        cacheHits: 0,
        lookedUp: 0,
        enrichedRows: 0,
        accountInactive: false,
      });
    }

    // --- 2단계: HlrLookup 캐시 조회 (30일 TTL) ------------------------------
    const cachedRows = await prisma.hlrLookup.findMany({
      where: {
        phone: { in: allNumbers },
        lookedUpAt: { gte: cacheCutoff },
      },
      select: { phone: true, carrierName: true, mccMnc: true },
    });
    const cacheByPhone = new Map(cachedRows.map((r) => [r.phone, r]));
    const cacheHitNumbers = allNumbers.filter((p) => cacheByPhone.has(p));
    // 캐시 MISS/만료 번호만 신규 조회 대상. 비용 하드 캡 적용 — 초과분은 다음 실행으로 미룸.
    const missNumbers = allNumbers.filter((p) => !cacheByPhone.has(p));
    const toLookup = missNumbers.slice(0, maxLookups);

    // --- 3단계: 캐시 MISS 번호 HLR 조회 ------------------------------------
    // 각 번호의 (carrierName, mccMnc) — 캐시 HIT + 신규 조회 결과를 합쳐 보강에 사용
    const enrichByPhone = new Map<string, { carrierName: string | null; mccMnc: string | null }>();
    for (const [phone, row] of cacheByPhone) {
      enrichByPhone.set(phone, { carrierName: row.carrierName, mccMnc: row.mccMnc });
    }

    let accountInactive = false;
    let lookedUpResults: HlrResult[] = [];
    if (toLookup.length > 0) {
      try {
        lookedUpResults = await lookupNumbers(toLookup);
      } catch (e) {
        if (e instanceof HlrAccountInactiveError) {
          // 계정 미활성 — 더 호출해도 의미 없고 무한 과금 시도가 되므로 경고 1회 + 실행 중단.
          // 이번 실행에서 이미 모은 캐시 HIT 결과는 그대로 보강에 사용 (부분 결과 응답).
          logger.warn('[HlrEnrich] Infobip Number Lookup 서비스 비활성 — 이번 실행 중단', {
            context: 'HlrEnrich',
            error: toLogError(e),
          });
          accountInactive = true;
        } else {
          // 그 외 에러는 lookupNumbers 내부에서 던진 것 — 이번 실행 신규 조회는 포기하고
          // 캐시 HIT 결과만으로 보강 진행 (다음 실행에서 재시도).
          logger.error('[HlrEnrich] HLR 조회 중 오류 — 신규 조회 건너뜀', {
            context: 'HlrEnrich',
            error: toLogError(e),
          });
        }
      }
    }

    // --- 4단계: HLR 결과를 HlrLookup 테이블에 upsert -------------------------
    for (const r of lookedUpResults) {
      try {
        await prisma.hlrLookup.upsert({
          where: { phone: r.phone },
          create: {
            phone: r.phone,
            mccMnc: r.mccMnc,
            carrierName: r.carrierName,
            countryCode: r.countryCode,
            ported: r.ported,
            reachable: r.reachable,
            rawResponse: r.raw as object,
            lookedUpAt: new Date(),
          },
          update: {
            mccMnc: r.mccMnc,
            carrierName: r.carrierName,
            countryCode: r.countryCode,
            ported: r.ported,
            reachable: r.reachable,
            rawResponse: r.raw as object,
            lookedUpAt: new Date(),
          },
        });
        // 신규 조회 결과도 보강 맵에 합류 (캐시 HIT과 동일하게 5단계에서 사용)
        enrichByPhone.set(r.phone, { carrierName: r.carrierName, mccMnc: r.mccMnc });
      } catch (e) {
        // 개별 번호 upsert 실패는 다음 번호 진행 (한 건 때문에 실행 전체를 버리지 않음)
        logger.error('[HlrEnrich] HlrLookup upsert 실패', {
          context: 'HlrEnrich',
          error: toLogError(e),
        });
      }
    }

    // --- 5단계: SmsLog 행을 HLR 정확값으로 보강 (멱등 updateMany) ------------
    // hlrCheckedAt IS NULL 조건으로 멱등 보장 — 재실행해도 중복 쓰기 없음.
    // 통신사 데이터가 전혀 없는 결과(carrierName·mccMnc 모두 null)는 보강 스킵 —
    // hlrCheckedAt을 찍지 않아야 계정 활성화/번호 정상화 후 재조회 대상으로 남는다.
    let enrichedRows = 0;
    let skippedNoData = 0;
    for (const [phone, info] of enrichByPhone) {
      if (!info.carrierName && !info.mccMnc) {
        skippedNoData++;
        continue;
      }
      try {
        const updated = await prisma.smsLog.updateMany({
          where: {
            targetNumber: phone,
            providerName: 'infobip',
            status: { in: ['SENT', 'DELIVERED'] },
            hlrCheckedAt: null,
          },
          data: {
            networkName: info.carrierName,
            networkCode: info.mccMnc,
            hlrCheckedAt: new Date(),
          },
        });
        enrichedRows += updated.count;
      } catch (e) {
        logger.error('[HlrEnrich] SmsLog 보강 update 실패', {
          context: 'HlrEnrich',
          error: toLogError(e),
        });
      }
    }

    return NextResponse.json({
      message: accountInactive
        ? 'HLR 보강 중단됨 (Infobip Number Lookup 서비스 비활성)'
        : 'HLR 보강 완료',
      scanned: allNumbers.length, // 수집된 고유 번호 수
      cacheHits: cacheHitNumbers.length, // 30일 캐시로 재조회 없이 해결된 번호 수
      lookedUp: lookedUpResults.length, // 이번 실행에서 신규 HLR 조회한 번호 수
      enrichedRows, // 정확값으로 갱신된 SmsLog 행 수
      skippedNoData, // 통신사 데이터 없어 보강 스킵된 번호 수 (재조회 대상으로 유지)
      deferred: Math.max(0, missNumbers.length - toLookup.length), // 하드 캡으로 다음 실행에 미뤄진 번호 수
      accountInactive, // Infobip 계정 미활성 여부
    });
  } catch (e) {
    logger.error('[HlrEnrich] 처리 오류', { context: 'HlrEnrich', error: toLogError(e) });
    return NextResponse.json({ error: '내부 서버 오류입니다.' }, { status: 500 });
  }
}
