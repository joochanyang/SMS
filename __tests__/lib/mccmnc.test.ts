import { describe, it, expect } from 'vitest';
import { mccMncToCarrier, mccMncToCountry } from '../../lib/sms-providers/mccmnc';

describe('mccMncToCarrier', () => {
  it('한국 SKT 코드(45002, 45005, 45011)를 SKT로 매핑한다', () => {
    expect(mccMncToCarrier('45002')).toBe('SKT');
    expect(mccMncToCarrier('45005')).toBe('SKT');
    expect(mccMncToCarrier('45011')).toBe('SKT');
  });

  it('한국 KT 코드(45003, 45004, 45008)를 KT로 매핑한다', () => {
    expect(mccMncToCarrier('45003')).toBe('KT');
    expect(mccMncToCarrier('45004')).toBe('KT');
    expect(mccMncToCarrier('45008')).toBe('KT');
  });

  it('한국 LG U+ 코드(45006)를 LG U+로 매핑한다', () => {
    expect(mccMncToCarrier('45006')).toBe('LG U+');
  });

  it('SK Telink MVNO(45012)를 분리해서 매핑한다', () => {
    expect(mccMncToCarrier('45012')).toBe('SK Telink');
  });

  it('공백/하이픈이 섞인 입력도 정규화하여 매핑한다', () => {
    expect(mccMncToCarrier('450 06')).toBe('LG U+');
    expect(mccMncToCarrier('450-08')).toBe('KT');
    expect(mccMncToCarrier(' 45002 ')).toBe('SKT');
  });

  it('6자리 글로벌 코드(310410=AT&T)를 매핑한다', () => {
    expect(mccMncToCarrier('310410')).toBe('AT&T');
    expect(mccMncToCarrier('310260')).toBe('T-Mobile');
  });

  it('등록되지 않은 코드는 null을 반환한다', () => {
    expect(mccMncToCarrier('45099')).toBeNull();
    expect(mccMncToCarrier('99999')).toBeNull();
  });

  it('null/undefined/빈 문자열을 안전하게 처리한다', () => {
    expect(mccMncToCarrier(null)).toBeNull();
    expect(mccMncToCarrier(undefined)).toBeNull();
    expect(mccMncToCarrier('')).toBeNull();
  });

  it('숫자가 아닌 문자만 있으면 null', () => {
    expect(mccMncToCarrier('abcde')).toBeNull();
    expect(mccMncToCarrier('SKT')).toBeNull();
  });

  it('자릿수 부족(1~4) 또는 초과(7+)는 null', () => {
    expect(mccMncToCarrier('4500')).toBeNull();
    expect(mccMncToCarrier('4500678')).toBeNull();
  });
});

describe('mccMncToCountry', () => {
  it('MCC=450이면 KR을 반환한다', () => {
    expect(mccMncToCountry('45006')).toBe('KR');
    expect(mccMncToCountry('45099')).toBe('KR'); // MNC 모르더라도 국가는 식별
  });

  it('MCC=310/311은 US, MCC=440은 JP, MCC=460은 CN', () => {
    expect(mccMncToCountry('310410')).toBe('US');
    expect(mccMncToCountry('311480')).toBe('US');
    expect(mccMncToCountry('44010')).toBe('JP');
    expect(mccMncToCountry('46000')).toBe('CN');
  });

  it('알 수 없는 MCC는 null', () => {
    expect(mccMncToCountry('99900')).toBeNull();
  });

  it('null/빈 입력은 null', () => {
    expect(mccMncToCountry(null)).toBeNull();
    expect(mccMncToCountry('')).toBeNull();
  });
});
