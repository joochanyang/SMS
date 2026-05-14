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
  '연락처',
  '전화',
  '휴대폰',
  '핸드폰',
  'phone',
  'mobile',
  'tel',
  'number',
]);
const NAME_KEYS = new Set(['이름', '성명', '성함', '이름성명', 'name', 'fullname']);
const NICK_KEYS = new Set(['별명', '별칭', '닉네임', 'nickname', 'nick']);

function normalizeKey(key: string) {
  return key.replace(/﻿/g, '').replace(/[\s​-‍⁠]/g, '').toLowerCase();
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
  return rows[0] ? Object.keys(rows[0]).map((key) => `"${key}"`).join(', ') : '(빈 파일)';
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
