import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

const publicPaths = ["/api/auth", "/api/infobip/dlr", "/api/cron", "/register"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CSRF 방어: 상태 변경 요청에 대해 Origin 헤더 검증
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    // Infobip DLR 웹훅과 Cron은 외부 요청이므로 제외
    const csrfExempt = ["/api/infobip/dlr", "/api/cron"];
    if (!csrfExempt.some((p) => pathname.startsWith(p))) {
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
  }

  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return withSecurityHeaders(NextResponse.next());
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
