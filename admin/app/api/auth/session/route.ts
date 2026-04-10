import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/admin-session';

// ---------------------------------------------------------------------------
// GET /api/auth/session — Return current admin info if authenticated
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await validateSession(request);

    if (!admin) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 },
      );
    }

    return NextResponse.json({
      authenticated: true,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        mfaEnabled: admin.mfaEnabled,
      },
    });
  } catch {
    return NextResponse.json(
      { error: '세션 확인 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
