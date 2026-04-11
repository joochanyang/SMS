import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(err: unknown): NextResponse {
  if (err instanceof Error) {
    const status = (err as any).status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
  }
  console.error('[API] dashboard/stats:', err);
  return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 });
}

function percentChange(today: number, yesterday: number): string {
  if (yesterday === 0) return today > 0 ? '+100.0' : '0.0';
  return ((((today - yesterday) / yesterday) * 100).toFixed(1));
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/stats — Dashboard statistics
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'dashboard:read');

    const now = new Date();

    // Today's boundaries
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // Yesterday's boundaries
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);
    yesterdayEnd.setMilliseconds(-1);

    // Today's stats
    const [todaySent, todaySuccess, todayFailed, todayCost] = await Promise.all([
      prisma.smsLog.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.smsLog.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd }, status: 'DELIVERED' },
      }),
      prisma.smsLog.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd }, status: 'FAILED' },
      }),
      prisma.smsLog.aggregate({
        where: { createdAt: { gte: todayStart, lte: todayEnd } },
        _sum: { cost: true },
      }),
    ]);

    // Yesterday's stats
    const [yesterdaySent, yesterdaySuccess, yesterdayFailed, yesterdayCost] = await Promise.all([
      prisma.smsLog.count({
        where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd } },
      }),
      prisma.smsLog.count({
        where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd }, status: 'DELIVERED' },
      }),
      prisma.smsLog.count({
        where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd }, status: 'FAILED' },
      }),
      prisma.smsLog.aggregate({
        where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd } },
        _sum: { cost: true },
      }),
    ]);

    // Active campaigns
    const activeCampaigns = await prisma.smsCampaign.count({
      where: { status: { in: ['SENDING', 'QUEUED'] } },
    });

    // Kill switch status
    const killSwitchSetting = await prisma.systemSetting.findUnique({
      where: { key: 'kill_switch' },
    });
    const killSwitchLevel = killSwitchSetting?.value
      ? (typeof killSwitchSetting.value === 'object' && killSwitchSetting.value !== null && 'level' in killSwitchSetting.value
          ? (killSwitchSetting.value as any).level
          : killSwitchSetting.value)
      : 'NORMAL';

    // Recent alerts (last 5 audit logs with result=FAILURE)
    const recentAlerts = await prisma.auditLog.findMany({
      where: { result: 'FAILURE' },
      orderBy: { timestamp: 'desc' },
      take: 5,
      select: {
        id: true,
        timestamp: true,
        adminEmail: true,
        action: true,
        targetType: true,
        reason: true,
      },
    });

    // User stats
    const [totalUsers, activeUsers, suspendedUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: 'SUSPENDED' } }),
    ]);

    return NextResponse.json({
      today: {
        totalSent: todaySent,
        successCount: todaySuccess,
        failedCount: todayFailed,
        totalCost: Number(todayCost._sum.cost ?? 0),
      },
      comparison: {
        sentChange: percentChange(todaySent, yesterdaySent),
        successChange: percentChange(todaySuccess, yesterdaySuccess),
        failedChange: percentChange(todayFailed, yesterdayFailed),
        costChange: percentChange(
          Number(todayCost._sum.cost ?? 0),
          Number(yesterdayCost._sum.cost ?? 0),
        ),
      },
      activeCampaigns,
      system: {
        killSwitchLevel,
      },
      recentAlerts,
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
