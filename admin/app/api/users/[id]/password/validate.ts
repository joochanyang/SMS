/**
 * 유저 비밀번호 강제 재설정 입력 검증 (순수 함수).
 *
 * SUPER_ADMIN 이 유저 비밀번호를 강제 재설정할 때 사용한다.
 * 라우트 핸들러는 sudo + audit + bcrypt 만 다루고, 입력 검증은 이 함수가 단독 책임.
 */

export interface PasswordResetInput {
  newPassword: string;
  confirmPassword: string;
  reason: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validatePasswordResetInput(input: PasswordResetInput): ValidationResult {
  if (typeof input.newPassword !== 'string' || input.newPassword.length < 8) {
    return { ok: false, error: '비밀번호는 최소 8자 이상이어야 합니다.' };
  }
  if (!/[a-zA-Z]/.test(input.newPassword)) {
    return { ok: false, error: '비밀번호에 영문을 포함해야 합니다.' };
  }
  if (!/[0-9]/.test(input.newPassword)) {
    return { ok: false, error: '비밀번호에 숫자를 포함해야 합니다.' };
  }
  if (input.confirmPassword !== input.newPassword) {
    return { ok: false, error: '비밀번호 확인이 일치하지 않습니다.' };
  }
  if (typeof input.reason !== 'string' || input.reason.length < 10) {
    return { ok: false, error: '사유를 10자 이상 입력하세요.' };
  }
  return { ok: true };
}
