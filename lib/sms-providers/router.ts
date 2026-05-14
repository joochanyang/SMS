// ---------------------------------------------------------------------------
// SMS Provider Router — SystemSetting에서 활성 프로바이더를 결정
// ---------------------------------------------------------------------------

import { logger } from '../logger';
import { prisma } from '../prisma';
import type { SmsProvider, SmsProviderName } from './types';
import { InfobipProvider } from './infobip';
import { SmsToProvider } from './smsto';
import { TxgProvider } from './txg';

const PROVIDERS: Record<SmsProviderName, () => SmsProvider> = {
  infobip: () => new InfobipProvider(),
  smsto: () => new SmsToProvider(),
  txg: () => new TxgProvider(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * SystemSetting 테이블에서 활성 SMS 프로바이더를 조회하여 인스턴스를 반환한다.
 * 설정이 없으면 기본값으로 infobip을 사용한다.
 */
export async function getActiveProvider(): Promise<SmsProvider> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'active_sms_provider' },
  });

  const rawProvider =
    isRecord(setting?.value) && typeof setting.value.provider === 'string'
      ? setting.value.provider
      : 'infobip';
  const providerName = rawProvider in PROVIDERS ? (rawProvider as SmsProviderName) : 'infobip';
  const factory = PROVIDERS[providerName];

  if (!factory) {
    return new InfobipProvider();
  }

  const provider = factory();

  if (!provider.isConfigured()) {
    logger.warn(`[SmsRouter] ${providerName} 프로바이더가 설정되지 않았습니다. infobip으로 폴백합니다.`);
    return new InfobipProvider();
  }

  return provider;
}

/**
 * 이름으로 프로바이더 인스턴스를 생성한다 (관리자 테스트 등에서 사용).
 */
export function getProviderByName(name: SmsProviderName): SmsProvider {
  const factory = PROVIDERS[name];
  if (!factory) throw new Error(`알 수 없는 프로바이더: ${name}`);
  return factory();
}

/**
 * 전체 프로바이더 목록과 설정 상태를 반환한다.
 */
export function getAllProviders(): { name: SmsProviderName; provider: SmsProvider }[] {
  return (Object.keys(PROVIDERS) as SmsProviderName[]).map((name) => ({
    name,
    provider: PROVIDERS[name](),
  }));
}
