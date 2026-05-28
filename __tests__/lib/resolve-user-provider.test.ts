import { describe, it, expect } from 'vitest';
import { pickProviderName } from '../../lib/sms-providers/router';

// 본 테스트는 순수 함수 `pickProviderName` 만 검증한다.
// `resolveUserProvider` 는 prisma/provider 의존성이 있어 단위 테스트 대상이 아니다 — 본 PR 에서 사용처가 없으므로
// 검증은 UI/통합 단계에서 라이브로 한다 (plan Task 1.5 Step 4 권장 방식).

describe('pickProviderName', () => {
  it('user override 가 있고 알려진 라인이면 그 라인을 반환한다', () => {
    expect(pickProviderName('smsto', 'infobip')).toBe('smsto');
  });

  it('user override 가 null 이면 global 라인으로 폴백한다', () => {
    expect(pickProviderName(null, 'smsto')).toBe('smsto');
  });

  it('user override 가 알 수 없는 값이면 global 로 폴백한다', () => {
    expect(pickProviderName('xxx', 'infobip')).toBe('infobip');
  });

  it('user 와 global 둘 다 알 수 없는 값이면 infobip 기본값으로 폴백한다', () => {
    expect(pickProviderName(null, 'yyy')).toBe('infobip');
  });

  it('user undefined + global 빈 문자열이면 infobip 기본값으로 폴백한다', () => {
    expect(pickProviderName(undefined, '')).toBe('infobip');
  });

  it('user 가 txg 면 txg 를 반환한다 (세 번째 알려진 라인)', () => {
    expect(pickProviderName('txg', 'infobip')).toBe('txg');
  });
});
