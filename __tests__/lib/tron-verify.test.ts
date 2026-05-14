import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// verifyTRC20Transaction를 동적 import로 가져온다 (fetch mock 필요)
let verifyTRC20Transaction: typeof import('@/lib/tron-verify').verifyTRC20Transaction;

const VALID_TXID = 'a'.repeat(64);
const SYSTEM_ADDRESS = 'TXYZabcdef1234567890abcdef12345678';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

describe('TRC20 트랜잭션 검증 모듈', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    const mod = await import('@/lib/tron-verify');
    verifyTRC20Transaction = mod.verifyTRC20Transaction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('TXID 형식 처리', () => {
    it('앞뒤 공백과 0x 접두사를 제거한다', async () => {
      // getTransactionInfo에서 null 반환 → NOT_FOUND
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}), // 빈 객체 = id 없음
      } as Response);

      const result = await verifyTRC20Transaction(
        `  0x${VALID_TXID}  `,
        SYSTEM_ADDRESS,
        100,
      );

      // txid가 정리되었는지 확인
      expect(result.txid).toBe(VALID_TXID);
      expect(result.txid).not.toContain('0x');
      expect(result.txid).not.toContain(' ');
    });

    it('대문자 TXID를 소문자로 변환한다', async () => {
      const upperTxid = 'A'.repeat(64);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      const result = await verifyTRC20Transaction(upperTxid, SYSTEM_ADDRESS, 100);
      expect(result.txid).toBe('a'.repeat(64));
    });
  });

  describe('트랜잭션 상태 검증', () => {
    it('트랜잭션이 존재하지 않으면 NOT_FOUND를 반환한다', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}), // id 없음
      } as Response);

      const result = await verifyTRC20Transaction(VALID_TXID, SYSTEM_ADDRESS, 100);
      expect(result.valid).toBe(false);
      expect(result.status).toBe('NOT_FOUND');
      expect(result.error).toContain('트랜잭션을 찾을 수 없습니다');
    });

    it('트랜잭션 상태가 FAILED이면 실패를 반환한다', async () => {
      // 첫 번째 fetch: getTransactionInfo
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: VALID_TXID,
          receipt: { result: 'OUT_OF_ENERGY' },
        }),
      } as Response);

      const result = await verifyTRC20Transaction(VALID_TXID, SYSTEM_ADDRESS, 100);
      expect(result.valid).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('실패한 상태');
    });
  });

  describe('주소 비교 로직', () => {
    it('수신 주소가 일치하지 않으면 실패한다', async () => {
      // getTransactionInfo → SUCCESS
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: VALID_TXID,
          receipt: { result: 'SUCCESS' },
          confirmed: true,
        }),
      } as Response);

      // getTRC20TransferByTxid → 다른 주소로 전송된 건
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            transaction_id: VALID_TXID,
            token_info: { symbol: 'USDT', address: USDT_CONTRACT, decimals: 6, name: 'Tether USD' },
            from: 'TSenderAddress123',
            to: 'TWrongAddress456',
            value: '100000000',
            type: 'Transfer',
            block_timestamp: Date.now(),
          }],
        }),
      } as Response);

      const result = await verifyTRC20Transaction(VALID_TXID, SYSTEM_ADDRESS, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('입금 주소가 일치하지 않습니다');
    });

    it('Base58 주소 비교는 대소문자를 구분한다', async () => {
      const addr = 'TAbCdEf123456';

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: VALID_TXID,
          receipt: { result: 'SUCCESS' },
          confirmed: true,
        }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            transaction_id: VALID_TXID,
            token_info: { symbol: 'USDT', address: USDT_CONTRACT, decimals: 6, name: 'Tether USD' },
            from: 'TSender',
            to: addr.toLowerCase(), // 소문자
            value: '100000000',
            type: 'Transfer',
            block_timestamp: Date.now(),
          }],
        }),
      } as Response);

      const result = await verifyTRC20Transaction(VALID_TXID, addr.toUpperCase(), 100);
      expect(result.error ?? '').toContain('입금 주소가 일치하지 않습니다');
    });
  });

  describe('금액 허용 오차 로직', () => {
    function mockSuccessfulTx(amount: string, toAddr: string) {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: VALID_TXID,
          receipt: { result: 'SUCCESS' },
          confirmed: true,
        }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            transaction_id: VALID_TXID,
            token_info: { symbol: 'USDT', address: USDT_CONTRACT, decimals: 6, name: 'Tether USD' },
            from: 'TSender',
            to: toAddr,
            value: amount,
            type: 'Transfer',
            block_timestamp: Date.now(),
          }],
        }),
      } as Response);
    }

    it('정확한 금액이면 검증 성공한다', async () => {
      // 100 USDT = 100 * 10^6 = 100000000
      mockSuccessfulTx('100000000', SYSTEM_ADDRESS);

      const result = await verifyTRC20Transaction(VALID_TXID, SYSTEM_ADDRESS, 100);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('SUCCESS');
      expect(result.amount).toBe(100);
    });

    it('0.01 USDT 이내 차이는 허용한다 (기본 tolerance)', async () => {
      // 99.995 USDT = 99995000
      mockSuccessfulTx('99995000', SYSTEM_ADDRESS);

      const result = await verifyTRC20Transaction(VALID_TXID, SYSTEM_ADDRESS, 100);
      expect(result.valid).toBe(true);
    });

    it('0.01 USDT 초과 차이는 거부한다', async () => {
      // 99.98 USDT = 99980000 (차이: 0.02)
      mockSuccessfulTx('99980000', SYSTEM_ADDRESS);

      const result = await verifyTRC20Transaction(VALID_TXID, SYSTEM_ADDRESS, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('입금 수량이 일치하지 않습니다');
    });

    it('커스텀 tolerance를 적용할 수 있다', async () => {
      // 99 USDT (차이: 1 USDT), tolerance: 2
      mockSuccessfulTx('99000000', SYSTEM_ADDRESS);

      const result = await verifyTRC20Transaction(VALID_TXID, SYSTEM_ADDRESS, 100, 2);
      expect(result.valid).toBe(true);
    });

    it('USDT가 아닌 토큰이면 실패한다', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: VALID_TXID,
          receipt: { result: 'SUCCESS' },
          confirmed: true,
        }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            transaction_id: VALID_TXID,
            token_info: { symbol: 'USDC', address: 'TDifferentContract', decimals: 6, name: 'USD Coin' },
            from: 'TSender',
            to: SYSTEM_ADDRESS,
            value: '100000000',
            type: 'Transfer',
            block_timestamp: Date.now(),
          }],
        }),
      } as Response);

      const result = await verifyTRC20Transaction(VALID_TXID, SYSTEM_ADDRESS, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('USDT가 아닌 다른 토큰');
    });
  });

  describe('TronScan fallback', () => {
    it('TronGrid 실패 시 TronScan으로 폴백한다', async () => {
      // getTransactionInfo → SUCCESS
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: VALID_TXID,
          receipt: { result: 'SUCCESS' },
          confirmed: true,
        }),
      } as Response);

      // TronGrid TRC20 → 매칭 없음
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response);

      // TronScan fallback → 성공
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          trc20TransferInfo: [{
            symbol: 'USDT',
            contract_address: USDT_CONTRACT,
            decimals: 6,
            name: 'Tether USD',
            from_address: 'TSender',
            to_address: SYSTEM_ADDRESS,
            amount_str: '100000000',
          }],
          timestamp: Date.now(),
        }),
      } as Response);

      const result = await verifyTRC20Transaction(VALID_TXID, SYSTEM_ADDRESS, 100);
      expect(result.valid).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });
});
