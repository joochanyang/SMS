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

const PUBLIC_PATHS = ['/login', '/mfa-verify', '/mfa-setup', '/api/auth/'];

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
    if (host) {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
      }
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
