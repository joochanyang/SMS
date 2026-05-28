import { describe, it, expect } from 'vitest';
import { validatePasswordResetInput } from '../../admin/app/api/users/[id]/password/validate';

describe('validatePasswordResetInput', () => {
  const valid = {
    newPassword: 'abc12345',
    confirmPassword: 'abc12345',
    reason: '운영자 직접 요청으로 재설정',
  };

  it('정상 입력은 통과한다', () => {
    expect(validatePasswordResetInput(valid)).toEqual({ ok: true });
  });

  it('8자 미만 비밀번호는 거부된다', () => {
    const r = validatePasswordResetInput({
      ...valid,
      newPassword: 'abc1',
      confirmPassword: 'abc1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('8자');
  });

  it('영문 누락 비밀번호는 거부된다', () => {
    const r = validatePasswordResetInput({
      ...valid,
      newPassword: '12345678',
      confirmPassword: '12345678',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('영문');
  });

  it('숫자 누락 비밀번호는 거부된다', () => {
    const r = validatePasswordResetInput({
      ...valid,
      newPassword: 'abcdefgh',
      confirmPassword: 'abcdefgh',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('숫자');
  });

  it('확인 비밀번호 불일치는 거부된다', () => {
    const r = validatePasswordResetInput({ ...valid, confirmPassword: 'abc12346' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('일치');
  });

  it('10자 미만 사유는 거부된다', () => {
    const r = validatePasswordResetInput({ ...valid, reason: '짧음' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('10자');
  });
});
