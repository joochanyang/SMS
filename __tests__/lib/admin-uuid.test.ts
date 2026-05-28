import { describe, expect, it, vi, afterEach } from 'vitest';
import { randomUUID } from '../../admin/lib/uuid';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('admin/lib/uuid', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
    vi.restoreAllMocks();
  });

  it('네이티브 crypto.randomUUID 가 있으면 그대로 사용', () => {
    const fake = '11111111-2222-4333-8444-555555555555';
    const fakeCrypto = {
      randomUUID: () => fake,
      getRandomValues: (a: Uint8Array) => a,
    };
    Object.defineProperty(globalThis, 'crypto', { value: fakeCrypto, configurable: true });
    expect(randomUUID()).toBe(fake);
  });

  it('HTTP 환경(Secure Context 아님)처럼 randomUUID 가 없을 때 getRandomValues 로 v4 생성', () => {
    let called = 0;
    const fakeCrypto = {
      getRandomValues: (arr: Uint8Array) => {
        called++;
        for (let i = 0; i < arr.length; i++) arr[i] = (i * 17) & 0xff;
        return arr;
      },
    };
    Object.defineProperty(globalThis, 'crypto', { value: fakeCrypto, configurable: true });
    const id = randomUUID();
    expect(called).toBe(1);
    expect(id).toMatch(UUID_V4_RE);
  });

  it('crypto 자체가 없을 때(Math.random 폴백)도 형식 보장', () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const id = randomUUID();
    expect(id).toMatch(UUID_V4_RE);
  });
});
