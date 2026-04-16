import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { CheckCircle, Clock, XCircle, Loader, Ban } from 'lucide-react';

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const statusColor = (status: string): { bg: string; color: string; border: string } => {
  switch (status) {
    case 'COMPLETED':
      return { bg: 'rgba(16, 185, 129, 0.1)', color: '#10B981', border: 'rgba(16, 185, 129, 0.3)' };
    case 'SENDING':
      return { bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' };
    case 'QUEUED':
    case 'SCHEDULED':
      return { bg: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', border: 'rgba(148, 163, 184, 0.3)' };
    case 'FAILED':
      return { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' };
    case 'CANCELLED':
      return { bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' };
    default:
      return { bg: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', border: 'rgba(148, 163, 184, 0.3)' };
  }
};

const statusIcon = (status: string) => {
  switch (status) {
    case 'COMPLETED': return <CheckCircle size={12} />;
    case 'SENDING': return <Loader size={12} />;
    case 'QUEUED':
    case 'SCHEDULED': return <Clock size={12} />;
    case 'FAILED': return <XCircle size={12} />;
    case 'CANCELLED': return <Ban size={12} />;
    default: return <Clock size={12} />;
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

export default async function CampaignsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

  const campaigns = await prisma.smsCampaign.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      name: true,
      status: true,
      totalRecipients: true,
      processedCount: true,
      deliveredCount: true,
      failedCount: true,
      messageBody: true,
      createdAt: true,
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>발송내역 관리</h2>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>총 {campaigns.length}개</span>
      </div>

      {campaigns.length === 0 ? (
        <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          캠페인이 없습니다. 문자 발송 페이지에서 새 캠페인을 생성하세요.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {campaigns.map((campaign) => {
            const c = statusColor(campaign.status);
            return (
              <a
                key={campaign.id}
                href={`/dashboard/campaign/${campaign.id}`}
                style={{
                  textDecoration: 'none',
                  backgroundColor: 'var(--card-bg, #FFFFFF)',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  minHeight: '180px',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.2rem 0.55rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, backgroundColor: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                    {statusIcon(campaign.status)}
                    {statusLabel[campaign.status] || campaign.status}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatDateTime(campaign.createdAt)}</span>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.7rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                  <span>수신자 <strong style={{ color: 'var(--text-main)' }}>{campaign.totalRecipients.toLocaleString()}</strong></span>
                  <span>처리 <strong style={{ color: 'var(--text-main)' }}>{campaign.processedCount.toLocaleString()}</strong></span>
                  <span>전달 <strong style={{ color: 'var(--primary)' }}>{campaign.deliveredCount.toLocaleString()}</strong></span>
                  <span>실패 <strong style={{ color: campaign.failedCount > 0 ? '#ef4444' : 'var(--text-main)' }}>{campaign.failedCount.toLocaleString()}</strong></span>
                </div>

                <div style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-main)',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-line',
                  wordBreak: 'break-word',
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: 'rgba(0,0,0,0.02)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                }}>
                  {campaign.messageBody || campaign.name || '(내용 없음)'}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
