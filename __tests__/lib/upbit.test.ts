import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 모듈 캐시를 리셋하기 위해 동적 import 사용
let getUsdtKrwPrice: typeof import('@/lib/upbit').getUsdtKrwPrice;
let getKrwUsdRate: typeof import('@/lib/upbit').getKrwUsdRate;
let krwToUsd: typeof import('@/lib/upbit').krwToUsd;

describe('Upbit 환율 모듈', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    const mod = await import('@/lib/upbit');
    getUsdtKrwPrice = mod.getUsdtKrwPrice;
    getKrwUsdRate = mod.getKrwUsdRate;
    krwToUsd = mod.krwToUsd;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getUsdtKrwPrice — Upbit USDT/KRW 시세 조회', () => {
    it('API 응답이 정상이면 시세를 반환한다', async () => {
      const mockTicker = [{
        market: 'KRW-USDT',
        trade_price: 1385.5,
        change_rate: 0.0012,
        signed_change_price: 1.5,
        acc_trade_volume_24h: 123456.78,
        timestamp: 1700000000000,
      }];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTicker,
      } as Response);

      const result = await getUsdtKrwPrice();
      expect(result.price).toBe(1385.5);
      expect(result.changeRate).toBe(0.0012);
      expect(result.volume24h).toBe(123456.78);
    });

    it('5초 이내 재호출 시 캐시된 값을 반환한다', async () => {
      const mockTicker = [{
        market: 'KRW-USDT',
        trade_price: 1390,
        change_rate: 0.001,
        signed_change_price: 1.0,
        acc_trade_volume_24h: 100000,
        timestamp: Date.now(),
      }];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTicker,
      } as Response);

      const first = await getUsdtKrwPrice();
      const second = await getUsdtKrwPrice();

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(second.price).toBe(first.price);
    });

    it('API 실패 시 캐시가 없으면 에러를 던진다', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));
      await expect(getUsdtKrwPrice()).rejects.toThrow('Network error');
    });

    it('API가 빈 배열을 반환하면 에러를 던진다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);
      await expect(getUsdtKrwPrice()).rejects.toThrow('No ticker data');
    });

    it('API HTTP 에러 시 캐시가 없으면 에러를 던진다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);
      await expect(getUsdtKrwPrice()).rejects.toThrow('Upbit API error: 500');
    });
  });

  describe('getKrwUsdRate — KRW/USD 환율 조회', () => {
    it('API 응답이 정상이면 환율을 반환한다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rates: { KRW: 1350 } }),
      } as Response);

      const rate = await getKrwUsdRate();
      expect(rate).toBe(1350);
    });

    it('API 실패 + 캐시 없음 → fallback 1380을 반환한다', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'));

      const rate = await getKrwUsdRate();
      expect(rate).toBe(1380);
    });

    it('유효하지 않은 환율(0 이하)이면 에러 처리한다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rates: { KRW: -100 } }),
      } as Response);

      // 유효하지 않은 데이터 → 에러 → fallback
      const rate = await getKrwUsdRate();
      expect(rate).toBe(1380);
    });

    it('API 성공 후 5분 이내 재호출 시 캐시를 사용한다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rates: { KRW: 1370 } }),
      } as Response);

      await getKrwUsdRate();
      const cached = await getKrwUsdRate();

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(cached).toBe(1370);
    });
  });

  describe('krwToUsd — KRW → USD 변환', () => {
    it('100만원을 정상 환율로 변환한다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rates: { KRW: 1350 } }),
      } as Response);

      const usd = await krwToUsd(1_000_000);
      // 1000000 / 1350 = 740.74...
      expect(usd).toBeCloseTo(740.74, 2);
    });

    it('0원은 0 USD를 반환한다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rates: { KRW: 1350 } }),
      } as Response);

      const usd = await krwToUsd(0);
      expect(usd).toBe(0);
    });

    it('음수 금액도 변환한다 (환불 등)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rates: { KRW: 1400 } }),
      } as Response);

      const usd = await krwToUsd(-140000);
      expect(usd).toBe(-100);
    });

    it('매우 큰 금액도 정상 변환한다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rates: { KRW: 1350 } }),
      } as Response);

      const usd = await krwToUsd(1_000_000_000);
      expect(usd).toBeCloseTo(740740.74, 2);
    });

    it('결과는 소수점 2자리로 반올림된다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rates: { KRW: 1333 } }),
      } as Response);

      const usd = await krwToUsd(10000);
      // 10000 / 1333 = 7.5018...
      const str = usd.toString();
      const decimals = str.split('.')[1];
      expect(!decimals || decimals.length <= 2).toBe(true);
    });
  });
});
