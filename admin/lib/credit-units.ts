// ---------------------------------------------------------------------------
// 크레딧 표시 헬퍼 — 원화 크레딧을 "건수 (₩원화)" 형태로 보여준다.
// 핵심 규칙: 건수 = floor(credits / costPerMessage). 단가 0 / 음수 / 비정상이면 "—" 폴백.
// ---------------------------------------------------------------------------

const WON = '₩';

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

/** floor(credits / costPerMessage). 단가 0 이하 / NaN 이면 null (정수 건수로 환산 불가). */
export function creditsToCount(credits: number | string, costPerMessage: number | string): number | null {
  const c = toNumber(credits);
  const cost = toNumber(costPerMessage);
  if (!Number.isFinite(c) || !Number.isFinite(cost) || cost <= 0) return null;
  return Math.floor(c / cost);
}

/** "120건 (₩1,680)" 또는 "+120건 (+₩1,680)" / "-120건 (-₩1,680)". 단가 환산 불가면 "₩1,680" 폴백. */
export function formatCountWithKrw(
  credits: number | string,
  costPerMessage: number | string,
  options: { signed?: boolean } = {},
): string {
  const c = toNumber(credits);
  const count = creditsToCount(c, costPerMessage);
  const sign = options.signed && c > 0 ? '+' : '';
  const wonStr = `${sign}${WON}${Math.abs(c).toLocaleString('ko-KR')}`;
  const wonSigned = c < 0 ? `-${WON}${Math.abs(c).toLocaleString('ko-KR')}` : wonStr;
  if (count === null) return wonSigned;
  const countSign = options.signed && count > 0 ? '+' : '';
  const countAbs = Math.abs(count).toLocaleString('ko-KR');
  const countStr = count < 0 ? `-${countAbs}건` : `${countSign}${countAbs}건`;
  return `${countStr} (${wonSigned})`;
}
