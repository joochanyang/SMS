'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CreditCard } from 'lucide-react';
import DataTable, { Column } from '@/components/data-table';
import { formatCountWithKrw } from '@/lib/credit-units';

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
  user: {
    id: string;
    username: string;
    name: string | null;
    costPerMessage: number;
  };
}

const typeLabels: Record<string, string> = {
  ADMIN_ADD: '관리자 충전', ADMIN_DEDUCT: '관리자 차감', CORRECTION: '보정',
  BONUS: '보너스', SMS_COST: 'SMS 비용', DEPOSIT: '입금',
};

export default function CreditsPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
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

      const ledgerRes = await fetch(`/api/credits/ledger?${params}`);
      if (ledgerRes.status === 401) { router.push('/login'); return; }
      if (ledgerRes.ok) {
        const data = await ledgerRes.json();
        setEntries(data.entries ?? []);
        setTotalPages(Math.ceil((data.total ?? 0) / 30) || 1);
      }
    } catch (e) {
      console.error('[credits] 조회 실패', e);
    } finally {
      setLoading(false);
    }
  }, [page, userId, typeFilter, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: Column<LedgerRow>[] = [
    {
      key: 'user',
      label: '아이디',
      width: '160px',
      render: (row) => (
        <span style={{ fontWeight: 500 }}>{row.user?.username ?? row.userId.slice(0, 10)}</span>
      ),
    },
    { key: 'type', label: '유형', render: (row) => <span className={`badge ${row.amount >= 0 ? 'badge-active' : 'badge-suspended'}`}>{typeLabels[row.type] ?? row.type}</span> },
    {
      key: 'amount', label: '변동',
      render: (row) => (
        <span style={{ color: row.amount >= 0 ? 'var(--status-success)' : 'var(--status-danger)', fontWeight: 600 }}>
          {formatCountWithKrw(row.amount, row.user?.costPerMessage ?? 14, { signed: true })}
        </span>
      ),
    },
    {
      key: 'balanceAfter', label: '잔여',
      render: (row) => formatCountWithKrw(row.balanceAfter, row.user?.costPerMessage ?? 14),
    },
    { key: 'description', label: '설명' },
    { key: 'createdAt', label: '일시', render: (row) => new Date(row.createdAt).toLocaleString('ko-KR') },
  ];

  return (
    <>
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
    </>
  );
}
