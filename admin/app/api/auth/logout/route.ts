import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import {
  destroySession,
  clearSessionCookie,
  validateSession,
  getClientIp,
  getClientUserAgent,
} from '@/lib/admin-session';

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ua = getClientUserAgent(request);

    // Try to get admin info for audit before destroying session
    const admin = await validateSession(request);

    // Destroy session in DB
    await destroySession(request);

    // Audit log
    if (admin) {
      try {
        await prisma.auditLog.create({
          data: {
            adminId: admin.id,
            adminEmail: admin.email,
            action: 'LOGOUT',
            targetType: 'AdminUser',
            targetId: admin.id,
            reason: '로그아웃',
            ipAddress: ip,
            userAgent: ua,
            result: 'SUCCESS',
          },
        });
      } catch {
        // non-blocking
      }
    }

    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    return response;
  } catch {
    // Even on error, try to clear the cookie
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    return response;
  }
}
