// ---------------------------------------------------------------------------
// 랜덤 Alphanumeric Sender ID 생성기
// ---------------------------------------------------------------------------

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * 랜덤 Alphanumeric Sender ID 생성 (3~11자)
 * 첫 글자는 반드시 알파벳 (숫자로 시작하면 일부 통신사에서 차단)
 */
export function generateSenderId(length = 8): string {
  const len = Math.max(3, Math.min(11, length));
  let result = ALPHA[Math.floor(Math.random() * ALPHA.length)];
  for (let i = 1; i < len; i++) {
    result += ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)];
  }
  return result;
}

/**
 * Sender ID 유효성 검증
 * - 1~11자
 * - 알파벳, 숫자, 공백만 허용
 * - 숫자로만 구성 불가 (전화번호와 구분)
 */
export function isValidSenderId(id: string): boolean {
  if (!id || id.length < 1 || id.length > 11) return false;
  if (!/^[a-zA-Z0-9 ]+$/.test(id)) return false;
  if (/^\d+$/.test(id)) return false; // 숫자만은 불가
  return true;
}
