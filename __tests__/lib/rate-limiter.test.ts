import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit } from '../../lib/rate-limiter';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('첫 요청은 허용된다', () => {
    const result = checkRateLimit('test:first', 5, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('허용 횟수 내에서는 계속 허용된다', () => {
    const key = 'test:within-limit';
    for (let i = 0; i < 3; i++) {
      const result = checkRateLimit(key, 5, 60000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it('허용 횟수를 초과하면 거부된다', () => {
    const key = 'test:exceed';
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 60000);
    }
    const result = checkRateLimit(key, 5, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('다른 key는 독립적으로 동작한다', () => {
    const keyA = 'test:independent-a';
    const keyB = 'test:independent-b';

    // keyA 한도 소진
    for (let i = 0; i < 3; i++) {
      checkRateLimit(keyA, 3, 60000);
    }
    expect(checkRateLimit(keyA, 3, 60000).allowed).toBe(false);

    // keyB는 여전히 허용
    expect(checkRateLimit(keyB, 3, 60000).allowed).toBe(true);
  });

  it('윈도우 경과 후 다시 허용된다', () => {
    const key = 'test:window-reset';

    // 한도 소진
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, 3, 60000);
    }
    expect(checkRateLimit(key, 3, 60000).allowed).toBe(false);

    // 윈도우 시간 경과
    vi.advanceTimersByTime(61000);

    const result = checkRateLimit(key, 3, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('maxRequests=1이면 첫 요청만 허용된다', () => {
    const key = 'test:single';
    expect(checkRateLimit(key, 1, 60000).allowed).toBe(true);
    expect(checkRateLimit(key, 1, 60000).allowed).toBe(false);
  });

  it('retryAfterMs는 최소 1000ms이다', () => {
    const key = 'test:retry-min';
    checkRateLimit(key, 1, 60000);
    const result = checkRateLimit(key, 1, 60000);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(1000);
  });

  it('슬라이딩 윈도우: 오래된 요청이 윈도우 밖으로 나가면 새 요청이 허용된다', () => {
    const key = 'test:sliding';

    // t=0: 3회 요청
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, 3, 10000);
    }
    expect(checkRateLimit(key, 3, 10000).allowed).toBe(false);

    // t=5s: 아직 윈도우 안
    vi.advanceTimersByTime(5000);
    expect(checkRateLimit(key, 3, 10000).allowed).toBe(false);

    // t=11s: 첫 3개 요청이 윈도우 밖 (10s 윈도우)
    vi.advanceTimersByTime(6000);
    const result = checkRateLimit(key, 3, 10000);
    expect(result.allowed).toBe(true);
  });
});
