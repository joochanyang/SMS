import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseHlrItem,
  lookupNumbers,
  isHlrEnabled,
  HlrAccountInactiveError,
  CHUNK_SIZE,
} from '../../lib/sms-providers/infobip-hlr';

// ---------------------------------------------------------------------------
// 픽스처 — Infobip /number/1/query 응답 항목 변형
// ---------------------------------------------------------------------------

/** 정상: 번호이동 없음, originalNetwork 사용 */
const ITEM_NORMAL = {
  to: '+821028855838',
  ported: false,
  status: { groupName: 'DELIVERED', name: 'DELIVERED_TO_HANDSET' },
  mccMnc: '45005',
  originalNetwork: {
    networkName: 'SK Telecom',
    networkPrefix: '010',
    countryName: 'South Korea',
    countryPrefix: '82',
  },
};

/** 번호이동 O: portedNetwork가 권위. mccMnc는 top-level(라우팅)과 다름 */
const ITEM_PORTED = {
  to: '+821028855838',
  ported: true,
  status: { groupName: 'DELIVERED', name: 'DELIVERED_TO_HANDSET' },
  mccMnc: '45008', // 라우팅(KT) — 무시되어야 함
  originalNetwork: {
    networkName: 'KT',
    mccMnc: '45008',
    countryName: 'South Korea',
    countryPrefix: '82',
  },
  portedNetwork: {
    networkName: 'SK Telecom',
    mccMnc: '45005', // 실제 가입 통신사(SKT)
    countryName: 'South Korea',
    countryPrefix: '82',
  },
};

/** ABSENT: 전원 꺼짐 등 도달 불가 */
const ITEM_ABSENT = {
  to: '+821011112222',
  ported: false,
  status: { groupName: 'UNDELIVERABLE', name: 'UNDELIVERABLE_NOT_DELIVERED' },
  mccMnc: '45006',
  originalNetwork: { networkName: 'LG U+', mccMnc: '45006' },
};

/** 계정 미활성 시그널 — status.name = REJECTED_ROUTE_NOT_AVAILABLE */
const ITEM_ROUTE_NOT_AVAILABLE = {
  to: '+821033334444',
  status: {
    groupId: 5,
    groupName: 'REJECTED',
    name: 'REJECTED_ROUTE_NOT_AVAILABLE',
    description: 'Route not available',
  },
};

/**
 * 계정 미활성 시그널 변형 — status.name = REJECTED_DESTINATION_BLOCKLISTED.
 * 실측: 비활성 계정은 단일 코드가 아니라 여러 REJECTED 하위 코드를 반환한다.
 * groupName='REJECTED'로 폭넓게 감지되어야 한다.
 */
const ITEM_REJECTED_BLOCKLISTED = {
  to: '+821028855838',
  status: {
    groupId: 5,
    groupName: 'REJECTED',
    name: 'REJECTED_DESTINATION_BLOCKLISTED',
    description: 'The destination address is blocklisted',
  },
  originalNetwork: {},
};

/** 필드 위치 변형: networkName 없음 → mccMnc fallback, status가 문자열 */
const ITEM_FIELD_VARIANT = {
  to: '+821055556666',
  status: { group_name: 'DELIVERED' }, // snake_case
  mccMnc: '45002', // SKT — networkName이 없어 mccMncToCarrier로 도출되어야 함
};

/** fetch 응답을 흉내내는 헬퍼 */
function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// parseHlrItem — 응답 파서
// ---------------------------------------------------------------------------
describe('parseHlrItem', () => {
  it('정상 항목을 파싱한다 (originalNetwork 사용)', () => {
    const r = parseHlrItem(ITEM_NORMAL, '+821028855838');
    expect(r.phone).toBe('+821028855838');
    expect(r.mccMnc).toBe('45005');
    expect(r.carrierName).toBe('SK Telecom'); // HLR networkName 그대로
    expect(r.countryCode).toBe('KR');
    expect(r.ported).toBe(false);
    expect(r.reachable).toBe('ACTIVE');
    expect(r.raw).toBe(ITEM_NORMAL);
  });

  it('ported=true면 portedNetwork를 권위 네트워크로 사용한다', () => {
    const r = parseHlrItem(ITEM_PORTED, '+821028855838');
    expect(r.ported).toBe(true);
    // 라우팅 mccMnc(45008/KT)가 아니라 portedNetwork mccMnc(45005/SKT)
    expect(r.mccMnc).toBe('45005');
    expect(r.carrierName).toBe('SK Telecom');
    expect(r.reachable).toBe('ACTIVE');
  });

  it('ABSENT 상태를 ABSENT로 매핑한다', () => {
    const r = parseHlrItem(ITEM_ABSENT, '+821011112222');
    expect(r.reachable).toBe('ABSENT');
    expect(r.mccMnc).toBe('45006');
    expect(r.carrierName).toBe('LG U+');
  });

  it('networkName이 없으면 mccMncToCarrier로 통신사명을 도출한다 (필드 변형)', () => {
    const r = parseHlrItem(ITEM_FIELD_VARIANT, '+821055556666');
    expect(r.mccMnc).toBe('45002');
    expect(r.carrierName).toBe('SKT'); // mccmnc 헬퍼 fallback
    expect(r.countryCode).toBe('KR');
    expect(r.reachable).toBe('ACTIVE'); // status.group_name(snake_case)도 인식
  });

  it('알 수 없는 status는 UNKNOWN으로 매핑한다', () => {
    const r = parseHlrItem({ to: '+821000000000', status: { groupName: 'PENDING' } }, '+821000000000');
    expect(r.reachable).toBe('UNKNOWN');
  });

  it('빈 객체/null 입력도 안전하게 처리하고 fallbackPhone을 쓴다', () => {
    const r = parseHlrItem(null, '+821099998888');
    expect(r.phone).toBe('+821099998888');
    expect(r.mccMnc).toBeNull();
    expect(r.carrierName).toBeNull();
    expect(r.countryCode).toBeNull();
    expect(r.ported).toBe(false);
    expect(r.reachable).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// lookupNumbers — fetch mock
// ---------------------------------------------------------------------------
describe('lookupNumbers', () => {
  beforeEach(() => {
    vi.stubEnv('INFOBIP_URL', 'https://example.infobip.com');
    vi.stubEnv('INFOBIP_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('빈 배열을 입력하면 fetch를 호출하지 않고 빈 배열을 반환한다', async () => {
    const fetchMock = mockFetchResponse({ results: [] });
    vi.stubGlobal('fetch', fetchMock);
    const r = await lookupNumbers([]);
    expect(r).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('정상 응답을 파싱하여 HlrResult 배열을 반환한다', async () => {
    const fetchMock = mockFetchResponse({ results: [ITEM_NORMAL, ITEM_ABSENT] });
    vi.stubGlobal('fetch', fetchMock);

    const r = await lookupNumbers(['+821028855838', '+821011112222']);
    expect(r).toHaveLength(2);
    expect(r[0].carrierName).toBe('SK Telecom');
    expect(r[1].reachable).toBe('ABSENT');

    // 올바른 엔드포인트/헤더/바디로 호출했는지 검증
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://example.infobip.com/number/1/query');
    expect(calledOpts.method).toBe('POST');
    expect(calledOpts.headers.Authorization).toBe('App test-key');
    expect(JSON.parse(calledOpts.body)).toEqual({ to: ['+821028855838', '+821011112222'] });
  });

  it('ported=true 응답을 portedNetwork 기준으로 보강한다', async () => {
    const fetchMock = mockFetchResponse({ results: [ITEM_PORTED] });
    vi.stubGlobal('fetch', fetchMock);
    const r = await lookupNumbers(['+821028855838']);
    expect(r[0].mccMnc).toBe('45005');
    expect(r[0].ported).toBe(true);
  });

  it('청크 응답이 전부 REJECTED_ROUTE_NOT_AVAILABLE 이면 HlrAccountInactiveError를 throw한다', async () => {
    const fetchMock = mockFetchResponse({
      results: [ITEM_ROUTE_NOT_AVAILABLE, ITEM_ROUTE_NOT_AVAILABLE],
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookupNumbers(['+821033334444', '+821033334445'])).rejects.toBeInstanceOf(
      HlrAccountInactiveError,
    );
  });

  it('REJECTED 하위 코드가 달라도(DESTINATION_BLOCKLISTED 등) groupName=REJECTED면 throw한다', async () => {
    // 실측: 비활성 계정은 ROUTE_NOT_AVAILABLE 외에 DESTINATION_BLOCKLISTED 등도 반환한다.
    const fetchMock = mockFetchResponse({
      results: [ITEM_REJECTED_BLOCKLISTED, ITEM_REJECTED_BLOCKLISTED],
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookupNumbers(['+821028855838', '+821028855839'])).rejects.toBeInstanceOf(
      HlrAccountInactiveError,
    );
  });

  it('REJECTED와 ROUTE_NOT_AVAILABLE이 섞여 전부 REJECTED 그룹이면 throw한다', async () => {
    const fetchMock = mockFetchResponse({
      results: [ITEM_ROUTE_NOT_AVAILABLE, ITEM_REJECTED_BLOCKLISTED],
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookupNumbers(['+821033334444', '+821028855838'])).rejects.toBeInstanceOf(
      HlrAccountInactiveError,
    );
  });

  it('일부만 REJECTED면 throw하지 않고 결과를 반환한다', async () => {
    const fetchMock = mockFetchResponse({
      results: [ITEM_NORMAL, ITEM_ROUTE_NOT_AVAILABLE],
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await lookupNumbers(['+821028855838', '+821033334444']);
    expect(r).toHaveLength(2);
    expect(r[0].carrierName).toBe('SK Telecom');
  });

  it('HTTP 오류 응답이면 에러를 throw한다', async () => {
    const fetchMock = mockFetchResponse(null, false, 500);
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupNumbers(['+821028855838'])).rejects.toThrow();
  });

  it('CHUNK_SIZE를 초과하면 여러 번 청크로 나눠 호출한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const phones = Array.from({ length: CHUNK_SIZE + 1 }, (_, i) => `+8210000000${i}`);
    await lookupNumbers(phones);
    // CHUNK_SIZE + 1 → 2개 청크
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// isHlrEnabled — env 토글
// ---------------------------------------------------------------------------
describe('isHlrEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('INFOBIP_HLR_ENABLED=true + URL + API_KEY 모두 있으면 true', () => {
    vi.stubEnv('INFOBIP_HLR_ENABLED', 'true');
    vi.stubEnv('INFOBIP_URL', 'https://example.infobip.com');
    vi.stubEnv('INFOBIP_API_KEY', 'test-key');
    expect(isHlrEnabled()).toBe(true);
  });

  it('INFOBIP_HLR_ENABLED가 미설정이면 false', () => {
    vi.stubEnv('INFOBIP_HLR_ENABLED', '');
    vi.stubEnv('INFOBIP_URL', 'https://example.infobip.com');
    vi.stubEnv('INFOBIP_API_KEY', 'test-key');
    expect(isHlrEnabled()).toBe(false);
  });

  it('INFOBIP_HLR_ENABLED가 true 이외의 값이면 false', () => {
    vi.stubEnv('INFOBIP_HLR_ENABLED', '1');
    vi.stubEnv('INFOBIP_URL', 'https://example.infobip.com');
    vi.stubEnv('INFOBIP_API_KEY', 'test-key');
    expect(isHlrEnabled()).toBe(false);
  });

  it('INFOBIP_URL이 없으면 false', () => {
    vi.stubEnv('INFOBIP_HLR_ENABLED', 'true');
    vi.stubEnv('INFOBIP_URL', '');
    vi.stubEnv('INFOBIP_API_KEY', 'test-key');
    expect(isHlrEnabled()).toBe(false);
  });

  it('INFOBIP_API_KEY가 없으면 false', () => {
    vi.stubEnv('INFOBIP_HLR_ENABLED', 'true');
    vi.stubEnv('INFOBIP_URL', 'https://example.infobip.com');
    vi.stubEnv('INFOBIP_API_KEY', '');
    expect(isHlrEnabled()).toBe(false);
  });
});
