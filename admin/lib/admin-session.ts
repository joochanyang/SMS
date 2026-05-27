import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { generateSessionToken } from './admin-auth';

const SESSION_COOKIE = 'admin_session';
const SESSION_IDLE_MS = 30 * 60 * 1000;        // 30 minutes
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000; // 8 hours

// 세션 IP 바인딩 정책 (ADMIN_SESSION_IP_BIND):
// - "strict": 정확히 같은 IP만 허용 (보안 강함, UX 불편)
// - "prefix"(기본): IPv4 /24, IPv6 /64 같은 prefix면 허용 (셀룰러·WiFi 전환 대응)
// - "off": IP 검증 끔 (테스트·신뢰 네트워크 전용)
type IpBindMode = 'strict' | 'prefix' | 'off';
function getIpBindMode(): IpBindMode {
  const v = (process.env.ADMIN_SESSION_IP_BIND ?? 'prefix').toLowerCase();
  if (v === 'strict' || v === 'off' || v === 'prefix') return v;
  return 'prefix';
}

function ipsMatch(sessionIp: string, currentIp: string, mode: IpBindMode): boolean {
  if (mode === 'off') return true;
  if (sessionIp === currentIp) return true;
  if (mode === 'strict') return false;
  // prefix mode
  if (sessionIp.includes(':') && currentIp.includes(':')) {
    // IPv6 — /64 prefix (앞 4 그룹)
    const a = sessionIp.split(':').slice(0, 4).join(':');
    const b = currentIp.split(':').slice(0, 4).join(':');
    return a === b && a.length > 0;
  }
  if (!sessionIp.includes(':') && !currentIp.includes(':')) {
    // IPv4 — /24 prefix (앞 3 옥텟)
    const a = sessionIp.split('.').slice(0, 3).join('.');
    const b = currentIp.split('.').slice(0, 3).join('.');
    return a === b && a.split('.').length === 3;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { getClientIp as sharedGetClientIp } from '@shared/client-ip';

export function getClientIp(req: NextRequest): string {
  const ip = sharedGetClientIp(req, 'trusted');
  return ip === 'unknown' ? '127.0.0.1' : ip;
}

export function getClientUserAgent(req: NextRequest): string {
  return req.headers.get('user-agent') ?? 'unknown';
}

function cookieOptions() {
  // secure 쿠키 정책:
  // - 기본: HTTPS(=production + HTTPS 리버스프록시) 환경에서만 secure=true
  // - 명시적 제어: ADMIN_SECURE_COOKIE=true|false 로 강제 가능
  //
  // ⚠️ 함정: NODE_ENV=production이라도 HTTP로 접속하면 secure=true 쿠키는
  // 브라우저가 거부함 → Set-Cookie 헤더는 와도 저장 안 됨 → 다음 요청에
  // 쿠키 안 실림 → /api/auth/session 401 → /login 무한 redirect.
  // HTTP 접속을 허용해야 하는 환경(IP+포트 직접 접속 등)은 ADMIN_SECURE_COOKIE=false.
  const explicit = process.env.ADMIN_SECURE_COOKIE;
  const secure =
    explicit === 'true' ? true
    : explicit === 'false' ? false
    : process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure,
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

  // IP binding check (정책: strict / prefix / off — ADMIN_SESSION_IP_BIND)
  const currentIp = getClientIp(req);
  if (!ipsMatch(session.ipAddress, currentIp, getIpBindMode())) {
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
