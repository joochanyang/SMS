import { describe, it, expect } from 'vitest';
import {
  isGsm7,
  getSmsSegmentInfo,
  normalizePhone,
  normalizeRecipients,
  getRetryDelayMs,
  isTemporaryProviderError,
  SMS_POLICY,
} from '../lib/sms-policy';

// ---------------------------------------------------------------------------
// isGsm7
// ---------------------------------------------------------------------------
describe('isGsm7', () => {
  it('영문 알파벳만 있으면 true를 반환한다', () => {
    expect(isGsm7('Hello World')).toBe(true);
  });

  it('숫자와 GSM-7 범위 특수문자가 있으면 true를 반환한다', () => {
    expect(isGsm7('123 !@#$%&*()')).toBe(true);
  });

  it('한국어가 포함되면 false를 반환한다', () => {
    expect(isGsm7('안녕하세요')).toBe(false);
  });

  it('한국어가 영문과 혼합되어 있어도 false를 반환한다', () => {
    expect(isGsm7('Hello 세계')).toBe(false);
  });

  it('이모지가 포함되면 false를 반환한다', () => {
    expect(isGsm7('Hello 😀')).toBe(false);
  });

  it('빈 문자열이면 true를 반환한다', () => {
    expect(isGsm7('')).toBe(true);
  });

  it('유로 기호(€)는 GSM-7 확장 문자이므로 true를 반환한다', () => {
    expect(isGsm7('Price: €100')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getSmsSegmentInfo
// ---------------------------------------------------------------------------
describe('getSmsSegmentInfo', () => {
  it('영문 160자 이하는 GSM-7, parts=1이다', () => {
    const text = 'A'.repeat(160);
    const result = getSmsSegmentInfo(text);
    expect(result.encoding).toBe('GSM-7');
    expect(result.parts).toBe(1);
    expect(result.charCount).toBe(160);
    expect(result.warning).toBeNull();
  });

  it('영문 161자는 GSM-7, parts=2이다 (153자 단위 분할)', () => {
    const text = 'A'.repeat(161);
    const result = getSmsSegmentInfo(text);
    expect(result.encoding).toBe('GSM-7');
    // ceil(161 / 153) = 2
    expect(result.parts).toBe(2);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain('161자');
    expect(result.warning).toContain('2건');
  });

  it('GSM-7 153자 경계 값 — 153자는 parts=2이다', () => {
    // 153자 초과하므로 ceil(161/153) — 먼저 정확히 153자 test
    const text = 'A'.repeat(153);
    // 153 <= 160 이므로 single SMS
    const result = getSmsSegmentInfo(text);
    expect(result.parts).toBe(1);
  });

  it('한국어 70자 이하는 UCS-2, parts=1이다', () => {
    const text = '가'.repeat(70);
    const result = getSmsSegmentInfo(text);
    expect(result.encoding).toBe('UCS-2');
    expect(result.parts).toBe(1);
    expect(result.warning).toBeNull();
  });

  it('한국어 71자는 UCS-2, parts=2이다 (67자 단위 분할)', () => {
    const text = '가'.repeat(71);
    const result = getSmsSegmentInfo(text);
    expect(result.encoding).toBe('UCS-2');
    // ceil(71 / 67) = 2
    expect(result.parts).toBe(2);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain('71자');
    expect(result.warning).toContain('2건');
  });

  it('한국어 134자는 UCS-2, parts=2이다', () => {
    const text = '가'.repeat(134);
    const result = getSmsSegmentInfo(text);
    // ceil(134 / 67) = 2
    expect(result.parts).toBe(2);
  });

  it('한국어 135자는 UCS-2, parts=3이다', () => {
    const text = '가'.repeat(135);
    const result = getSmsSegmentInfo(text);
    // ceil(135 / 67) = ceil(2.01...) = 3
    expect(result.parts).toBe(3);
  });

  it('빈 문자열은 GSM-7, parts=1이다', () => {
    const result = getSmsSegmentInfo('');
    expect(result.encoding).toBe('GSM-7');
    expect(result.parts).toBe(1);
    expect(result.charCount).toBe(0);
    expect(result.warning).toBeNull();
  });

  it('maxCharsPerSms는 GSM-7일 때 160이다', () => {
    const result = getSmsSegmentInfo('Hello');
    expect(result.maxCharsPerSms).toBe(SMS_POLICY.gsm7MaxChars);
  });

  it('maxCharsPerSms는 UCS-2일 때 70이다', () => {
    const result = getSmsSegmentInfo('안녕');
    expect(result.maxCharsPerSms).toBe(SMS_POLICY.ucs2MaxChars);
  });

  it('초과 시 warning 필드에 한국어 경고 메시지가 존재한다', () => {
    const result = getSmsSegmentInfo('가'.repeat(71));
    expect(typeof result.warning).toBe('string');
    expect(result.warning!.length).toBeGreaterThan(0);
  });

  it('초과하지 않으면 warning은 null이다', () => {
    expect(getSmsSegmentInfo('안녕하세요').warning).toBeNull();
    expect(getSmsSegmentInfo('Hello').warning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizePhone
// ---------------------------------------------------------------------------
describe('normalizePhone', () => {
  it('이미 E.164 형식(+821012345678)이면 그대로 반환한다', () => {
    expect(normalizePhone('+821012345678')).toBe('+821012345678');
  });

  it('한국 로컬 번호(01012345678)는 +821012345678로 변환한다', () => {
    expect(normalizePhone('01012345678')).toBe('+821012345678');
  });

  it('+ 없이 국가코드 포함(821012345678)이면 +821012345678로 변환한다', () => {
    expect(normalizePhone('821012345678')).toBe('+821012345678');
  });

  it('하이픈이 포함된 한국 번호(010-1234-5678)는 +821012345678로 변환한다', () => {
    expect(normalizePhone('010-1234-5678')).toBe('+821012345678');
  });

  it('공백이 포함된 번호도 정상 변환한다', () => {
    expect(normalizePhone('010 1234 5678')).toBe('+821012345678');
  });

  it('너무 짧은 번호(12345)는 null을 반환한다', () => {
    expect(normalizePhone('12345')).toBeNull();
  });

  it('빈 문자열은 null을 반환한다', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('미국 번호(+14155552671)는 그대로 반환한다', () => {
    expect(normalizePhone('+14155552671')).toBe('+14155552671');
  });

  it('공백만 있는 문자열은 null을 반환한다', () => {
    expect(normalizePhone('   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeRecipients
// ---------------------------------------------------------------------------
describe('normalizeRecipients', () => {
  it('중복 번호를 제거한다', () => {
    const input = ['+821012345678', '01012345678', '+821012345678'];
    const result = normalizeRecipients(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('+821012345678');
  });

  it('유효하지 않은 번호는 필터링한다', () => {
    const input = ['12345', '', '+821012345678', '   '];
    const result = normalizeRecipients(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('+821012345678');
  });

  it('빈 배열을 입력하면 빈 배열을 반환한다', () => {
    expect(normalizeRecipients([])).toEqual([]);
  });

  it('모두 유효하지 않은 번호이면 빈 배열을 반환한다', () => {
    expect(normalizeRecipients(['abc', '123', ''])).toEqual([]);
  });

  it('여러 국가 번호를 올바르게 정규화하고 중복을 제거한다', () => {
    const input = ['+14155552671', '+14155552671', '01012345678'];
    const result = normalizeRecipients(input);
    expect(result).toHaveLength(2);
    expect(result).toContain('+14155552671');
    expect(result).toContain('+821012345678');
  });

  it('앞뒤 공백이 있는 번호도 정상 처리한다', () => {
    const input = ['  +821012345678  ', '+821012345678'];
    const result = normalizeRecipients(input);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getRetryDelayMs
// ---------------------------------------------------------------------------
describe('getRetryDelayMs', () => {
  it('retryCount=0이면 30초(0.5분 × 60000)를 반환한다', () => {
    expect(getRetryDelayMs(0)).toBe(0.5 * 60 * 1000);
    expect(getRetryDelayMs(0)).toBe(30000);
  });

  it('retryCount=1이면 2분(120000ms)을 반환한다', () => {
    expect(getRetryDelayMs(1)).toBe(2 * 60 * 1000);
    expect(getRetryDelayMs(1)).toBe(120000);
  });

  it('retryCount=2이면 5분(300000ms)을 반환한다', () => {
    expect(getRetryDelayMs(2)).toBe(5 * 60 * 1000);
    expect(getRetryDelayMs(2)).toBe(300000);
  });

  it('retryCount=99처럼 범위를 초과해도 마지막 값(5분)을 유지한다', () => {
    expect(getRetryDelayMs(99)).toBe(5 * 60 * 1000);
  });

  it('retryCount=3도 마지막 값(5분)을 반환한다', () => {
    expect(getRetryDelayMs(3)).toBe(5 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// isTemporaryProviderError
// ---------------------------------------------------------------------------
describe('isTemporaryProviderError', () => {
  it('"PENDING_ACCEPTED"는 임시 오류가 아니므로 false를 반환한다', () => {
    expect(isTemporaryProviderError('PENDING_ACCEPTED')).toBe(false);
  });

  it('"PENDING_ENROUTE"는 임시 오류가 아니므로 false를 반환한다', () => {
    expect(isTemporaryProviderError('PENDING_ENROUTE')).toBe(false);
  });

  it('"SENT"는 임시 오류가 아니므로 false를 반환한다', () => {
    expect(isTemporaryProviderError('SENT')).toBe(false);
  });

  it('"DELIVERED"는 임시 오류가 아니므로 false를 반환한다', () => {
    expect(isTemporaryProviderError('DELIVERED')).toBe(false);
  });

  it('"PENDING_WAITING_DELIVERY"는 임시 오류이므로 true를 반환한다', () => {
    expect(isTemporaryProviderError('PENDING_WAITING_DELIVERY')).toBe(true);
  });

  it('"QUEUE_FULL"은 임시 오류이므로 true를 반환한다', () => {
    expect(isTemporaryProviderError('QUEUE_FULL')).toBe(true);
  });

  it('"TIMEOUT"은 임시 오류이므로 true를 반환한다', () => {
    expect(isTemporaryProviderError('TIMEOUT')).toBe(true);
  });

  it('"THROTTLE_ERROR"는 임시 오류이므로 true를 반환한다', () => {
    expect(isTemporaryProviderError('THROTTLE_ERROR')).toBe(true);
  });

  it('"TEMP_FAILURE"는 임시 오류이므로 true를 반환한다', () => {
    expect(isTemporaryProviderError('TEMP_FAILURE')).toBe(true);
  });

  it('소문자로 전달해도 올바르게 판단한다 (대소문자 무관)', () => {
    expect(isTemporaryProviderError('sent')).toBe(false);
    expect(isTemporaryProviderError('timeout')).toBe(true);
  });
});
