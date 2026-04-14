import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { ArrowLeft, Clock, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import UsdtDepositClient from './usdt-deposit-client';

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function getStatusConfig(status: string) {
  switch (status) {
    case 'CONFIRMED':
      return { label: '완료', color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)', icon: CheckCircle2 };
    case 'PENDING':
      return { label: '대기', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', icon: Clock };
    case 'SUBMITTED':
      return { label: '제출됨', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)', icon: Loader2 };
    case 'VERIFYING':
      return { label: '검증 중', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', icon: Loader2 };
    case 'FAILED':
      return { label: '실패', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', icon: XCircle };
    case 'EXPIRED':
      return { label: '만료', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.1)', icon: AlertTriangle };
    default:
      return { label: status, color: 'var(--text-secondary)', bg: 'var(--surface)', icon: Clock };
  }
}

export default async function UsdtDepositPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

  // 최근 USDT 입금 내역 조회
  const deposits = await prisma.usdtDeposit.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '720px', margin: '0 auto' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <a
          href="/dashboard/sms-send"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '40px', height: '40px', borderRadius: '50%',
            backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB',
            color: '#4B5563', transition: 'all 0.2s ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
        >
          <ArrowLeft size={18} />
        </a>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: 0, marginBottom: '0.25rem' }}>USDT 충전</h2>
          <p style={{ fontSize: '0.85rem', color: '#6B7280', margin: 0, fontWeight: 500 }}>USDT-TRC20 네트워크로 자동 충전</p>
        </div>
      </div>

      {/* 클라이언트 입금 컴포넌트 */}
      <UsdtDepositClient />

      {/* 최근 입금 내역 */}
      {deposits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>최근 USDT 입금 내역</h3>
          <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
            {deposits.map((d) => {
              const cfg = getStatusConfig(d.status);
              const StatusIcon = cfg.icon;
              return (
                <div key={d.id} style={{
                  padding: '1.25rem', borderBottom: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '10px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: cfg.bg, color: cfg.color,
                    }}>
                      <StatusIcon size={20} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                        {Number(d.usdtAmount)} USDT → ${Number(d.creditAmount).toFixed(2)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        ₩{Number(d.exchangeRate).toLocaleString()}/USDT • {formatDate(d.createdAt)}
                      </div>
                      {d.txid && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          TXID: {d.txid.slice(0, 12)}...{d.txid.slice(-8)}
                        </div>
                      )}
                      {d.failReason && (
                        <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '2px' }}>
                          {d.failReason}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                      padding: '0.25rem 0.75rem', borderRadius: '20px',
                      fontSize: '0.7rem', fontWeight: 600,
                      backgroundColor: cfg.bg, color: cfg.color,
                    }}>
                      {cfg.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
