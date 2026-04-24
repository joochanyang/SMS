import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { validateSession } from '@/lib/admin-session';
import { getKillSwitchLevel, isKillSwitchActive } from '@/lib/kill-switch';

// ---------------------------------------------------------------------------
// GET /api/auth/session — Return current admin info if authenticated
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const [admin, killSwitchSetting] = await Promise.all([
      validateSession(request),
      prisma.systemSetting.findUnique({
        where: { key: 'kill_switch' },
        select: { value: true },
      }),
    ]);

    if (!admin) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 },
      );
    }

    const killSwitchLevel = getKillSwitchLevel(killSwitchSetting?.value);

    return NextResponse.json({
      authenticated: true,
      admin: {
        id: admin.id,
        email: admin.email,
        username: admin.username,
        name: admin.name,
        role: admin.role,
        mfaEnabled: admin.mfaEnabled,
      },
      killSwitch: isKillSwitchActive(killSwitchLevel),
      killSwitchLevel,
    });
  } catch {
    return NextResponse.json(
      { error: '세션 확인 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
