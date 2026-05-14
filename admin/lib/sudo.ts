/**
 * Sudo Mode for SovereignSMS Admin Panel
 *
 * Sensitive operations (credit adjustments, user deletion, kill switch, etc.)
 * require re-authentication. Sudo mode is valid for 5 minutes after
 * password verification.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@shared/prisma';
import { verifyPassword } from '@/lib/admin-auth';

interface AdminUser {
  id: string;
  email: string;
  role: string;
  name: string;
}

const SUDO_DURATION_MS = 5 * 60 * 1000; // 5 minutes

type SudoError = Error & {
  status?: number;
  code?: 'UNAUTHORIZED' | 'SUDO_REQUIRED';
  requireSudo?: boolean;
};

/**
 * Extract the session token from the request cookie.
 */
function getSessionToken(req: NextRequest): string | null {
  return req.cookies.get('admin_session')?.value ?? null;
}

/**
 * Require that the admin is in sudo mode.
 *
 * Throws a NextResponse-compatible error object with `requireSudo: true`
 * so the frontend can prompt for password re-entry.
 */
export async function requireSudo(req: NextRequest, admin: AdminUser): Promise<void> {
  void admin;

  const token = getSessionToken(req);
  if (!token) {
    const error = new Error('세션이 없습니다.') as SudoError;
    error.status = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const session = await prisma.adminSession.findUnique({
    where: { sessionToken: token },
    select: { sudoUntil: true },
  });

  if (!session) {
    const error = new Error('유효하지 않은 세션입니다.') as SudoError;
    error.status = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const now = new Date();
  if (!session.sudoUntil || session.sudoUntil <= now) {
    const error = new Error('Sudo 모드가 필요합니다.') as SudoError;
    error.status = 403;
    error.code = 'SUDO_REQUIRED';
    error.requireSudo = true;
    throw error;
  }
}

/**
 * Activate sudo mode by verifying the admin's password.
 *
 * On success, sets `AdminSession.sudoUntil` to now + 5 minutes.
 * Returns true if activated, false if password is wrong.
 */
export async function activateSudo(
  req: NextRequest,
  admin: AdminUser,
  password: string,
): Promise<boolean> {
  // Fetch the admin's current password hash
  const adminRecord = await prisma.adminUser.findUnique({
    where: { id: admin.id },
    select: { passwordHash: true },
  });

  if (!adminRecord) return false;

  const valid = await verifyPassword(adminRecord.passwordHash, password);
  if (!valid) return false;

  const token = getSessionToken(req);
  if (!token) return false;

  const sudoUntil = new Date(Date.now() + SUDO_DURATION_MS);

  await prisma.adminSession.update({
    where: { sessionToken: token },
    data: { sudoUntil },
  });

  return true;
}
