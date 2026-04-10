'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CreditCard } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import DataTable, { Column } from '@/components/data-table';

interface AdminInfo { name: string; email: string; role: string }

interface LedgerRow {
  id: string;
  userId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  referenceType: string | null;
  description: string;
  adminId: string | null;
  createdAt: string;
}

const typeLabels: Record<string, string> = {
  ADMIN_ADD: '관리자 충전', ADMIN_DEDUCT: '관리자 차감', CORRECTION: '보정',
  BONUS: '보너스', REFUND: '환불', SMS_COST: 'SMS 비용', DEPOSIT: '입금',
};

export default function CreditsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [entries, setEntries] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [userId, setUserId] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '30',
        ...(userId && { userId }),
        ...(typeFilter !== 'ALL' && { type: typeFilter }),
      });

      const [sessionRes, ledgerRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch(`/api/credits/ledger?${params}`),
      ]);

      if (!sessionRes.ok) { router.push('/login'); return; }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);
      setKillSwitch(sessionData.killSwitch ?? false);

      if (ledgerRes.ok) {
        const data = await ledgerRes.json();
        setEntries(data.entries ?? []);
        setTotalPages(Math.ceil((data.total ?? 0) / 30) || 1);
      }
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [page, userId, typeFilter, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: Column<LedgerRow>[] = [
    { key: 'userId', label: '유저 ID', width: '120px', render: (row) => <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{row.userId.slice(0, 10)}...</span> },
    { key: 'type', label: '유형', render: (row) => <span className={`badge ${row.amount >= 0 ? 'badge-active' : 'badge-suspended'}`}>{typeLabels[row.type] ?? row.type}</span> },
    {
      key: 'amount', label: '금액',
      render: (row) => (
        <span style={{ color: row.amount >= 0 ? 'var(--status-success)' : 'var(--status-danger)', fontWeight: 600 }}>
          {row.amount >= 0 ? '+' : ''}{'\u20A9'}{row.amount.toLocaleString('ko-KR')}
        </span>
      ),
    },
    { key: 'balanceAfter', label: '잔액', render: (row) => `\u20A9${row.balanceAfter.toLocaleString('ko-KR')}` },
    { key: 'description', label: '설명' },
    { key: 'createdAt', label: '일시', render: (row) => new Date(row.createdAt).toLocaleString('ko-KR') },
  ];

  if (!admin) {
    return <div className="loading-center" style={{ minHeight: '100vh' }}><span className="spinner spinner-lg" /></div>;
  }

  return (
    <div className="admin-layout">
      <Sidebar adminName={admin.name} adminEmail={admin.email} adminRole={admin.role} killSwitchActive={killSwitch} />
      <div className="admin-main">
        <Header title="크레딧 원장" killSwitchActive={killSwitch} adminName={admin.name} />
        <main className="admin-content">
          <div className="filters-bar">
            <div className="filter-search">
              <Search size={16} className="search-icon" />
              <input placeholder="유저 ID..." value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} />
            </div>
            <select className="filter-select" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
              <option value="ALL">전체 유형</option>
              <option value="ADMIN_ADD">관리자 충전</option>
              <option value="ADMIN_DEDUCT">관리자 차감</option>
              <option value="SMS_COST">SMS 비용</option>
              <option value="REFUND">환불</option>
              <option value="DEPOSIT">입금</option>
              <option value="BONUS">보너스</option>
              <option value="CORRECTION">보정</option>
            </select>
          </div>

          <div className="data-table-wrapper">
            <div className="data-table-header">
              <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CreditCard size={16} /> 크레딧 원장
              </h3>
            </div>
            <DataTable columns={columns} data={entries} loading={loading} keyExtractor={(row) => row.id} emptyMessage="크레딧 내역이 없습니다" />
            <div className="data-table-footer">
              <span>페이지 {page} / {totalPages}</span>
              <div className="pagination">
                <button className="pagination-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
                <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>다음</button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
