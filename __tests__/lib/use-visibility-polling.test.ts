import { describe, it, expect } from 'vitest';
import { shouldTickNow } from '../../admin/lib/use-visibility-polling';

// 본 테스트는 useVisibilityPolling 훅의 가시성 결정 로직(`shouldTickNow`)
// 만 단위 테스트한다. useEffect/setInterval 배선은 라이브 검증(T13)에서 확인.

describe('shouldTickNow', () => {
  it('visibilityState 가 visible 이면 tick 한다', () => {
    expect(shouldTickNow('visible')).toBe(true);
  });

  it('visibilityState 가 hidden 이면 tick 하지 않는다', () => {
    expect(shouldTickNow('hidden')).toBe(false);
  });

  it('visibilityState 가 prerender 이면 tick 하지 않는다', () => {
    expect(shouldTickNow('prerender')).toBe(false);
  });

  it('SSR 환경(undefined)에서는 tick 하지 않는다', () => {
    expect(shouldTickNow(undefined)).toBe(false);
  });
});
