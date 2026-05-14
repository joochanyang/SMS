// ---------------------------------------------------------------------------
// MCCMNC → 통신사명 매핑
// ---------------------------------------------------------------------------
// MCC(3자리) + MNC(2~3자리) 코드를 통신사명으로 변환한다.
// Infobip / SMS.to / TXG 등 모든 프로바이더가 동일한 ITU 표준 코드를 반환하므로
// 프로바이더 무관 공용 헬퍼로 둔다.
//
// 출처:
//   - ITU-T E.212 (Mobile Network Code, MNC) 공식 할당표
//   - 한국방송통신위원회 / 과기정통부 식별번호 고시
//   - 각국 GSMA 등록 정보
//
// 입력: "45006", "450 06", "45006 " 등 공백/형식 변형 허용 → 숫자만 추출하여 매칭
// 길이: 5자리(MCC=3 + MNC=2) 또는 6자리(MCC=3 + MNC=3)만 유효
//
// ⚠️ 한국 번호이동(MNP) 한계
//   SMS API가 반환하는 mccMnc는 라우팅 통신사(routing carrier)이며,
//   가입자가 MNP로 통신사를 변경한 경우 *현재 가입 통신사와 다를 수 있다*.
//   정확한 가입 통신사 식별이 필요하면 별도 HLR Lookup 서비스가 필요하다
//   (Infobip Number Lookup API는 계정 매니저에 활성화 요청 + 별도 과금).
//   따라서 UI 라벨은 "통신사" 가 아닌 "통신사(라우팅)" 으로 표기한다.
// ---------------------------------------------------------------------------

/** 한국 통신사 (MCC=450) */
const KOREAN_CARRIERS: Record<string, string> = {
  '45002': 'SKT',
  '45003': 'KT',
  '45004': 'KT', // 구 KTF (2009년 KT에 합병)
  '45005': 'SKT',
  '45006': 'LG U+',
  '45008': 'KT',
  '45011': 'SKT',
  '45012': 'SK Telink', // MVNO
};

/** 글로벌 주요 통신사 — 필요 시 점진 확장 */
const GLOBAL_CARRIERS: Record<string, string> = {
  // 미국 (MCC=310/311/312/313)
  '310030': 'AT&T',
  '310070': 'AT&T',
  '310170': 'T-Mobile',
  '310260': 'T-Mobile',
  '310410': 'AT&T',
  '311480': 'Verizon',
  '311490': 'Sprint',
  // 일본 (MCC=440/441)
  '44010': 'NTT docomo',
  '44020': 'SoftBank',
  '44050': 'KDDI (au)',
  '44051': 'KDDI (au)',
  '44053': 'KDDI (au)',
  // 중국 (MCC=460)
  '46000': 'China Mobile',
  '46001': 'China Unicom',
  '46011': 'China Telecom',
};

/** MCC → 국가 코드(ISO 3166-1 alpha-2) */
const COUNTRY_BY_MCC: Record<string, string> = {
  '450': 'KR',
  '310': 'US',
  '311': 'US',
  '312': 'US',
  '313': 'US',
  '440': 'JP',
  '441': 'JP',
  '460': 'CN',
  '454': 'HK',
  '466': 'TW',
  '525': 'SG',
  '520': 'TH',
  '452': 'VN',
  '510': 'ID',
  '515': 'PH',
  '502': 'MY',
};

/** mccMnc 입력을 정규화 (숫자만 5~6자리). 잘못된 입력은 null. */
function normalizeMccMnc(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, '');
  if (digits.length !== 5 && digits.length !== 6) return null;
  return digits;
}

/**
 * MCCMNC 코드를 통신사명으로 변환한다.
 * 등록되지 않은 코드는 null. 프로바이더가 mccMnc만 주고 networkName은 안 줄 때 사용.
 *
 * @example
 *   mccMncToCarrier('45006') // 'LG U+'
 *   mccMncToCarrier('450 08') // 'KT'
 *   mccMncToCarrier(null) // null
 */
export function mccMncToCarrier(mccMnc: string | null | undefined): string | null {
  const code = normalizeMccMnc(mccMnc);
  if (!code) return null;
  return KOREAN_CARRIERS[code] ?? GLOBAL_CARRIERS[code] ?? null;
}

/**
 * MCCMNC 코드에서 국가 코드(ISO 3166-1 alpha-2)를 추출한다.
 * 통신사명을 못 찾아도 국가 정도는 표시할 수 있도록 분리된 함수로 둠.
 *
 * @example
 *   mccMncToCountry('45006') // 'KR'
 *   mccMncToCountry('310410') // 'US'
 */
export function mccMncToCountry(mccMnc: string | null | undefined): string | null {
  const code = normalizeMccMnc(mccMnc);
  if (!code) return null;
  return COUNTRY_BY_MCC[code.substring(0, 3)] ?? null;
}
