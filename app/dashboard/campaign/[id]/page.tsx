import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { CheckCircle, ArrowLeft, Users, Send, AlertTriangle } from 'lucide-react';
import LogTable from './_components/log-table';
import MessageSectionClient from './_components/message-section';

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const campaignStatusStyle = (status: string) => {
  const base = {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: '0.375rem',
    padding: '0.375rem 1rem',
    borderRadius: '999px',
    fontSize: '0.875rem',
    fontWeight: 600,
  };
  switch (status) {
    case 'COMPLETED':
      return { ...base, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--primary)' };
    case 'SENDING':
      return { ...base, backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' };
    case 'QUEUED':
      return { ...base, backgroundColor: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8' };
    case 'FAILED':
      return { ...base, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' };
    case 'CANCELLED':
      return { ...base, backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' };
    default:
      return { ...base, backgroundColor: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8' };
  }
};

const statusLabel: Record<string, string> = {
  DRAFT: '임시저장',
  QUEUED: '대기 중',
  SCHEDULED: '예약됨',
  SENDING: '발송 중',
  COMPLETED: '완료',
  CANCELLED: '취소됨',
  FAILED: '실패',
};

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;

  const campaign = await prisma.smsCampaign.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      name: true,
      messageBody: true,
      status: true,
      totalRecipients: true,
      processedCount: true,
      deliveredCount: true,
      failedCount: true,
      estimatedCost: true,
      costPerMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!campaign || campaign.userId !== session.user.id) {
    redirect('/dashboard/campaigns');
  }

  const logs = await prisma.smsLog.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      targetNumber: true,
      status: true,
      providerStatus: true,
      networkName: true,
      retryCount: true,
      cost: true,
      createdAt: true,
    },
  });

  const summary = { pending: 0, sent: 0, delivered: 0, failed: 0, retryPending: 0 };
  for (const log of logs) {
    switch (log.status) {
      case 'PENDING': summary.pending++; break;
      case 'SENT': summary.sent++; break;
      case 'DELIVERED': summary.delivered++; break;
      case 'FAILED': summary.failed++; break;
      case 'RETRY_PENDING': summary.retryPending++; break;
    }
  }

  // JSON 직렬화를 위해 Date → ISO string 변환
  const serializedLogs = logs.map((log) => ({
    ...log,
    cost: Number(log.cost),
    createdAt: log.createdAt.toISOString(),
  }));

  const statCards = [
    { label: '총 수신자', value: campaign.totalRecipients, icon: <Users size={20} color="var(--primary)" /> },
    { label: '처리 완료', value: campaign.processedCount, icon: <Send size={20} color="#3b82f6" /> },
    { label: '전달 완료', value: campaign.deliveredCount, icon: <CheckCircle size={20} color="var(--primary)" /> },
    { label: '실패', value: campaign.failedCount, icon: <AlertTriangle size={20} color="#ef4444" /> },
  ];

  // 진행률 계산
  const progressPercent = campaign.totalRecipients > 0
    ? Math.min(100, Math.round((campaign.processedCount / campaign.totalRecipients) * 100))
    : 0;
  const showProgress = ['SENDING', 'QUEUED'].includes(campaign.status);

  const progressColor =
    campaign.status === 'SENDING' ? '#3b82f6'
    : campaign.status === 'COMPLETED' ? '#10b981'
    : campaign.status === 'FAILED' ? '#ef4444'
    : '#3b82f6';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <a href="/dashboard/campaigns" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textDecoration: 'none' }}>
            <ArrowLeft size={16} />
            뒤로
          </a>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
            {campaign.name || '이름 없는 캠페인'}
          </h2>
          <div style={campaignStatusStyle(campaign.status)}>
            {statusLabel[campaign.status] || campaign.status}
          </div>
        </div>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          생성일: {formatDateTime(campaign.createdAt)}
        </span>
      </div>

      {/* 진행률 프로그레스 바 */}
      {showProgress && (
        <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              {campaign.status === 'SENDING' ? '발송 진행 중...' : '발송 대기 중...'}
            </span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              {campaign.processedCount.toLocaleString()} / {campaign.totalRecipients.toLocaleString()} ({progressPercent}%)
            </span>
          </div>
          <div style={{
            width: '100%',
            height: '8px',
            backgroundColor: 'rgba(148, 163, 184, 0.1)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progressPercent}%`,
              height: '100%',
              backgroundColor: progressColor,
              borderRadius: '4px',
              transition: 'width 0.5s ease',
              boxShadow: `0 0 8px ${progressColor}40`,
            }} />
          </div>
        </div>
      )}

      {/* 통계 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
        {statCards.map((card) => (
          <div key={card.label} className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{card.label}</span>
              {card.icon}
            </div>
            <span style={{ fontSize: '2rem', fontWeight: 700 }}>{card.value.toLocaleString()}</span>
          </div>
        ))}
      </div>

      {/* 비용 정보 + 메시지 전문 보기 */}
      <MessageSectionClient
        estimatedCost={Number(campaign.estimatedCost)}
        costPerMessage={Number(campaign.costPerMessage)}
        messageBody={campaign.messageBody}
      />

      {/* 발송 로그 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>발송 로그</h3>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>최근 500건 표시</span>
      </div>

      {/* 클라이언트 컴포넌트: 필터링 + 재발송 + 테이블 */}
      <LogTable
        logs={serializedLogs}
        summary={summary}
        campaignId={campaign.id}
        campaignStatus={campaign.status}
      />
    </div>
  );
}
