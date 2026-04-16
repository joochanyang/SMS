'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Send, BookUser } from 'lucide-react';

type AddressBook = {
  id: string;
  name: string;
  contactCount: number;
  createdAt: string;
};

export default function AddressBookListPage() {
  const router = useRouter();
  const [books, setBooks] = useState<AddressBook[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchBooks = () => {
    setFetchError(null);
    fetch('/api/address-book')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => { if (data?.addressBooks) setBooks(data.addressBooks); })
      .catch(() => { setFetchError('주소록을 불러오는 중 오류가 발생했습니다.'); });
  };

  useEffect(() => { fetchBooks(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch('/api/address-book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      setNewName('');
      fetchBooks();
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 주소록을 삭제하시겠습니까? 포함된 연락처도 모두 삭제됩니다.')) return;
    const res = await fetch(`/api/address-book/${id}`, { method: 'DELETE' });
    if (res.ok) setBooks((prev) => prev.filter((b) => b.id !== id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>주소록 관리</h2>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>총 {books.length}개</span>
      </div>

      {fetchError && (
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.875rem' }}>
          {fetchError}
        </div>
      )}

      {/* 주소록 추가 */}
      <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="새 주소록 이름을 입력하세요"
          style={{
            flex: 1, padding: '0.75rem 1rem', borderRadius: '8px',
            border: '1px solid var(--border)', backgroundColor: 'var(--surface)',
            color: 'var(--text-main)', fontSize: '0.9rem', outline: 'none',
          }}
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          style={{
            padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none',
            backgroundColor: '#4F46E5', color: '#FFFFFF', fontWeight: 600,
            fontSize: '0.9rem', cursor: creating ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap',
          }}
        >
          <Plus size={16} /> 추가
        </button>
      </div>

      {/* 주소록 목록 */}
      {books.length === 0 ? (
        <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <BookUser size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
          <p>주소록이 없습니다. 위에서 새 주소록을 추가하세요.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {books.map((book) => (
            <div
              key={book.id}
              className="glass-card"
              style={{
                padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem',
                cursor: 'pointer', transition: 'border-color 0.2s',
              }}
              onClick={() => router.push(`/dashboard/address-book/${book.id}`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>{book.name}</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    연락처 {book.contactCount}명 · {new Date(book.createdAt).toLocaleDateString('ko-KR')}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/dashboard/sms-send?addressBookId=${book.id}`);
                  }}
                  style={{
                    flex: 1, padding: '0.6rem', borderRadius: '6px', border: 'none',
                    backgroundColor: '#4F46E5', color: '#FFFFFF', fontWeight: 600,
                    fontSize: '0.8rem', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                  }}
                >
                  <Send size={14} /> 발송하기
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(book.id); }}
                  style={{
                    padding: '0.6rem 0.75rem', borderRadius: '6px',
                    border: '1px solid var(--border)', backgroundColor: 'transparent',
                    color: '#EF4444', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
