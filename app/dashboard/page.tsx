import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { DailyChart, StatusPieChart } from './_components/dashboard-charts';

type DailyStat = {
  date: string;
  sent: number;
  delivered: number;
  failed: number;
};

type StatusItem = {
  name: string;
  value: number;
  color: string;
};

type RecentCampaign = {
  id: string;
  name: string | null;
  status: string;
  statusLabel: string;
  totalRecipients: number;
  deliveredCount: number;
  failedCount: number;
  createdAtFormatted: string;
};

async function getDashboardData(userId: string) {
  const [user, campaignCount, statusCounts, recentCampaigns, dailyLogs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    }),
    prisma.smsCampaign.count({
      where: { userId },
    }),
    prisma.smsLog.groupBy({
      by: ['status'],
      where: { userId },
      _count: { id: true },
      _sum: { cost: true },
    }),
    prisma.smsCampaign.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        totalRecipients: true,
        deliveredCount: true,
        failedCount: true,
        createdAt: true,
      },
    }),
    prisma.smsLog.findMany({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: { status: true, createdAt: true },
    }),
  ]);

  // overview
  const statusMap: Record<string, number> = {};
  let totalSpent = 0;
  for (const s of statusCounts) {
    statusMap[s.status] = s._count.id;
    totalSpent += Number(s._sum.cost ?? 0);
  }

  const totalSent = Object.values(statusMap).reduce((a, b) => a + b, 0);

  const overview = {
    totalCampaigns: campaignCount,
    totalSent,
    totalDelivered: statusMap['DELIVERED'] ?? 0,
    totalFailed: statusMap['FAILED'] ?? 0,
    creditBalance: user?.credits ?? 0,
    totalSpent: Math.round(totalSpent * 100) / 100,
  };

  // dailyStats
  const dailyMap: Record<string, { sent: number; delivered: number; failed: number }> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    dailyMap[key] = { sent: 0, delivered: 0, failed: 0 };
  }
  for (const log of dailyLogs) {
    const d = new Date(log.createdAt);
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    if (dailyMap[key]) {
      dailyMap[key].sent++;
      if (log.status === 'DELIVERED') dailyMap[key].delivered++;
      if (log.status === 'FAILED') dailyMap[key].failed++;
    }
  }
  const dailyStats: DailyStat[] = Object.entries(dailyMap).map(([date, counts]) => ({
    date,
    ...counts,
  }));

  // statusBreakdown
  const statusLabels: Record<string, { name: string; color: string }> = {
    DELIVERED: { name: '전달 완료', color: '#10b981' },
    SENT: { name: '발송 완료', color: '#3b82f6' },
    FAILED: { name: '실패', color: '#ef4444' },
    PENDING: { name: '대기 중', color: '#f59e0b' },
    RETRY_PENDING: { name: '재시도 대기', color: '#8b5cf6' },
  };

  const statusBreakdown: StatusItem[] = Object.entries(statusMap)
    .map(([status, value]) => ({
      name: statusLabels[status]?.name ?? status,
      value,
      color: statusLabels[status]?.color ?? '#6b7280',
    }))
    .filter((s) => s.value > 0);

  // recentCampaigns
  const campaignStatusLabels: Record<string, string> = {
    DRAFT: '초안',
    QUEUED: '대기 중',
    SENDING: '발송 중',
    COMPLETED: '완료',
    CANCELLED: '취소됨',
    FAILED: '실패',
  };

  const recentCampaignsFormatted: RecentCampaign[] = recentCampaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    statusLabel: campaignStatusLabels[c.status] ?? c.status,
    totalRecipients: c.totalRecipients,
    deliveredCount: c.deliveredCount,
    failedCount: c.failedCount,
    createdAtFormatted: new Date(c.createdAt).toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  }));

  return { overview, dailyStats, statusBreakdown, recentCampaigns: recentCampaignsFormatted };
}

const statusColors: Record<string, string> = {
  완료: '#10b981',
  '발송 중': '#3b82f6',
  '대기 중': '#f59e0b',
  초안: '#6b7280',
  '취소됨': '#94a3b8',
  실패: '#ef4444',
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const { overview, dailyStats, statusBreakdown, recentCampaigns } = await getDashboardData(
    session.user.id
  );

  const cards = [
    { label: '총 캠페인', value: overview.totalCampaigns.toLocaleString(), accent: '#3b82f6' },
    { label: '총 발송', value: overview.totalSent.toLocaleString(), accent: '#8b5cf6' },
    { label: '전달 완료', value: overview.totalDelivered.toLocaleString(), accent: '#10b981' },
    {
      label: '크레딧 잔액',
      value: `$${overview.creditBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      accent: '#f59e0b',
    },
  ];

  return (
    <div>
      {/* 오버뷰 카드 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        {cards.map((card) => (
          <div
            key={card.label}
            style={{
              backgroundColor: 'rgba(15, 23, 42, 0.4)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '1.5rem',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '3px',
                background: `linear-gradient(90deg, ${card.accent}, transparent)`,
              }}
            />
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                marginBottom: '0.5rem',
                fontWeight: 500,
              }}
            >
              {card.label}
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* 일별 발송 추이 차트 */}
      <DailyChart data={dailyStats} />

      {/* 하단: 상태별 분포 + 최근 캠페인 */}
      <div style={{ display: 'flex', gap: '1.5rem' }}>
        {/* 파이 차트 */}
        <StatusPieChart data={statusBreakdown} />

        {/* 최근 캠페인 리스트 */}
        <div
          style={{
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '1.5rem',
            flex: 1.5,
            minWidth: 0,
          }}
        >
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>최근 캠페인</h3>
          {recentCampaigns.length === 0 ? (
            <div
              style={{
                height: '240px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
              }}
            >
              아직 캠페인이 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {recentCampaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {campaign.name || '이름 없음'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.125rem' }}>
                      {campaign.createdAtFormatted} · 수신자 {campaign.totalRecipients}명
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      <span style={{ color: '#10b981' }}>{campaign.deliveredCount}</span>
                      {' / '}
                      <span style={{ color: '#ef4444' }}>{campaign.failedCount}</span>
                    </div>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        padding: '0.25rem 0.5rem',
                        borderRadius: '9999px',
                        backgroundColor: `${statusColors[campaign.statusLabel] ?? '#6b7280'}20`,
                        color: statusColors[campaign.statusLabel] ?? '#6b7280',
                      }}
                    >
                      {campaign.statusLabel}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
