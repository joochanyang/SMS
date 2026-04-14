import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

let encryptMfaSecret: typeof import('@/admin/lib/mfa-crypto').encryptMfaSecret;
let decryptMfaSecret: typeof import('@/admin/lib/mfa-crypto').decryptMfaSecret;

// 테스트용 32바이트 키 (64 hex chars)
const TEST_KEY = crypto.randomBytes(32).toString('hex');
const DIFFERENT_KEY = crypto.randomBytes(32).toString('hex');

describe('MFA 암호화 모듈 (AES-256-GCM)', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function loadModule(key?: string) {
    if (key) {
      vi.stubEnv('MFA_ENCRYPTION_KEY', key);
    } else {
      vi.stubEnv('MFA_ENCRYPTION_KEY', '');
    }
    const mod = await import('@/admin/lib/mfa-crypto');
    encryptMfaSecret = mod.encryptMfaSecret;
    decryptMfaSecret = mod.decryptMfaSecret;
  }

  describe('encrypt → decrypt 왕복 테스트', () => {
    it('암호화 후 복호화하면 원본이 복원된다', async () => {
      await loadModule(TEST_KEY);

      const original = 'JBSWY3DPEHPK3PXP'; // 일반적인 TOTP base32 시크릿
      const encrypted = encryptMfaSecret(original);
      const decrypted = decryptMfaSecret(encrypted);

      expect(decrypted).toBe(original);
    });

    it('빈 문자열도 왕복 변환된다', async () => {
      await loadModule(TEST_KEY);

      const encrypted = encryptMfaSecret('');
      const decrypted = decryptMfaSecret(encrypted);

      expect(decrypted).toBe('');
    });

    it('한글/유니코드도 왕복 변환된다', async () => {
      await loadModule(TEST_KEY);

      const original = '한글시크릿테스트!@#';
      const encrypted = encryptMfaSecret(original);
      const decrypted = decryptMfaSecret(encrypted);

      expect(decrypted).toBe(original);
    });
  });

  describe('다른 키로 복호화 실패', () => {
    it('다른 키로 복호화하면 에러가 발생한다', async () => {
      // 키 A로 암호화
      await loadModule(TEST_KEY);
      const encrypted = encryptMfaSecret('MY_SECRET');

      // 키 B로 복호화 시도
      await loadModule(DIFFERENT_KEY);
      expect(() => decryptMfaSecret(encrypted)).toThrow('MFA 시크릿 복호화에 실패했습니다.');
    });
  });

  describe('IV 랜덤성', () => {
    it('같은 평문을 두 번 암호화하면 다른 결과가 나온다', async () => {
      await loadModule(TEST_KEY);

      const secret = 'SAME_SECRET';
      const encrypted1 = encryptMfaSecret(secret);
      const encrypted2 = encryptMfaSecret(secret);

      expect(encrypted1).not.toBe(encrypted2);

      // 하지만 둘 다 복호화하면 동일한 원본
      expect(decryptMfaSecret(encrypted1)).toBe(secret);
      expect(decryptMfaSecret(encrypted2)).toBe(secret);
    });

    it('IV 부분(콜론 앞)이 매번 다르다', async () => {
      await loadModule(TEST_KEY);

      const results = Array.from({ length: 5 }, () => encryptMfaSecret('test'));
      const ivs = results.map(r => r.split(':')[0]);
      const uniqueIvs = new Set(ivs);

      expect(uniqueIvs.size).toBe(5);
    });
  });

  describe('암호화 키 미설정 시 하위호환', () => {
    it('MFA_ENCRYPTION_KEY 없으면 평문 그대로 반환한다', async () => {
      await loadModule(); // 키 없음

      const secret = 'PLAIN_TEXT_SECRET';
      const result = encryptMfaSecret(secret);

      expect(result).toBe(secret);
    });

    it('MFA_ENCRYPTION_KEY 없으면 복호화도 평문 그대로 반환한다', async () => {
      await loadModule();

      const plainSecret = 'JBSWY3DPEHPK3PXP';
      const result = decryptMfaSecret(plainSecret);

      expect(result).toBe(plainSecret);
    });
  });

  describe('암호화 형식 검증', () => {
    it('암호화 결과는 iv:authTag:ciphertext 형식이다', async () => {
      await loadModule(TEST_KEY);

      const encrypted = encryptMfaSecret('TEST_SECRET');
      const parts = encrypted.split(':');

      expect(parts.length).toBe(3);
      // IV: 12바이트 = 24 hex chars
      expect(parts[0].length).toBe(24);
      // Auth Tag: 16바이트 = 32 hex chars
      expect(parts[1].length).toBe(32);
      // Ciphertext: 길이 > 0
      expect(parts[2].length).toBeGreaterThan(0);
    });

    it('콜론 구분자가 없는 문자열은 평문으로 간주한다 (하위호환)', async () => {
      await loadModule(TEST_KEY);

      const plainBase32 = 'JBSWY3DPEHPK3PXP';
      const result = decryptMfaSecret(plainBase32);

      // 콜론 2개 미포함 → 평문 반환
      expect(result).toBe(plainBase32);
    });
  });
});
