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
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>수신번호</th>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>메시지</th>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>상태</th>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>통신사/네트워크</th>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>재시도</th>
              <th style={{ padding: '1.25rem', fontWeight: 600 }}>발송시간</th>
              <th style={{ padding: '1.25rem', fontWeight: 600, textAlign: 'right' }}>비용</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '1.25rem', fontSize: '0.875rem', fontWeight: 500 }}>{log.targetNumber}</td>
                <td style={{ padding: '1.25rem', fontSize: '0.875rem', color: 'var(--text-secondary)', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.messageBody}
                </td>
                <td style={{ padding: '1.25rem' }}>
                  <div style={{ 
                    display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
                    backgroundColor:
                      log.status === 'DELIVERED'
                        ? 'rgba(16, 185, 129, 0.1)'
                        : log.status === 'PENDING' || log.status === 'RETRY_PENDING' || log.status === 'SENT'
                          ? 'rgba(245, 158, 11, 0.1)'
                          : 'rgba(239, 68, 68, 0.1)',
                    color:
                      log.status === 'DELIVERED'
                        ? 'var(--primary)'
                        : log.status === 'PENDING' || log.status === 'RETRY_PENDING' || log.status === 'SENT'
                          ? '#f59e0b'
                          : '#ef4444'
                  }}>
                    {log.status === 'DELIVERED' ? <CheckCircle size={12} /> : log.status === 'FAILED' ? <XCircle size={12} /> : <Clock size={12} />}
                    {log.status}
                  </div>
                </td>
                <td style={{ padding: '1.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{log.networkName || log.providerStatus || '-'}</td>
                <td style={{ padding: '1.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{log.retryCount}</td>
                <td style={{ padding: '1.25rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{formatDateTime(log.createdAt)}</td>
                <td style={{ padding: '1.25rem', fontSize: '0.875rem', fontWeight: 600, textAlign: 'right' }}>${log.cost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          <span>총 {logs.length}건</span>
          <span>실시간 DLR 기반 상태 업데이트</span>
        </div>
      </div>
    </div>
  );
}
