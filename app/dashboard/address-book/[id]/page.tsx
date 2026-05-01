'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Send, Upload, Pencil, Check, X, Download } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

type Contact = {
  id: string;
  name: string | null;
  nickname: string | null;
  phone: string;
};

export default function AddressBookDetailPage() {
  const router = useRouter();
  const params = useParams();
  const bookId = params.id as string;

  const [bookName, setBookName] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  // 연락처 추가 폼
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newNickname, setNewNickname] = useState('');

  // 인라인 수정
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editName, setEditName] = useState('');
  const [editNickname, setEditNickname] = useState('');

  // 선택 삭제
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fileRef = useRef<HTMLInputElement>(null);

  const fetchBook = async () => {
    const res = await fetch(`/api/address-book/${bookId}`);
    if (!res.ok) { router.push('/dashboard/address-book'); return; }
    const data = await res.json();
    setBookName(data.name);
    setContacts(data.contacts);
    setLoading(false);
  };

  useEffect(() => { fetchBook(); }, [bookId]);

  const handleAddContact = async () => {
    if (!newPhone.trim()) return;
    const res = await fetch(`/api/address-book/${bookId}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: newPhone.trim(), name: newName.trim() || null, nickname: newNickname.trim() || null }),
    });
    if (res.ok) {
      setNewPhone(''); setNewName(''); setNewNickname('');
      fetchBook();
    }
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}개 연락처를 삭제하시겠습니까?`)) return;
    const res = await fetch(`/api/address-book/${bookId}/contacts`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: [...selected] }),
    });
    if (res.ok) { setSelected(new Set()); fetchBook(); }
  };

  const submitImportedContacts = async (
    rows: Record<string, string | number | undefined>[],
  ) => {
    const toStr = (v: string | number | undefined) =>
      v == null ? '' : typeof v === 'string' ? v : String(v);
    const mapped = rows
      .map((r) => ({
        phone: toStr(r['번호'] ?? r['phone'] ?? r['연락처']).trim(),
        name: toStr(r['이름'] ?? r['name']).trim(),
        nickname: toStr(r['별명'] ?? r['nickname'] ?? r['별칭']).trim(),
      }))
      .filter((c) => c.phone);

    if (mapped.length === 0) { alert('유효한 연락처가 없습니다. 헤더(이름/별명/번호)를 확인하세요.'); return; }

    const res = await fetch(`/api/address-book/${bookId}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: mapped }),
    });
    if (res.ok) {
      const data = await res.json();
      alert(`${data.imported}명이 추가되었습니다.`);
      fetchBook();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || '연락처 추가에 실패했습니다.');
    }
  };

  const handleCsvImport = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        submitImportedContacts(result.data as Record<string, string>[]);
      },
      error: () => alert('CSV 파싱에 실패했습니다. 파일 형식을 확인하세요.'),
    });
  };

  const handleExcelImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) { alert('엑셀 시트를 찾을 수 없습니다.'); return; }
        const rows = XLSX.utils.sheet_to_json<Record<string, string | number | undefined>>(
          sheet,
          { defval: '', raw: false },
        );
        submitImportedContacts(rows);
      } catch {
        alert('엑셀 파싱에 실패했습니다. 파일 형식을 확인하세요.');
      }
    };
    reader.onerror = () => alert('파일을 읽지 못했습니다.');
    reader.readAsArrayBuffer(file);
  };

  const handleFileImport = (file: File) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      handleExcelImport(file);
    } else {
      handleCsvImport(file);
    }
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['이름', '별명', '번호'],
      ['홍길동', '길동이', '+821012345678'],
      ['김철수', '철수', '+821098765432'],
    ]);
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '주소록');
    XLSX.writeFile(wb, '주소록_양식.xlsx');
  };

  const startEdit = (c: Contact) => {
    setEditingId(c.id);
    setEditPhone(c.phone);
    setEditName(c.name || '');
    setEditNickname(c.nickname || '');
  };

  const saveEdit = async () => {
    if (!editingId || !editPhone.trim()) return;
    await fetch(`/api/address-book/${bookId}/contacts/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: editPhone.trim(), name: editName.trim() || null, nickname: editNickname.trim() || null }),
    });
    setEditingId(null);
    fetchBook();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c) => c.id)));
  };

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>로딩 중...</div>;

  const inputStyle = {
    padding: '0.5rem 0.75rem', borderRadius: '6px',
    border: '1px solid var(--border)', backgroundColor: 'var(--surface)',
    color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          onClick={() => router.push('/dashboard/address-book')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
        >
          <ArrowLeft size={20} />
        </button>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, flex: 1 }}>{bookName}</h2>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{contacts.length}명</span>
        <button
          onClick={() => router.push(`/dashboard/sms-send?addressBookId=${bookId}`)}
          style={{
            padding: '0.6rem 1.25rem', borderRadius: '8px', border: 'none',
            backgroundColor: '#4F46E5', color: '#FFFFFF', fontWeight: 600,
            fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}
        >
          <Send size={14} /> 이 주소록으로 발송
        </button>
      </div>

      {/* 연락처 추가 + 엑셀/CSV */}
      <div className="glass-card" style={{ padding: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="이름" style={{ ...inputStyle, width: '120px' }} />
        <input value={newNickname} onChange={(e) => setNewNickname(e.target.value)} placeholder="별명" style={{ ...inputStyle, width: '120px' }} />
        <input
          value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddContact()}
          placeholder="번호 (필수)" style={{ ...inputStyle, flex: 1, minWidth: '160px' }}
        />
        <button
          onClick={handleAddContact}
          disabled={!newPhone.trim()}
          style={{
            padding: '0.5rem 1rem', borderRadius: '6px', border: 'none',
            backgroundColor: '#4F46E5', color: '#FFFFFF', fontWeight: 600,
            fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
          }}
        >
          <Plus size={14} /> 추가
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            padding: '0.5rem 1rem', borderRadius: '6px',
            border: '1px solid var(--border)', backgroundColor: 'transparent',
            color: 'var(--text-main)', fontWeight: 600, fontSize: '0.85rem',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
          }}
        >
          <Upload size={14} /> 엑셀/CSV 가져오기
        </button>
        <button
          onClick={handleDownloadTemplate}
          style={{
            padding: '0.5rem 1rem', borderRadius: '6px',
            border: '1px solid var(--border)', backgroundColor: 'transparent',
            color: 'var(--text-main)', fontWeight: 600, fontSize: '0.85rem',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
          }}
        >
          <Download size={14} /> 양식 다운(엑셀)
        </button>
        <input
          ref={fileRef} type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileImport(f); e.target.value = ''; }}
        />
      </div>

      {/* 선택 삭제 */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{selected.size}개 선택됨</span>
          <button
            onClick={handleDeleteSelected}
            style={{
              padding: '0.5rem 1rem', borderRadius: '6px', border: 'none',
              backgroundColor: '#EF4444', color: '#FFFFFF', fontWeight: 600,
              fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
            }}
          >
            <Trash2 size={14} /> 선택 삭제
          </button>
        </div>
      )}

      {/* 연락처 테이블 */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ backgroundColor: 'var(--border)' }}>
            <tr style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-main)' }}>
              <th style={{ padding: '0.6rem 0.75rem', width: '40px', border: '1px solid var(--border-strong)' }}>
                <input type="checkbox" checked={contacts.length > 0 && selected.size === contacts.length} onChange={toggleAll} />
              </th>
              <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border-strong)' }}>No</th>
              <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border-strong)' }}>이름</th>
              <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border-strong)' }}>별명</th>
              <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border-strong)' }}>번호</th>
              <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border-strong)', width: '80px', textAlign: 'center' }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={c.id} style={{ fontSize: '0.85rem' }}>
                <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)' }}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                </td>
                <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)' }}>{i + 1}</td>
                {editingId === c.id ? (
                  <>
                    <td style={{ padding: '0.3rem', border: '1px solid var(--border-strong)' }}>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, width: '100%', padding: '0.3rem 0.5rem' }} />
                    </td>
                    <td style={{ padding: '0.3rem', border: '1px solid var(--border-strong)' }}>
                      <input value={editNickname} onChange={(e) => setEditNickname(e.target.value)} style={{ ...inputStyle, width: '100%', padding: '0.3rem 0.5rem' }} />
                    </td>
                    <td style={{ padding: '0.3rem', border: '1px solid var(--border-strong)' }}>
                      <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} style={{ ...inputStyle, width: '100%', padding: '0.3rem 0.5rem' }} />
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                        <button onClick={saveEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#10B981' }}><Check size={16} /></button>
                        <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }}><X size={16} /></button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)' }}>{c.name || '-'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)' }}>{c.nickname || '-'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)', fontFamily: 'monospace' }}>{c.phone}</td>
                    <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-strong)', textAlign: 'center' }}>
                      <button onClick={() => startEdit(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><Pencil size={14} /></button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  연락처가 없습니다. 위에서 추가하거나 CSV를 가져오세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
