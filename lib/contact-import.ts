export type ContactImportRow = Record<string, string | number | undefined>;

export type ImportedContact = {
  phone: string;
  name: string;
  nickname: string;
};

const PHONE_KEYS = new Set([
  '번호',
  '전화번호',
  '휴대폰번호',
  '핸드폰번호',
  '휴대전화',
  '휴대전화번호',
  '연락처',
  '전화',
  '휴대폰',
  '핸드폰',
  'phone',
  'phonenumber',
  'mobile',
  'mobilephone',
  'cell',
  'cellphone',
  'tel',
  'telephone',
  'number',
  'no',
]);

const NAME_KEYS = new Set([
  '이름',
  '성명',
  '성함',
  '이름성명',
  '고객명',
  '수신자명',
  '수신자',
  'name',
  'fullname',
  'customername',
  'recipient',
  'recipientname',
]);

const NICK_KEYS = new Set([
  '별명',
  '별칭',
  '닉네임',
  '닉',
  'nickname',
  'nick',
  'alias',
]);

function normalizeKey(key: string) {
  return key
    .replace(/﻿/g, '')
    .replace(/[\s​-‍⁠-]/g, '')
    .toLowerCase();
}

function pickField(row: Record<string, unknown>, allowed: Set<string>): string {
  for (const rawKey of Object.keys(row)) {
    const normalized = normalizeKey(rawKey);
    if (!allowed.has(normalized)) continue;

    const value = row[rawKey];
    if (value == null) continue;

    const text = typeof value === 'string' ? value : String(value);
    if (text.trim()) return text.trim();
  }
  return '';
}

export function describeImportHeaders(rows: ContactImportRow[]) {
  return rows[0]
    ? Object.keys(rows[0]).map((key) => `"${key}"`).join(', ')
    : '(빈 파일)';
}

export function mapImportedContacts(rows: ContactImportRow[]): ImportedContact[] {
  return rows
    .map((row) => ({
      phone: pickField(row as Record<string, unknown>, PHONE_KEYS),
      name: pickField(row as Record<string, unknown>, NAME_KEYS),
      nickname: pickField(row as Record<string, unknown>, NICK_KEYS),
    }))
    .filter((contact) => contact.phone);
}

export function hasRecognizedHeaders(rows: ContactImportRow[]): boolean {
  if (!rows[0]) return false;
  const keys = Object.keys(rows[0]).map(normalizeKey);
  return keys.some(
    (k) => PHONE_KEYS.has(k) || NAME_KEYS.has(k) || NICK_KEYS.has(k),
  );
}

/**
 * 헤더가 인식되면 매핑 결과 반환, 안 되면 모든 셀에서 번호 후보를 긁어 폴백.
 * sms-send처럼 헤더 없는 엑셀/CSV도 받아야 하는 입력 경로용.
 */
export function extractContactsLoose(
  rows: ContactImportRow[],
): ImportedContact[] {
  if (hasRecognizedHeaders(rows)) {
    return mapImportedContacts(rows);
  }

  const contacts: ImportedContact[] = [];
  for (const row of rows) {
    if (!row) continue;
    for (const value of Object.values(row)) {
      if (value == null) continue;
      const text = (typeof value === 'string' ? value : String(value)).trim();
      if (!text) continue;
      contacts.push({ phone: text, name: '', nickname: '' });
    }
  }
  return contacts;
}
