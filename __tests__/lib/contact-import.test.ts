import { describe, expect, it } from 'vitest';
import {
  extractContactsLoose,
  hasRecognizedHeaders,
  mapImportedContacts,
  type ContactImportRow,
} from '@/lib/contact-import';

describe('contact-import: mapImportedContacts (헤더 매핑)', () => {
  it('한글 헤더 (번호/이름/별명)', () => {
    const rows: ContactImportRow[] = [
      { 번호: '010-1234-5678', 이름: '홍길동', 별명: '길동이' },
      { 번호: '01098765432', 이름: '김철수', 별명: '철수' },
    ];
    expect(mapImportedContacts(rows)).toEqual([
      { phone: '010-1234-5678', name: '홍길동', nickname: '길동이' },
      { phone: '01098765432', name: '김철수', nickname: '철수' },
    ]);
  });

  it('영문 헤더 (phone/name/nickname)', () => {
    const rows: ContactImportRow[] = [
      { phone: '+821012345678', name: 'Alice', nickname: 'Al' },
    ];
    expect(mapImportedContacts(rows)).toEqual([
      { phone: '+821012345678', name: 'Alice', nickname: 'Al' },
    ]);
  });

  it('한·영 혼합 + 별칭(연락처, fullname, nick)', () => {
    const rows: ContactImportRow[] = [
      { 연락처: '01011112222', fullname: '이영희', nick: '영희' },
    ];
    expect(mapImportedContacts(rows)).toEqual([
      { phone: '01011112222', name: '이영희', nickname: '영희' },
    ]);
  });

  it('대소문자/공백/zero-width가 섞인 헤더', () => {
    const rows: ContactImportRow[] = [
      { ' Phone ': '01000000001', '  이 름  ': '테스터' },
    ];
    expect(mapImportedContacts(rows)).toEqual([
      { phone: '01000000001', name: '테스터', nickname: '' },
    ]);
  });

  it('phone이 비면 행 제외', () => {
    const rows: ContactImportRow[] = [
      { 번호: '', 이름: '빈번호' },
      { 번호: '01012345678', 이름: '정상' },
    ];
    expect(mapImportedContacts(rows)).toEqual([
      { phone: '01012345678', name: '정상', nickname: '' },
    ]);
  });

  it('숫자 셀도 문자열로 변환', () => {
    const rows: ContactImportRow[] = [
      { 번호: 1012345678, 이름: '숫자번호' },
    ];
    expect(mapImportedContacts(rows)).toEqual([
      { phone: '1012345678', name: '숫자번호', nickname: '' },
    ]);
  });
});

describe('contact-import: hasRecognizedHeaders', () => {
  it('인식 가능한 헤더가 하나라도 있으면 true', () => {
    expect(hasRecognizedHeaders([{ 번호: '01012345678' }])).toBe(true);
    expect(hasRecognizedHeaders([{ phone: '01012345678' }])).toBe(true);
    expect(hasRecognizedHeaders([{ 휴대전화: '01012345678' }])).toBe(true);
  });

  it('알 수 없는 헤더만 있으면 false', () => {
    expect(hasRecognizedHeaders([{ foo: '01012345678', bar: '값' }])).toBe(false);
  });

  it('빈 행 배열은 false', () => {
    expect(hasRecognizedHeaders([])).toBe(false);
  });
});

describe('contact-import: extractContactsLoose (헤더 없는 폴백)', () => {
  it('헤더가 인식되면 매핑 경로 사용', () => {
    const rows: ContactImportRow[] = [
      { 번호: '01012345678', 이름: '홍길동', 별명: '길동이' },
    ];
    expect(extractContactsLoose(rows)).toEqual([
      { phone: '01012345678', name: '홍길동', nickname: '길동이' },
    ]);
  });

  it('헤더 인식 실패 시 모든 셀을 번호로 긁음 (이름·별명 없이)', () => {
    const rows: ContactImportRow[] = [
      { col1: '01011112222', col2: '01033334444' },
      { col1: '01055556666' },
    ];
    expect(extractContactsLoose(rows)).toEqual([
      { phone: '01011112222', name: '', nickname: '' },
      { phone: '01033334444', name: '', nickname: '' },
      { phone: '01055556666', name: '', nickname: '' },
    ]);
  });

  it('빈 셀은 폴백에서도 제외', () => {
    const rows: ContactImportRow[] = [{ col1: '', col2: '01012345678' }];
    expect(extractContactsLoose(rows)).toEqual([
      { phone: '01012345678', name: '', nickname: '' },
    ]);
  });
});
