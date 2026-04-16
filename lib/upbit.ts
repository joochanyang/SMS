/**
 * Upbit USDT/KRW 실시간 시세 조회 모듈
 * 
 * - REST API: 즉시 최신가 조회 (fallback)
 * - WebSocket 시세는 클라이언트에서 직접 연결
 * - 서버 사이드 캐싱 (5초 TTL) 으로 API 호출 최소화
 */

import { logger, toLogError } from '@/lib/logger';

interface UpbitTicker {
  market: string;
  trade_price: number;      // 최근 체결가
  change_rate: number;       // 변동률
  signed_change_price: number; // 변동가
  acc_trade_volume_24h: number; // 24시간 거래량
  timestamp: number;
}

// 서버 사이드 시세 캐시 (5초 TTL)
let cachedTicker: {
  price: number;
  changeRate: number;
  changePrice: number;
  volume24h: number;
  timestamp: number;
} | null = null;
const CACHE_TTL_MS = 5000;

/**
 * Upbit REST API로 USDT/KRW 현재가 조회
 * 캐시된 값이 5초 이내이면 캐시 반환
 */
export async function getUsdtKrwPrice(): Promise<{
  price: number;
  changeRate: number;
  changePrice: number;
  volume24h: number;
  timestamp: number;
}> {
  // 캐시 체크
  if (cachedTicker && Date.now() - cachedTicker.timestamp < CACHE_TTL_MS) {
    return { ...cachedTicker };
  }

  try {
    const res = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT', {
      headers: { Accept: 'application/json' },
      next: { revalidate: 5 },
    });

    if (!res.ok) {
      throw new Error(`Upbit API error: ${res.status}`);
    }

    const data: UpbitTicker[] = await res.json();
    const ticker = data[0];

    if (!ticker) {
      throw new Error('No ticker data returned');
    }

    // 캐시 업데이트 (전체 ticker 데이터 저장)
    cachedTicker = {
      price: ticker.trade_price,
      changeRate: ticker.change_rate,
      changePrice: ticker.signed_change_price,
      volume24h: ticker.acc_trade_volume_24h,
      timestamp: ticker.timestamp,
    };

    return { ...cachedTicker };
  } catch (error) {
    // 캐시된 값이 있으면 오래되더라도 반환 (fallback)
    if (cachedTicker) {
      logger.warn('[Upbit] REST API failed, using stale cache', { error: toLogError(error) });
      return { ...cachedTicker };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// KRW/USD 환율 조회 (5분 캐시, fallback 1380)
// ---------------------------------------------------------------------------

const EXCHANGE_RATE_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const EXCHANGE_RATE_MAX_STALENESS_MS = 60 * 60 * 1000; // 1시간
const FALLBACK_EXCHANGE_RATE = 1380;

let exchangeRateCache: {
  rate: number;
  fetchedAt: number;
} | null = null;

/**
 * KRW/USD 환율 조회
 * - open.er-api.com 무료 API 사용
 * - 5분 캐시 적용
 * - API 실패 시 최근 성공 조회가 1시간 이내이면 캐시 반환, 초과 시 에러
 * - 캐시 자체가 없으면 fallback 1380 사용
 */
export async function getKrwUsdRate(): Promise<number> {
  const now = Date.now();

  // 캐시가 유효하면 바로 반환
  if (exchangeRateCache && now - exchangeRateCache.fetchedAt < EXCHANGE_RATE_CACHE_TTL_MS) {
    return exchangeRateCache.rate;
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`환율 API 오류: ${res.status}`);
    }

    const data = await res.json();
    const krwRate = data?.rates?.KRW;

    if (typeof krwRate !== "number" || krwRate <= 0) {
      throw new Error("유효하지 않은 환율 데이터입니다.");
    }

    exchangeRateCache = { rate: krwRate, fetchedAt: now };
    return krwRate;
  } catch (error) {
    logger.warn("[환율] API 조회 실패, 캐시 확인", { error: toLogError(error) });

    // 캐시가 있고 1시간 이내이면 stale 캐시 반환
    if (exchangeRateCache && now - exchangeRateCache.fetchedAt < EXCHANGE_RATE_MAX_STALENESS_MS) {
      logger.warn("[환율] stale 캐시 사용", { metadata: { rate: exchangeRateCache.rate } });
      return exchangeRateCache.rate;
    }

    // 캐시 자체가 없으면(서버 최초 기동) fallback 사용
    if (!exchangeRateCache) {
      logger.warn("[환율] 캐시 없음, fallback 환율 사용", { metadata: { rate: FALLBACK_EXCHANGE_RATE } });
      exchangeRateCache = { rate: FALLBACK_EXCHANGE_RATE, fetchedAt: now };
      return FALLBACK_EXCHANGE_RATE;
    }

    // 캐시가 1시간 초과 → 에러
    throw new Error(
      "환율 정보를 가져올 수 없습니다. 마지막 조회가 1시간을 초과했습니다.",
    );
  }
}

/**
 * KRW → USD 환산 (실시간 환율 사용)
 */
export async function krwToUsd(krwAmount: number): Promise<number> {
  const rate = await getKrwUsdRate();
  return Math.round((krwAmount / rate) * 100) / 100;
}
