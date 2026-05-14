// ---------------------------------------------------------------------------
// Infobip HLR (Number Lookup) 클라이언트
// ---------------------------------------------------------------------------
// SMS 발송 후 각 번호의 *실제 가입 통신사*를 조회한다.
// DLR이 주는 mccMnc는 라우팅 통신사라 한국 번호이동(MNP) 가입자는 부정확하다.
// HLR Lookup은 가입자 위치 등록기를 직접 조회하므로 권위 있는 값을 준다.
//
// ⚠️ 핵심 제약: Infobip 계정에서 Number Lookup 서비스가 현재 비활성 상태다.
//   활성화 전에는 `POST /number/1/query`가 전부 REJECTED_ROUTE_NOT_AVAILABLE로
//   응답한다. 이 코드는 계정이 활성화되는 즉시 INFOBIP_HLR_ENABLED='true' 토글만으로
//   동작하도록 미리 완성해 둔 것이다.
//
// ⚠️ 비용: HLR Lookup은 건당 과금(SMS 발송과 별개)이다. 실제 네트워크 호출은
//   반드시 enrich cron의 비용 가드(캐시 + 하드 캡) 안에서만 수행한다.
//   테스트에서는 절대 실제 호출 금지 — fetch를 mock 한다.
// ---------------------------------------------------------------------------

import { mccMncToCarrier, mccMncToCountry } from './mccmnc';

/** 한 청크당 최대 조회 번호 수 (Infobip Number Lookup 권장 한도) */
export const CHUNK_SIZE = 50;

/** HLR 조회 결과 — 스펙 §5.2 정의 */
export interface HlrResult {
  /** 입력 번호 (정규화된 E.164) */
  phone: string;
  /** HLR이 보고한 실제 통신사 MCCMNC */
  mccMnc: string | null;
  /** mccMnc → 매핑 통신사명 (HLR이 networkName을 주면 그 값 우선) */
  carrierName: string | null;
  /** ISO 3166-1 alpha-2 국가 코드 */
  countryCode: string | null;
  /** 번호이동(MNP) 여부 */
  ported: boolean;
  /** 도달 가능 상태 */
  reachable: 'ACTIVE' | 'ABSENT' | 'DEAD' | 'UNKNOWN';
  /** Infobip 원응답 (감사/디버깅용) */
  raw: unknown;
}

/**
 * Infobip 계정에서 Number Lookup 서비스가 비활성 상태일 때 throw.
 * 한 청크 응답이 전부 REJECTED(status.groupName='REJECTED') 이면 발생한다.
 *
 * 계정 미활성 시 Infobip은 단일 코드가 아니라 여러 REJECTED 하위 코드를 반환한다
 * (실측: REJECTED_ROUTE_NOT_AVAILABLE, REJECTED_DESTINATION_BLOCKLISTED 등).
 * 따라서 특정 status.name이 아니라 status.groupName='REJECTED'로 폭넓게 감지한다.
 * 정상 활성 계정이라면 한 청크 전체가 REJECTED로만 오는 경우는 사실상 없다.
 *
 * 호출 측(cron)은 이 에러를 잡아 경고 로그 1회 + 해당 실행 중단으로 처리한다
 * (무한 과금 시도 방지).
 */
export class HlrAccountInactiveError extends Error {
  constructor(message = 'Infobip Number Lookup 서비스가 비활성 상태입니다. 계정 매니저에게 활성화를 요청하세요.') {
    super(message);
    this.name = 'HlrAccountInactiveError';
  }
}

/** Infobip 응답 status 그룹 — 계정 미활성/서비스 거부 시그널 */
const REJECTED_GROUP_NAME = 'REJECTED';
const REJECTED_GROUP_ID = 5;

/**
 * HLR 조회가 가능한 상태인지 판정한다.
 * INFOBIP_HLR_ENABLED === 'true' 이고 INFOBIP_URL / INFOBIP_API_KEY 가 모두 존재해야 true.
 */
export function isHlrEnabled(): boolean {
  return (
    process.env.INFOBIP_HLR_ENABLED === 'true' &&
    !!process.env.INFOBIP_URL &&
    !!process.env.INFOBIP_API_KEY
  );
}

// --- 방어적 파싱 헬퍼 ----------------------------------------------------------

/** unknown 값에서 문자열을 안전하게 추출 (비어있지 않은 문자열만) */
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Infobip network 객체(originalNetwork / portedNetwork) 형태 */
type NetworkObject = {
  networkName?: unknown;
  networkPrefix?: unknown;
  countryName?: unknown;
  countryPrefix?: unknown;
  mccMnc?: unknown;
};

/** 응답 항목에서 network 객체를 안전하게 꺼낸다 */
function getNetwork(value: unknown): NetworkObject | null {
  if (value && typeof value === 'object') return value as NetworkObject;
  return null;
}

/**
 * status.groupName → reachable 상태 매핑.
 * DELIVERED→ACTIVE, UNDELIVERABLE/ABSENT→ABSENT, 그 외→UNKNOWN.
 * (REJECTED는 호출 측에서 청크 단위로 별도 감지하므로 여기서는 UNKNOWN 취급)
 */
function groupNameToReachable(groupName: string | null): HlrResult['reachable'] {
  const g = (groupName ?? '').toUpperCase();
  // UNDELIVERABLE 검사를 먼저 — 'UNDELIVERABLE'.includes('DELIVER')가 true이므로 순서 중요
  if (g.includes('UNDELIVER') || g.includes('ABSENT')) return 'ABSENT';
  if (g.includes('DELIVER')) return 'ACTIVE';
  return 'UNKNOWN';
}

/**
 * Infobip `/number/1/query` 응답 항목 하나를 HlrResult로 파싱한다.
 * 필드 위치/대소문자 변형을 허용하는 방어적 파싱 — DLR 핸들러와 동일 원칙.
 *
 * 우선순위:
 *  - mccMnc: ported=true면 portedNetwork.mccMnc 우선, 아니면 top-level → originalNetwork
 *  - networkName: ported=true면 portedNetwork.networkName 우선, 아니면 originalNetwork
 *  - carrierName: networkName이 있으면 그대로, 없으면 mccMncToCarrier(mccMnc) fallback
 *  - countryCode: mccMncToCountry(mccMnc)
 */
export function parseHlrItem(item: unknown, fallbackPhone: string): HlrResult {
  const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;

  // 입력 번호 — 응답에 to/phoneNumber/msisdn 변형이 있을 수 있으나 없으면 fallback
  const phone =
    asString(obj.to) ?? asString(obj.phoneNumber) ?? asString(obj.msisdn) ?? fallbackPhone;

  const ported = obj.ported === true;

  const originalNetwork = getNetwork(obj.originalNetwork);
  const portedNetwork = getNetwork(obj.portedNetwork);
  // ported=true면 portedNetwork를 권위 네트워크로, 아니면 originalNetwork.
  const activeNetwork = ported ? portedNetwork : originalNetwork;

  // mccMnc: 권위 네트워크 → top-level → 반대편 네트워크 순으로 탐색
  const mccMnc =
    asString(activeNetwork?.mccMnc) ??
    asString(obj.mccMnc) ??
    asString((ported ? originalNetwork : portedNetwork)?.mccMnc) ??
    null;

  // networkName: HLR이 직접 주면 그대로 사용
  const explicitNetworkName =
    asString(activeNetwork?.networkName) ??
    asString((ported ? originalNetwork : portedNetwork)?.networkName) ??
    null;

  const carrierName = explicitNetworkName ?? mccMncToCarrier(mccMnc);
  const countryCode = mccMncToCountry(mccMnc);

  // status.groupName 추출 (camelCase / snake_case 변형 허용)
  const status = (obj.status && typeof obj.status === 'object'
    ? (obj.status as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const groupName =
    asString(status.groupName) ?? asString(status.group_name) ?? asString(obj.status);

  return {
    phone,
    mccMnc,
    carrierName,
    countryCode,
    ported,
    reachable: groupNameToReachable(groupName),
    raw: item,
  };
}

/**
 * 응답 항목 하나가 REJECTED(서비스 거부/계정 미활성 시그널)인지 판정.
 * status.groupName='REJECTED' 또는 status.groupId=5 로 폭넓게 감지한다.
 * (REJECTED_ROUTE_NOT_AVAILABLE, REJECTED_DESTINATION_BLOCKLISTED 등 모두 포함)
 */
function isRejected(item: unknown): boolean {
  const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const status = (obj.status && typeof obj.status === 'object'
    ? (obj.status as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const groupName = asString(status.groupName) ?? asString(status.group_name);
  if (groupName && groupName.toUpperCase() === REJECTED_GROUP_NAME) return true;
  return status.groupId === REJECTED_GROUP_ID;
}

/** 응답 본문에서 결과 배열을 꺼낸다 — { results: [...] } / 배열 직접 / { data: { results } } 허용 */
function extractResults(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results;
    const data = obj.data;
    if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).results)) {
      return (data as Record<string, unknown>).results as unknown[];
    }
  }
  return [];
}

/** 배열을 size 단위로 청크 분할 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * 한 청크(최대 CHUNK_SIZE개)를 Infobip Number Lookup으로 조회한다.
 * 응답 전체가 REJECTED_ROUTE_NOT_AVAILABLE 이면 HlrAccountInactiveError throw.
 */
async function lookupChunk(phones: string[]): Promise<HlrResult[]> {
  const url = process.env.INFOBIP_URL!;
  const apiKey = process.env.INFOBIP_API_KEY!;

  const res = await fetch(`${url}/number/1/query`, {
    method: 'POST',
    headers: {
      Authorization: `App ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ to: phones }),
  });

  if (!res.ok) {
    throw new Error(`Infobip HLR 조회 실패 (HTTP ${res.status})`);
  }

  const payload = await res.json().catch(() => null);
  const results = extractResults(payload);

  // 응답 전체가 REJECTED면 계정 미활성/서비스 거부로 판단 → 즉시 throw
  // (응답이 비어있을 때는 제외 — 빈 응답은 단순히 매칭 결과 없음일 수 있음)
  if (results.length > 0 && results.every((item) => isRejected(item))) {
    throw new HlrAccountInactiveError();
  }

  // 결과를 입력 번호 순서대로 매핑 (응답 항목 수가 부족하면 fallbackPhone으로 보강)
  return phones.map((phone, i) => parseHlrItem(results[i], phone));
}

/**
 * 번호 배열을 HLR 조회한다. 최대 CHUNK_SIZE개씩 청크로 나눠 순차 호출.
 * 응답 전체가 REJECTED_ROUTE_NOT_AVAILABLE 인 청크를 만나면 HlrAccountInactiveError throw
 * (계정 미활성 — 더 호출해도 의미 없으므로 전체 중단).
 *
 * @param phones 정규화된 E.164 번호 배열
 */
export async function lookupNumbers(phones: string[]): Promise<HlrResult[]> {
  if (phones.length === 0) return [];

  const out: HlrResult[] = [];
  for (const part of chunk(phones, CHUNK_SIZE)) {
    const partResults = await lookupChunk(part);
    out.push(...partResults);
  }
  return out;
}
