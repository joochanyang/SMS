import { describe, it, expect } from 'vitest';

/**
 * 회원가입 검증 로직 테스트
 *
 * route.ts에서 사용하는 정규식과 조건문을 직접 테스트한다.
 * API 호출 없이 순수 검증 규칙만 확인.
 */

// route.ts에서 사용하는 검증 규칙 그대로 추출
const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: '비밀번호는 최소 8자 이상이어야 합니다.' };
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: '비밀번호에 영문과 숫자를 모두 포함해야 합니다.' };
  }
  return { valid: true };
}

function validateUsername(username: string): boolean {
  return usernameRegex.test(username);
}

describe('회원가입 입력 검증', () => {
  describe('username 정규식 검증', () => {
    it('3자 이상 영숫자+밑줄 조합은 통과한다', () => {
      expect(validateUsername('abc')).toBe(true);
      expect(validateUsername('user_123')).toBe(true);
      expect(validateUsername('A_b_C')).toBe(true);
      expect(validateUsername('test_user_name')).toBe(true);
    });

    it('30자까지 허용된다', () => {
      const thirtyChars = 'a'.repeat(30);
      expect(validateUsername(thirtyChars)).toBe(true);
    });

    it('31자 이상은 거부된다', () => {
      const thirtyOneChars = 'a'.repeat(31);
      expect(validateUsername(thirtyOneChars)).toBe(false);
    });

    it('2자 이하는 거부된다', () => {
      expect(validateUsername('ab')).toBe(false);
      expect(validateUsername('a')).toBe(false);
      expect(validateUsername('')).toBe(false);
    });

    it('특수문자가 포함되면 거부된다', () => {
      expect(validateUsername('user@name')).toBe(false);
      expect(validateUsername('user-name')).toBe(false);
      expect(validateUsername('user name')).toBe(false);
      expect(validateUsername('user.name')).toBe(false);
      expect(validateUsername('user!123')).toBe(false);
    });

    it('한글이 포함되면 거부된다', () => {
      expect(validateUsername('사용자123')).toBe(false);
      expect(validateUsername('user한글')).toBe(false);
    });

    it('밑줄(_)은 허용된다', () => {
      expect(validateUsername('___')).toBe(true);
      expect(validateUsername('_user_')).toBe(true);
    });
  });

  describe('비밀번호 정책 검증', () => {
    it('8자 미만은 거부된다', () => {
      expect(validatePassword('abc123')).toEqual({
        valid: false,
        error: '비밀번호는 최소 8자 이상이어야 합니다.',
      });
      expect(validatePassword('a1b2c3')).toEqual({
        valid: false,
        error: '비밀번호는 최소 8자 이상이어야 합니다.',
      });
      expect(validatePassword('')).toEqual({
        valid: false,
        error: '비밀번호는 최소 8자 이상이어야 합니다.',
      });
    });

    it('영문만으로는 거부된다', () => {
      expect(validatePassword('abcdefgh')).toEqual({
        valid: false,
        error: '비밀번호에 영문과 숫자를 모두 포함해야 합니다.',
      });
      expect(validatePassword('ABCDEFGH')).toEqual({
        valid: false,
        error: '비밀번호에 영문과 숫자를 모두 포함해야 합니다.',
      });
    });

    it('숫자만으로는 거부된다', () => {
      expect(validatePassword('12345678')).toEqual({
        valid: false,
        error: '비밀번호에 영문과 숫자를 모두 포함해야 합니다.',
      });
    });

    it('영숫자 혼합 8자 이상은 통과한다', () => {
      expect(validatePassword('abcd1234')).toEqual({ valid: true });
      expect(validatePassword('Password1')).toEqual({ valid: true });
      expect(validatePassword('1a2b3c4d')).toEqual({ valid: true });
    });

    it('특수문자가 포함되어도 영숫자 조건 충족 시 통과한다', () => {
      expect(validatePassword('p@ssw0rd!')).toEqual({ valid: true });
      expect(validatePassword('!@#$%abc1')).toEqual({ valid: true });
    });

    it('정확히 8자인 영숫자 혼합은 통과한다 (경계값)', () => {
      expect(validatePassword('abcdefg1')).toEqual({ valid: true });
    });

    it('7자인 영숫자 혼합은 거부된다 (경계값)', () => {
      expect(validatePassword('abcdef1')).toEqual({
        valid: false,
        error: '비밀번호는 최소 8자 이상이어야 합니다.',
      });
    });
  });

  describe('필수 입력 검증', () => {
    it('username과 password가 모두 있어야 한다', () => {
      // 실제 route.ts의 검증 로직 재현
      function validateRequired(username?: string, password?: string): boolean {
        return !!(username && password);
      }

      expect(validateRequired('user', 'pass')).toBe(true);
      expect(validateRequired('', 'pass')).toBe(false);
      expect(validateRequired('user', '')).toBe(false);
      expect(validateRequired(undefined, 'pass')).toBe(false);
      expect(validateRequired('user', undefined)).toBe(false);
      expect(validateRequired(undefined, undefined)).toBe(false);
    });
  });
});
