import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

/**
 * Next.js 16 Proxy — replaces middleware.ts
 *
 * Handles session-based access control at the edge.
 * Public paths (login, MFA, auth API) are allowed through.
 * All other paths require a valid admin_session cookie.
 */

const PUBLIC_PATHS = ['/login', '/mfa-verify', '/mfa-setup', '/api/auth/', '/api/health'];

// CSRF 화이트리스트: ADMIN_ALLOWED_ORIGINS 쉼표 분리 (예: "http://5.161.112.248:3301,https://admin.example.com").
// 미설정 시 fallback으로 Host 헤더 기반 비교 — nginx 뒤에서도 Host가 보존된다면 작동.
function parseAllowedOrigins(): string[] | null {
  const raw = process.env.ADMIN_ALLOWED_ORIGINS;
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isCsrfAllowed(origin: string, host: string | null): boolean {
  const whitelist = parseAllowedOrigins();
  if (whitelist) {
    return whitelist.includes(origin);
  }
  // Fallback: Origin host == Host header. nginx가 proxy_set_header Host $host 안 하면 깨질 수 있음.
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSRF 방어: 상태 변경 요청에 대해 Origin 헤더 검증
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!origin) {
      // Origin 헤더 없는 상태 변경 요청 차단
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    if (!isCsrfAllowed(origin, host)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Allow static assets
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/icons/') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg')
  ) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Check session cookie
  const session = request.cookies.get('admin_session');

  if (!session) {
    // API routes get JSON 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 },
      );
    }

    // Page routes redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
