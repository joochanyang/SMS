/**
 * MFA 시크릿 암호화/복호화 모듈 (AES-256-GCM)
 *
 * DB 유출 시 MFA 시크릿 보호를 위해 at-rest 암호화를 적용한다.
 * 환경 변수 MFA_ENCRYPTION_KEY가 없으면 경고 로그 후 평문 반환 (하위호환).
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 권장 IV 길이
const AUTH_TAG_LENGTH = 16; // GCM 인증 태그 길이

/**
 * 암호화 키를 환경 변수에서 가져온다.
 * 32바이트 hex 문자열 (64 hex chars) 필요.
 * @returns Buffer | null
 */
function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.MFA_ENCRYPTION_KEY;
  if (!keyHex) {
    return null;
  }
  if (keyHex.length !== 64) {
    console.warn(
      '[mfa-crypto] MFA_ENCRYPTION_KEY는 32바이트(64 hex 문자)여야 합니다. 현재 길이:',
      keyHex.length,
    );
    return null;
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * MFA 시크릿을 AES-256-GCM으로 암호화한다.
 * 반환 형식: `iv:authTag:ciphertext` (모두 hex)
 *
 * MFA_ENCRYPTION_KEY가 없으면 경고 로그 후 평문 그대로 반환.
 */
export function encryptMfaSecret(plainSecret: string): string {
  const key = getEncryptionKey();
  if (!key) {
    console.warn('[mfa-crypto] MFA_ENCRYPTION_KEY 미설정 — MFA 시크릿이 평문으로 저장됩니다.');
    return plainSecret;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plainSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * 암호화된 MFA 시크릿을 복호화한다.
 * 입력 형식: `iv:authTag:ciphertext` (모두 hex)
 *
 * MFA_ENCRYPTION_KEY가 없거나 형식이 맞지 않으면 평문으로 간주하여 그대로 반환.
 */
export function decryptMfaSecret(encrypted: string): string {
  const key = getEncryptionKey();
  if (!key) {
    console.warn('[mfa-crypto] MFA_ENCRYPTION_KEY 미설정 — 평문으로 간주합니다.');
    return encrypted;
  }

  // 암호화된 형식이 아니면 (구분자 `:` 2개 미포함) 평문으로 간주
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    // 기존 평문 base32 시크릿 — 하위호환
    return encrypted;
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('[mfa-crypto] 복호화 실패 — 키 불일치 또는 데이터 손상:', err);
    throw new Error('MFA 시크릿 복호화에 실패했습니다.');
  }
}
