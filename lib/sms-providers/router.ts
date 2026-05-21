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
 * 캠페인 라인 이름으로 발송 provider를 해석한다 (비-txg 직접발송 경로 전용).
 * - 이름이 유효(infobip|smsto)하고 isConfigured()면 그 라인.
 * - txg / null / 무효 / 미설정이면 전역 기본(getActiveProvider)으로 폴백.
 *   단 전역 기본이 txg면 직접발송 경로에서 쓸 수 없으므로 infobip으로 강제 폴백한다.
 */
export async function resolveSendingProvider(campaignLine: string | null): Promise<SmsProvider> {
  if (campaignLine && campaignLine !== "txg" && campaignLine in PROVIDERS) {
    const candidate = PROVIDERS[campaignLine as SmsProviderName]();
    if (candidate.isConfigured()) {
      return candidate;
    }
    logger.warn(`[SmsRouter] 캠페인 라인 ${campaignLine} 미설정 — 전역/infobip 폴백합니다.`);
  }

  const fallback = await getActiveProvider();
  // 직접발송 경로는 txg를 처리할 수 없다 — 전역이 txg면 infobip으로 강제.
  if (fallback.name === "txg") {
    return new InfobipProvider();
  }
  return fallback;
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

// ---------------------------------------------------------------------------
// 유저별 발송 라인 토대 (스키마 + resolver). 본 PR 에서는 발송 경로에서 호출하지 않는다 —
// 관리자 UI 표시 + 향후 발송 경로 전환용 토대. RoutingCard 등에서 활용.
// ---------------------------------------------------------------------------

const KNOWN_PROVIDERS = ['infobip', 'smsto', 'txg'] as const;
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

/**
 * 유저 설정 / 전역 설정 둘 다 고려해 발송 라인 이름을 결정하는 순수 함수.
 * - user override 가 알려진 라인이면 그 라인.
 * - 아니면 global 이 알려진 라인이면 global.
 * - 그것도 아니면 'infobip' 기본값.
 */
export function pickProviderName(
  userSetting: string | null | undefined,
  globalSetting: string,
): KnownProvider {
  if (userSetting && (KNOWN_PROVIDERS as readonly string[]).includes(userSetting)) {
    return userSetting as KnownProvider;
  }
  if ((KNOWN_PROVIDERS as readonly string[]).includes(globalSetting)) {
    return globalSetting as KnownProvider;
  }
  return 'infobip';
}

/**
 * 유저별 발송 라인 SmsProvider 인스턴스를 반환한다.
 * - User.smsProvider 가 유효한 라인이고 isConfigured()=true 면 그 라인.
 * - null/unknown 이거나 isConfigured()=false 이면 전역 활성 라인으로 폴백.
 * - 본 PR 에서는 발송 경로에서 호출하지 않는다 (관리자 UI 표시 + 향후 발송 경로 전환용 토대).
 */
export async function resolveUserProvider(userId: string): Promise<SmsProvider> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { smsProvider: true },
  });

  const userRaw = user?.smsProvider ?? null;
  if (userRaw && (KNOWN_PROVIDERS as readonly string[]).includes(userRaw)) {
    const candidate = PROVIDERS[userRaw as KnownProvider]();
    if (candidate.isConfigured()) {
      return candidate;
    }
    logger.warn(`[SmsRouter] 유저 ${userId} 의 라인 ${userRaw} 가 미설정 — 전역 활성 라인으로 폴백`);
  }
  return getActiveProvider();
}
