'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Users as UsersIcon } from 'lucide-react';
import DataTable, { Column } from '@/components/data-table';
import { formatCountWithKrw } from '@/lib/credit-units';

interface UserRow {
  id: string;
  username: string;
  telegramId: string | null;
  name: string;
  credits: number;
  costPerMessage: number;
  status: string;
  createdAt: string;
}

const statusMap: Record<string, string> = {
  ACTIVE: '활성',
  SUSPENDED: '정지',
  BANNED: '차단',
};

const badgeClassMap: Record<string, string> = {
  ACTIVE: 'badge-active',
  SUSPENDED: 'badge-suspended',
  BANNED: 'badge-banned',
};

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy,
        sortOrder,
        ...(search && { search }),
        ...(statusFilter !== 'ALL' && { status: statusFilter }),
      });

      const usersRes = await fetch(`/api/users?${params}`);

      if (usersRes.status === 401) {
        router.push('/login');
        return;
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users ?? []);
        setTotalPages(data.totalPages ?? (Math.ceil((data.total ?? 0) / 20) || 1));
      }
    } catch (e) {
      console.error('[users] 조회 실패', e);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder, search, statusFilter, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleSort(key: string) {
    if (sortBy === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortOrder('asc');
    }
    setPage(1);
  }

  const columns: Column<UserRow>[] = [
    {
      key: 'username',
      label: '아이디',
      sortable: true,
      render: (row) => <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{row.username}</span>,
    },
    {
      key: 'telegramId',
      label: '텔레그램',
      render: (row) => (
        <span style={{ color: row.telegramId ? 'var(--text-main)' : 'var(--text-muted)' }}>
          {row.telegramId ?? '—'}
        </span>
      ),
    },
    { key: 'name', label: '이름', sortable: true },
    {
      key: 'credits',
      label: '남은 건수',
      sortable: true,
      render: (row) => (
        <span style={{ fontWeight: 600 }}>
          {formatCountWithKrw(row.credits, row.costPerMessage ?? 14)}
        </span>
      ),
    },
    {
      key: 'costPerMessage',
      label: '건당 단가',
      sortable: false,
      render: (row) => (
        <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
          {'₩'}{Number(row.costPerMessage ?? 14).toLocaleString('ko-KR')}
        </span>
      ),
    },
    {
      key: 'status',
      label: '상태',
      sortable: true,
      render: (row) => (
        <span className={`badge ${badgeClassMap[row.status] ?? 'badge-muted'}`}>
          <span className="badge-dot" />
          {statusMap[row.status] ?? row.status}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: '가입일',
      sortable: true,
      render: (row) => new Date(row.createdAt).toLocaleDateString('ko-KR'),
    },
  ];

  return (
    <>
          {/* Filters */}
          <div className="filters-bar">
            <div className="filter-search">
              <Search size={16} className="search-icon" />
              <input
                placeholder="아이디 · 이름 · 텔레그램 검색..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">전체 상태</option>
              <option value="ACTIVE">활성</option>
              <option value="SUSPENDED">정지</option>
              <option value="BANNED">차단</option>
            </select>
          </div>

          {/* Table */}
          <div className="data-table-wrapper">
            <div className="data-table-header">
              <h3 className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UsersIcon size={16} />
                사용자 목록
              </h3>
            </div>
            <DataTable
              columns={columns}
              data={users}
              loading={loading}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
              onRowClick={(row) => router.push(`/users/${row.id}`)}
              keyExtractor={(row) => row.id}
              emptyMessage="사용자가 없습니다"
              emptySubMessage="조건에 맞는 사용자가 없습니다"
            />
            <div className="data-table-footer">
              <span>
                페이지 {page} / {totalPages}
              </span>
              <div className="pagination">
                <button
                  className="pagination-btn"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  이전
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const p = i + 1;
                  return (
                    <button
                      key={p}
                      className={`pagination-btn ${page === p ? 'active' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  className="pagination-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  다음
                </button>
              </div>
            </div>
          </div>
    </>
  );
}
