import { describe, it, expect } from 'vitest';

// 라우트에서 export하는 매퍼를 직접 검증한다 (API 호출 mock 회피).
import { mapProviderToBalanceRow } from '../../admin/app/api/sms-providers/balances/mapper';

describe('mapProviderToBalanceRow', () => {
  const FROZEN = new Date('2026-05-28T00:00:00.000Z');

  it('정상 잔액 응답을 변환한다', () => {
    const row = mapProviderToBalanceRow({
      name: 'infobip',
      isConfigured: true,
      isActive: true,
      result: { status: 'fulfilled', value: { balance: 123.45, currency: 'USD' } },
      now: FROZEN,
    });
    expect(row).toEqual({
      name: 'infobip',
      label: 'Infobip',
      isConfigured: true,
      isActive: true,
      balance: 123.45,
      currency: 'USD',
      fetchedAt: '2026-05-28T00:00:00.000Z',
    });
  });

  it('미설정 프로바이더는 balance null + error 표기', () => {
    const row = mapProviderToBalanceRow({
      name: 'txg',
      isConfigured: false,
      isActive: false,
      result: { status: 'fulfilled', value: null },
      now: FROZEN,
    });
    expect(row).toMatchObject({ name: 'txg', isConfigured: false, balance: null, currency: null });
    expect(row.error).toBe('미설정');
  });

  it('getBalance 실패는 balance null + error 메시지', () => {
    const row = mapProviderToBalanceRow({
      name: 'smsto',
      isConfigured: true,
      isActive: false,
      result: { status: 'rejected', reason: new Error('네트워크 오류') },
      now: FROZEN,
    });
    expect(row).toMatchObject({ name: 'smsto', isConfigured: true, balance: null });
    expect(row.error).toContain('네트워크 오류');
  });

  it('getBalance가 null을 반환하면 잔액 조회 실패', () => {
    const row = mapProviderToBalanceRow({
      name: 'infobip',
      isConfigured: true,
      isActive: true,
      result: { status: 'fulfilled', value: null },
      now: FROZEN,
    });
    expect(row.balance).toBeNull();
    expect(row.error).toBe('잔액 조회 실패');
  });
});
