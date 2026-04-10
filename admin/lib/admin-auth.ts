import argon2 from 'argon2';
import crypto from 'crypto';

/**
 * Hash a password using argon2id (recommended variant).
 * Uses argon2's secure defaults for memory cost, time cost, and parallelism.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,   // 64 MiB
    timeCost: 3,
    parallelism: 4,
  });
}

/**
 * Verify a password against an argon2id hash.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Validate password against the security policy.
 * - Min 16 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character
 * - Must not match any previous password hashes
 */
export function validatePasswordPolicy(
  password: string,
  previousPasswords: string[] = [],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 16) {
    errors.push('비밀번호는 최소 16자 이상이어야 합니다.');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('대문자를 최소 1개 포함해야 합니다.');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('소문자를 최소 1개 포함해야 합니다.');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('숫자를 최소 1개 포함해야 합니다.');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('특수문자를 최소 1개 포함해야 합니다.');
  }

  // previousPasswords is checked asynchronously in the caller;
  // here we only flag if the array is provided with a synchronous note.
  // Actual argon2 comparison must be done by the caller.
  // We keep this field for structural completeness but the real check
  // is async — see `checkPreviousPasswords` below.

  return { valid: errors.length === 0, errors };
}

/**
 * Async check: does this password match any of the previous password hashes?
 */
export async function checkPreviousPasswords(
  password: string,
  previousHashes: string[],
): Promise<boolean> {
  for (const hash of previousHashes) {
    const matches = await verifyPassword(hash, password);
    if (matches) return true; // password was used before
  }
  return false;
}

/**
 * Generate a cryptographically secure session token (64 hex chars = 256 bits).
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate MFA backup codes — 10 codes, each 8 chars alphanumeric uppercase.
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const buf = crypto.randomBytes(5); // 5 bytes = 10 hex chars, trim to 8
    codes.push(buf.toString('hex').toUpperCase().slice(0, 8));
  }
  return codes;
}
