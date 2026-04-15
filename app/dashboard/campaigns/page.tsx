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

const campaignStatusStyle = (status: string) => {
  const base = {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: '0.375rem',
    padding: '0.15rem 0.5rem',
    borderRadius: '0px',
    fontSize: '0.7rem',
    fontWeight: 700,
  };
  switch (status) {
    case 'COMPLETED':
      return { ...base, backgroundColor: 'rgba(255, 255, 255, 0.1)', color: 'var(--text-main)', border: '1px solid var(--border)' };
    case 'SENDING':
      return { ...base, backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid transparent' };
    case 'QUEUED':
      return { ...base, backgroundColor: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', border: '1px solid transparent' };
    case 'FAILED':
      return { ...base, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid transparent' };
    case 'CANCELLED':
      return { ...base, backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid transparent' };
    default:
      return { ...base, backgroundColor: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', border: '1px solid transparent' };
  }
};

const statusIcon = (status: string) => {
  switch (status) {
    case 'COMPLETED': return <CheckCircle size={12} />;
    case 'SENDING': return <Loader size={12} />;
    case 'QUEUED': return <Clock size={12} />;
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
      estimatedCost: true,
      createdAt: true,
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>캠페인 관리</h2>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>총 {campaigns.length}개</span>
      </div>

      <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: '1px solid var(--border-strong)' }}>
          <thead style={{ backgroundColor: 'var(--border)' }}>
            <tr style={{ color: 'var(--text-main)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>이름</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>상태</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>수신자수</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>처리</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>전달</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>실패</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>생성일</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)', textAlign: 'right' }}>비용</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr
                key={campaign.id}
                className="table-row-hover"
                style={{ cursor: 'pointer' }}
              >
                <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)' }}>
                  <a
                    href={`/dashboard/campaign/${campaign.id}`}
                    style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', textDecoration: 'none' }}
                  >
                    {campaign.name || '이름 없는 캠페인'}
                  </a>
                </td>
                <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)' }}>
                  <div style={campaignStatusStyle(campaign.status)}>
                    {statusIcon(campaign.status)}
                    {statusLabel[campaign.status] || campaign.status}
                  </div>
                </td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}>{campaign.totalRecipients.toLocaleString()}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}>{campaign.processedCount.toLocaleString()}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: 'var(--primary)', border: '1px solid var(--border-strong)' }}>{campaign.deliveredCount.toLocaleString()}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: campaign.failedCount > 0 ? '#ef4444' : 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}>{campaign.failedCount.toLocaleString()}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}>{formatDateTime(campaign.createdAt)}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', fontWeight: 600, textAlign: 'right', border: '1px solid var(--border-strong)', color: 'var(--text-main)' }}>${campaign.estimatedCost.toFixed(2)}</td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  캠페인이 없습니다. 문자 발송 페이지에서 새 캠페인을 생성하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
