import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { handleApiError } from '@shared/api-error';
import { getAllProviders } from '@shared/sms-providers/router';
import { getKillSwitchLevel, isKillSwitchActive } from '@/lib/kill-switch';


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

    // CANCELLED 로그는 환불 처리되므로 총 발송/지출 집계에서 제외
    const todayBase = { createdAt: { gte: todayStart, lte: todayEnd }, status: { not: 'CANCELLED' } };
    const yesterdayBase = { createdAt: { gte: yesterdayStart, lte: yesterdayEnd }, status: { not: 'CANCELLED' } };

    // Today's stats
    const [todaySent, todaySuccess, todayFailed, todayCost] = await Promise.all([
      prisma.smsLog.count({ where: todayBase }),
      prisma.smsLog.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd }, status: 'DELIVERED' },
      }),
      prisma.smsLog.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd }, status: 'FAILED' },
      }),
      prisma.smsLog.aggregate({ where: todayBase, _sum: { cost: true } }),
    ]);

    // Yesterday's stats
    const [yesterdaySent, yesterdaySuccess, yesterdayFailed, yesterdayCost] = await Promise.all([
      prisma.smsLog.count({ where: yesterdayBase }),
      prisma.smsLog.count({
        where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd }, status: 'DELIVERED' },
      }),
      prisma.smsLog.count({
        where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd }, status: 'FAILED' },
      }),
      prisma.smsLog.aggregate({ where: yesterdayBase, _sum: { cost: true } }),
    ]);

    // Active campaigns
    const activeCampaignRows = await prisma.smsCampaign.findMany({
      where: { status: { in: ['SENDING', 'QUEUED'] } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 10,
      include: {
        user: {
          select: { email: true, name: true },
        },
      },
    });

    // Kill switch status
    const killSwitchSetting = await prisma.systemSetting.findUnique({
      where: { key: 'kill_switch' },
    });
    const killSwitchLevel = getKillSwitchLevel(killSwitchSetting?.value);
    const activeProviderSetting = await prisma.systemSetting.findUnique({
      where: { key: 'active_sms_provider' },
      select: { value: true },
    });
    const activeProviderName = ((activeProviderSetting?.value as { provider?: string } | null)?.provider ?? 'infobip');
    const activeProvider = getAllProviders().find(({ name }) => name === activeProviderName)?.provider;

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

    // ---------------------------------------------------------------------
    // 프로바이더별 전달률 집계 (최근 24시간 / 7일)
    //   - SmsLog.providerName 기준으로 상태별 건수 집계
    //   - null(레거시 로그)은 제외하고, 해당 윈도우 발송이 있는 프로바이더만 반환
    // ---------------------------------------------------------------------
    const providerWindows = [
      { key: '24h' as const, since: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      { key: '7d' as const, since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    ];

    type ProviderStatRow = {
      provider: string;
      sent: number;
      delivered: number;
      failed: number;
      pending: number;
      deliveryRate: number;
    };

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      providerRows24h,
      providerRows7d,
      unclassifiedTotal,
      unclassifiedLast24h,
      deliveryUnknownLast24h,
    ] = await Promise.all([
      prisma.smsLog.groupBy({
        by: ['providerName', 'status'],
        where: {
          createdAt: { gte: providerWindows[0].since },
          providerName: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.smsLog.groupBy({
        by: ['providerName', 'status'],
        where: {
          createdAt: { gte: providerWindows[1].since },
          providerName: { not: null },
        },
        _count: { _all: true },
      }),
      // 레거시(providerName IS NULL) 로그 — 전달률 집계에서 자동 제외되므로 UX 침묵 방지 차원에서 별도 노출
      prisma.smsLog.count({ where: { providerName: null } }),
      prisma.smsLog.count({
        where: { providerName: null, createdAt: { gte: since24h } },
      }),
      // TXG 폴링 한도 초과로 DELIVERY_UNKNOWN 처리된 로그 (최근 24h) — 전달 판정 불가 건수
      prisma.smsLog.count({
        where: {
          providerStatus: 'DELIVERY_UNKNOWN',
          createdAt: { gte: since24h },
        },
      }),
    ]);

    const aggregateProviderRows = (
      rows: Array<{ providerName: string | null; status: string; _count: { _all: number } }>,
    ): ProviderStatRow[] => {
      const byProvider = new Map<string, ProviderStatRow>();
      for (const row of rows) {
        const name = row.providerName;
        if (!name) continue;
        const current =
          byProvider.get(name) ??
          { provider: name, sent: 0, delivered: 0, failed: 0, pending: 0, deliveryRate: 0 };
        const count = row._count._all;
        // 발송 시도(sent): DELIVERED/FAILED/SENT/RETRY_PENDING 모두 포함
        // CANCELLED(환불)와 QUEUED 등은 집계 제외
        if (
          row.status === 'DELIVERED' ||
          row.status === 'FAILED' ||
          row.status === 'SENT' ||
          row.status === 'RETRY_PENDING'
        ) {
          current.sent += count;
        }
        if (row.status === 'DELIVERED') current.delivered += count;
        if (row.status === 'FAILED') current.failed += count;
        if (row.status === 'SENT' || row.status === 'RETRY_PENDING') current.pending += count;
        byProvider.set(name, current);
      }
      const result = Array.from(byProvider.values())
        .filter((row) => row.sent > 0)
        .map((row) => ({
          ...row,
          deliveryRate: row.sent > 0 ? row.delivered / row.sent : 0,
        }));
      // 정렬: 발송 시도 건수 내림차순
      result.sort((a, b) => b.sent - a.sent);
      return result;
    };

    const providerStats = {
      '24h': aggregateProviderRows(providerRows24h),
      '7d': aggregateProviderRows(providerRows7d),
      unclassified: {
        total: unclassifiedTotal,
        last24h: unclassifiedLast24h,
      },
      deliveryUnknown24h: deliveryUnknownLast24h,
    };

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
      activeCampaigns: activeCampaignRows.map((campaign) => ({
        id: campaign.id,
        userName: campaign.user.name ?? campaign.user.email ?? '-',
        messagePreview: campaign.messageBody.slice(0, 60),
        total: campaign.totalRecipients,
        sent: campaign.processedCount,
        failed: campaign.failedCount,
        status: campaign.status,
      })),
      activeCampaignCount: activeCampaignRows.length,
      system: {
        killSwitchLevel,
        killSwitch: isKillSwitchActive(killSwitchLevel),
        infobip: activeProviderName === 'infobip'
          ? (activeProvider?.isConfigured() ? 'connected' : 'misconfigured')
          : 'inactive',
        database: 'connected',
      },
      recentAlerts,
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
      },
      providerStats,
    });
  } catch (err) {
    return handleApiError(err, 'dashboard/stats');
  }
}
