import type { SmsProviderBalance } from '@shared/sms-providers/types';

export type ProviderName = 'infobip' | 'smsto' | 'txg';

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
