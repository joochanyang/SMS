'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Users as UsersIcon } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import DataTable, { Column } from '@/components/data-table';

interface UserRow {
  id: string;
  email: string;
  name: string;
  credits: number;
  status: string;
  createdAt: string;
}

interface AdminInfo {
  name: string;
  email: string;
  role: string;
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
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [killSwitch, setKillSwitch] = useState(false);

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

      const [sessionRes, usersRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch(`/api/users?${params}`),
      ]);

      if (!sessionRes.ok) {
        router.push('/login');
        return;
      }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);
      setKillSwitch(sessionData.killSwitch ?? false);

      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users ?? []);
        setTotalPages(data.totalPages ?? 1);
      }
    } catch {
      router.push('/login');
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
      key: 'email',
      label: '이메일',
      sortable: true,
      render: (row) => <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{row.email}</span>,
    },
    { key: 'name', label: '이름', sortable: true },
    {
      key: 'credits',
      label: '크레딧',
      sortable: true,
      render: (row) => (
        <span style={{ fontWeight: 600 }}>
          {'\u20A9'}{row.credits.toLocaleString('ko-KR')}
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

  if (!admin) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh' }}>
        <span className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <Sidebar
        adminName={admin.name}
        adminEmail={admin.email}
        adminRole={admin.role}
        killSwitchActive={killSwitch}
      />
      <div className="admin-main">
        <Header title="사용자 관리" killSwitchActive={killSwitch} adminName={admin.name} />
        <main className="admin-content">
          {/* Filters */}
          <div className="filters-bar">
            <div className="filter-search">
              <Search size={16} className="search-icon" />
              <input
                placeholder="이메일 또는 이름 검색..."
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
        </main>
      </div>
    </div>
  );
}
