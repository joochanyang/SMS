import type { SmsProviderBalance, SmsProviderName } from '@shared/sms-providers/types';

// 진실의 원천: lib/sms-providers/types.ts — 라인이 추가되면 한 곳만 갱신하면 된다.
export type ProviderName = SmsProviderName;

const LABELS: Record<ProviderName, string> = {
  infobip: 'Infobip',
  smsto: 'SMS.to',
  txg: 'TXG-TEL',
};

export interface BalanceRow {
  name: ProviderName;
  label: string;
  isConfigured: boolean;
  isActive: boolean;
  balance: number | null;
  currency: string | null;
  fetchedAt: string;
  error?: string;
}

export interface MapperInput {
  name: ProviderName;
  isConfigured: boolean;
  isActive: boolean;
  result:
    | { status: 'fulfilled'; value: SmsProviderBalance | null }
    | { status: 'rejected'; reason: unknown };
  now: Date;
}

function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  return '알 수 없는 오류';
}

export function mapProviderToBalanceRow(input: MapperInput): BalanceRow {
  const base = {
    name: input.name,
    label: LABELS[input.name],
    isConfigured: input.isConfigured,
    isActive: input.isActive,
    fetchedAt: input.now.toISOString(),
  };

  if (!input.isConfigured) {
    return { ...base, balance: null, currency: null, error: '미설정' };
  }
  if (input.result.status === 'rejected') {
    // 현 시점 모든 프로바이더(infobip/smsto/txg)는 throw 하지 않고 null 반환하므로 이 분기는 미래 대비 방어 코드.
    // 향후 throw 하는 프로바이더 추가 시 reason.message 에 API 키/토큰/URL 노출되지 않도록 호출부에서 scrub 필수.
    return { ...base, balance: null, currency: null, error: reasonMessage(input.result.reason) };
  }
  if (input.result.value === null) {
    return { ...base, balance: null, currency: null, error: '잔액 조회 실패' };
  }
  return {
    ...base,
    balance: input.result.value.balance,
    currency: input.result.value.currency,
  };
}
