import { describe, it, expect } from 'vitest';
import { shouldDelegateToWorker } from '@/lib/campaign-processor';

describe('shouldDelegateToWorker', () => {
  it('캠페인 라인이 txg이면 워커에 위임한다(true)', () => {
    expect(shouldDelegateToWorker('txg')).toBe(true);
  });
  it('캠페인 라인이 infobip이면 직접 발송한다(false)', () => {
    expect(shouldDelegateToWorker('infobip')).toBe(false);
  });
  it('캠페인 라인이 smsto이면 직접 발송한다(false)', () => {
    expect(shouldDelegateToWorker('smsto')).toBe(false);
  });
  it('라인이 null/미지정이면 직접 발송한다(false) — 전역 기본 infobip 폴백', () => {
    expect(shouldDelegateToWorker(null)).toBe(false);
  });
});
