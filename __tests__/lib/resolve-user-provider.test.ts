import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    systemSetting: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  pickProviderName,
  resolveUserProvider,
  resolveSendingProvider,
} from '@/lib/sms-providers/router';
import { TxgProvider } from '@/lib/sms-providers/txg';

const mockUser = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const mockSetting = prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>;

describe('pickProviderName', () => {
  it('user override 가 있고 알려진 라인이면 그 라인을 반환한다', () => {
    expect(pickProviderName('smsto', 'infobip')).toBe('smsto');
  });

  it('user override 가 null 이면 global 라인으로 폴백한다', () => {
    expect(pickProviderName(null, 'smsto')).toBe('smsto');
  });

  it('user override 가 알 수 없는 값이면 global 로 폴백한다', () => {
    expect(pickProviderName('xxx', 'infobip')).toBe('infobip');
  });

  it('user 와 global 둘 다 알 수 없는 값이면 infobip 기본값으로 폴백한다', () => {
    expect(pickProviderName(null, 'yyy')).toBe('infobip');
  });

  it('user undefined + global 빈 문자열이면 infobip 기본값으로 폴백한다', () => {
    expect(pickProviderName(undefined, '')).toBe('infobip');
  });

  it('user 가 txg 면 txg 를 반환한다 (세 번째 알려진 라인)', () => {
    expect(pickProviderName('txg', 'infobip')).toBe('txg');
  });
});

describe('resolveUserProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetting.mockResolvedValue({ key: 'active_sms_provider', value: { provider: 'infobip' } });
  });

  it('smsProvider가 null이면 전역 기본(infobip)으로 폴백한다', async () => {
    mockUser.mockResolvedValue({ smsProvider: null });
    const provider = await resolveUserProvider('user-1');
    expect(provider.name).toBe('infobip');
  });

  it('smsProvider가 유효하고 설정되어 있으면 그 라인을 반환한다', async () => {
    process.env.SMSTO_API_KEY = 'CW3l-test-key';
    mockUser.mockResolvedValue({ smsProvider: 'smsto' });
    const provider = await resolveUserProvider('user-2');
    expect(provider.name).toBe('smsto');
  });

  it('smsProvider가 무효값이면 전역 기본으로 폴백한다', async () => {
    mockUser.mockResolvedValue({ smsProvider: 'bogus' });
    const provider = await resolveUserProvider('user-3');
    expect(provider.name).toBe('infobip');
  });

  it('유저가 없으면 전역 기본으로 폴백한다', async () => {
    mockUser.mockResolvedValue(null);
    const provider = await resolveUserProvider('missing');
    expect(provider.name).toBe('infobip');
  });
});

describe('resolveSendingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockSetting.mockResolvedValue({ key: 'active_sms_provider', value: { provider: 'infobip' } });
  });

  it('campaignLine=infobip + 설정됨이면 infobip을 반환한다', async () => {
    const provider = await resolveSendingProvider('infobip');
    expect(provider.name).toBe('infobip');
  });

  it('campaignLine=null이면 전역 기본(infobip)으로 폴백한다', async () => {
    const provider = await resolveSendingProvider(null);
    expect(provider.name).toBe('infobip');
  });

  it('campaignLine=null + 전역 txg면 infobip으로 강제 폴백한다 (★데드락 방지)', async () => {
    // 전역 active를 txg로 설정 + TxgProvider.isConfigured를 true로 강제하여
    // getActiveProvider()가 실제 txg를 반환하게 만든 뒤, 강제 infobip 분기를 검증.
    mockSetting.mockResolvedValue({ key: 'active_sms_provider', value: { provider: 'txg' } });
    vi.spyOn(TxgProvider.prototype, 'isConfigured').mockReturnValue(true);
    const provider = await resolveSendingProvider(null);
    expect(provider.name).toBe('infobip');
  });

  it('campaignLine=smsto + 미설정이면 전역 기본(infobip)으로 폴백한다', async () => {
    delete process.env.SMSTO_API_KEY;
    const provider = await resolveSendingProvider('smsto');
    expect(provider.name).toBe('infobip');
  });
});
