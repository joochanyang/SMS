'use client';

import { ArrowUp, ArrowDown, ArrowUpDown, Inbox } from 'lucide-react';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onSort?: (key: string) => void;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  loading?: boolean;
  emptyMessage?: string;
  emptySubMessage?: string;
  onRowClick?: (row: T) => void;
  keyExtractor?: (row: T) => string;
}

export default function DataTable<T extends object>({
  columns,
  data,
  onSort,
  sortBy,
  sortOrder,
  loading = false,
  emptyMessage = '데이터가 없습니다',
  emptySubMessage,
  onRowClick,
  keyExtractor,
}: DataTableProps<T>) {
  function renderSortIcon(col: Column<T>) {
    if (!col.sortable) return null;
    if (sortBy !== col.key) {
      return <ArrowUpDown size={14} className="sort-icon" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp size={14} className="sort-icon" />
    ) : (
      <ArrowDown size={14} className="sort-icon" />
    );
  }

  if (loading) {
    return (
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="table-skeleton-row">
                {columns.map((col) => (
                  <td key={col.key}>
                    <div
                      className="skeleton-bar"
                      style={{ width: `${60 + Math.random() * 40}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="table-empty">
        <div className="table-empty-icon">
          <Inbox size={40} />
        </div>
        <div className="table-empty-text">{emptyMessage}</div>
        {emptySubMessage && <div className="table-empty-sub">{emptySubMessage}</div>}
      </div>
    );
  }

  return (
    <div className="data-table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${col.sortable ? 'sortable' : ''} ${sortBy === col.key ? 'sorted' : ''}`}
                style={col.width ? { width: col.width } : undefined}
                onClick={() => col.sortable && onSort?.(col.key)}
              >
                {col.label}
                {renderSortIcon(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={keyExtractor ? keyExtractor(row) : idx}
              className={onRowClick ? 'clickable' : ''}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render
                    ? col.render(row, idx)
                    : String((row as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
