import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { generateSessionToken } from './admin-auth';

const SESSION_COOKIE = 'admin_session';
const SESSION_IDLE_MS = 30 * 60 * 1000;        // 30 minutes
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000; // 8 hours

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return '127.0.0.1';
}

export function getClientUserAgent(req: NextRequest): string {
  return req.headers.get('user-agent') ?? 'unknown';
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  };
}

// ---------------------------------------------------------------------------
// Create Session
// ---------------------------------------------------------------------------

export async function createSession(
  adminId: string,
  req: NextRequest,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  const ip = getClientIp(req);
  const ua = getClientUserAgent(req);

  // Single-session policy: delete any existing sessions for this admin
  await prisma.adminSession.deleteMany({ where: { adminId } });

  await prisma.adminSession.create({
    data: {
      adminId,
      sessionToken: token,
      ipAddress: ip,
      userAgent: ua,
      expiresAt,
      lastActivityAt: now,
      mfaVerified: false,
    },
  });

  return { token, expiresAt };
}

/**
 * Set the session cookie on a NextResponse.
 */
export function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): void {
  response.cookies.set(SESSION_COOKIE, token, {
    ...cookieOptions(),
    expires: expiresAt,
  });
}

/**
 * Clear the session cookie on a NextResponse.
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, '', {
    ...cookieOptions(),
    maxAge: 0,
  });
}

// ---------------------------------------------------------------------------
// Validate Session
// ---------------------------------------------------------------------------

export async function validateSession(
  req: NextRequest,
): Promise<{
  id: string;
  email: string;
  username: string;
  name: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
} | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.adminSession.findUnique({
    where: { sessionToken: token },
    include: { admin: true },
  });

  if (!session) return null;

  const now = new Date();

  // Absolute expiry
  if (now > session.expiresAt) {
    await prisma.adminSession.delete({ where: { id: session.id } });
    return null;
  }

  // Idle expiry (30min since last activity)
  const idleDeadline = new Date(session.lastActivityAt.getTime() + SESSION_IDLE_MS);
  if (now > idleDeadline) {
    await prisma.adminSession.delete({ where: { id: session.id } });
    return null;
  }

  // IP binding check
  const currentIp = getClientIp(req);
  if (session.ipAddress !== currentIp) {
    await prisma.adminSession.delete({ where: { id: session.id } });
    return null;
  }

  // MFA check: if admin has MFA enabled, session must be mfa-verified
  if (session.admin.mfaEnabled && !session.mfaVerified) {
    // Return null for full auth — the caller can handle partial auth separately
    return null;
  }

  // Admin account status check
  if (session.admin.status !== 'ACTIVE') {
    await prisma.adminSession.delete({ where: { id: session.id } });
    return null;
  }

  // Extend idle window
  await prisma.adminSession.update({
    where: { id: session.id },
    data: { lastActivityAt: now },
  });

  return {
    id: session.admin.id,
    email: session.admin.email ?? session.admin.username,
    username: session.admin.username,
    name: session.admin.name,
    role: session.admin.role,
    status: session.admin.status,
    mfaEnabled: session.admin.mfaEnabled,
  };
}

// ---------------------------------------------------------------------------
// Destroy Session
// ---------------------------------------------------------------------------

export async function destroySession(req: NextRequest): Promise<void> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;

  await prisma.adminSession.deleteMany({ where: { sessionToken: token } });
}

// ---------------------------------------------------------------------------
// Require Auth (throws-style guard)
// ---------------------------------------------------------------------------

export async function requireAuth(
  req: NextRequest,
): Promise<{
  id: string;
  email: string;
  username: string;
  name: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
}> {
  const admin = await validateSession(req);
  if (!admin) {
    throw new AuthError('인증이 필요합니다.', 401);
  }
  return admin;
}

/**
 * Custom error class for auth failures so route handlers can catch and respond.
 */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
