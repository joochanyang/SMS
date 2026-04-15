import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { CheckCircle, Clock, XCircle } from 'lucide-react';

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const statusLabel: Record<string, string> = {
  PENDING: '대기',
  SENDING: '발송중',
  SENT: '발송완료',
  DELIVERED: '전달완료',
  FAILED: '실패',
  RETRY_PENDING: '재시도대기',
  REJECTED: '거부',
  EXPIRED: '만료',
  CANCELLED: '취소',
};

export default async function HistoryPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

  const logs = await prisma.smsLog.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      targetNumber: true,
      messageBody: true,
      status: true,
      cost: true,
      providerStatus: true,
      networkName: true,
      retryCount: true,
      createdAt: true,
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>발송 내역</h2>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>최근 200건 표시</span>
      </div>

      <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: '1px solid var(--border-strong)' }}>
          <thead style={{ backgroundColor: 'var(--border)' }}>
            <tr style={{ color: 'var(--text-main)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>수신번호</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>메시지</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)', width: '120px' }}>상태</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>통신사/네트워크</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)', textAlign: 'center' }}>재시도</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)' }}>발송시간</th>
              <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, border: '1px solid var(--border-strong)', textAlign: 'right' }}>비용</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="table-row-hover">
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', fontWeight: 500, border: '1px solid var(--border-strong)', color: 'var(--text-main)' }}>{log.targetNumber}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid var(--border-strong)' }}>
                  {log.messageBody}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)' }}>
                  <div style={{ 
                    display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.15rem 0.5rem', borderRadius: '0px', fontSize: '0.7rem', fontWeight: 700,
                    backgroundColor:
                      log.status === 'DELIVERED'
                        ? '#F4F4F5'
                        : log.status === 'PENDING' || log.status === 'RETRY_PENDING' || log.status === 'SENT'
                          ? 'rgba(245, 158, 11, 0.1)'
                          : 'rgba(239, 68, 68, 0.1)',
                    color:
                      log.status === 'DELIVERED'
                        ? 'var(--text-main)'
                        : log.status === 'PENDING' || log.status === 'RETRY_PENDING' || log.status === 'SENT'
                          ? '#f59e0b'
                          : '#ef4444',
                    border: log.status === 'DELIVERED' ? '1px solid var(--border)' : '1px solid transparent'
                  }}>
                    {log.status === 'DELIVERED' ? <CheckCircle size={10} /> : log.status === 'FAILED' ? <XCircle size={10} /> : <Clock size={10} />}
                    {statusLabel[log.status] || log.status}
                  </div>
                </td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}>{log.networkName || log.providerStatus || '-'}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', textAlign: 'center' }}>{log.retryCount}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}>{formatDateTime(log.createdAt)}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 600, textAlign: 'right', border: '1px solid var(--border-strong)', color: 'var(--text-main)' }}>${Number(log.cost).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {logs.length === 0 && (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            아직 발송 내역이 없습니다.
          </div>
        )}

        <div style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          <span>총 {logs.length}건</span>
          <span>실시간 DLR 기반 상태 업데이트</span>
        </div>
      </div>
    </div>
  );
}
