'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Save, AlertTriangle } from 'lucide-react';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import ConfirmModal from '@/components/confirm-modal';
import SudoModal from '@/components/sudo-modal';
import { hasPermission } from '@/lib/rbac';

interface AdminInfo { name: string; email: string; role: string }

interface SettingItem {
  key: string;
  value: unknown;
  description: string | null;
  isSensitive: boolean;
  updatedAt: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [settings, setSettings] = useState<Record<string, SettingItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);

  // Edit state
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editModal, setEditModal] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  // Kill switch
  const [killModal, setKillModal] = useState(false);
  const [killReason, setKillReason] = useState('');
  const [killLoading, setKillLoading] = useState(false);
  const [showSudoModal, setShowSudoModal] = useState(false);
  const [sudoRetryAction, setSudoRetryAction] = useState<'setting' | 'kill-switch' | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, settingsRes] = await Promise.all([
        fetch('/api/auth/session'),
        fetch('/api/settings'),
      ]);

      if (!sessionRes.ok) { router.push('/login'); return; }

      const sessionData = await sessionRes.json();
      setAdmin(sessionData.admin);
      setKillSwitch(sessionData.killSwitch ?? false);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings(data.settings ?? {});
      }
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleSave() {
    if (editReason.length < 5) return;
    setEditLoading(true);
    try {
      let parsedValue: unknown = editValue;
      try { parsedValue = JSON.parse(editValue); } catch { /* keep as string */ }

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: editKey, value: parsedValue, reason: editReason }),
      });
      if (res.ok) {
        setEditModal(false);
        setEditKey('');
        setEditValue('');
        setEditReason('');
        await fetchData();
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.requireSudo) {
        setSudoRetryAction('setting');
        setShowSudoModal(true);
      } else {
        alert(data.error || '설정 저장에 실패했습니다.');
      }
    } finally {
      setEditLoading(false);
    }
  }

  async function handleKillSwitch() {
    if (killReason.length < 5) return;
    setKillLoading(true);
    try {
      const res = await fetch('/api/settings/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: killSwitch ? 'NORMAL' : 'GLOBAL_STOP', reason: killReason }),
      });
      if (res.ok) {
        setKillModal(false);
        setKillReason('');
        await fetchData();
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.requireSudo) {
        setSudoRetryAction('kill-switch');
        setShowSudoModal(true);
      }
    } finally {
      setKillLoading(false);
    }
  }

  function openEdit(item: SettingItem) {
    setEditKey(item.key);
    setEditValue(item.isSensitive ? '' : (typeof item.value === 'string' ? item.value : JSON.stringify(item.value, null, 2)));
    setEditReason('');
    setEditModal(true);
  }

  const canUpdateSettings = admin ? hasPermission(admin.role, 'setting:update') : false;
  const canToggleKillSwitch = admin ? hasPermission(admin.role, 'killswitch:toggle') : false;

  if (!admin) {
    return <div className="loading-center" style={{ minHeight: '100vh' }}><span className="spinner spinner-lg" /></div>;
  }

  return (
    <div className="admin-layout">
      <Sidebar adminName={admin.name} adminEmail={admin.email} adminRole={admin.role} killSwitchActive={killSwitch} />
      <div className="admin-main">
        <Header title="시스템 설정" killSwitchActive={killSwitch} adminName={admin.name} />
        <main className="admin-content">
          {/* Kill Switch */}
          <div className="card" style={{ marginBottom: '24px', borderColor: killSwitch ? 'var(--status-danger)' : undefined }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, color: killSwitch ? 'var(--status-danger)' : undefined }}>
                <AlertTriangle size={18} /> 긴급 중지 스위치
              </h3>
              <button
                className={`btn ${killSwitch ? 'btn-primary' : 'btn-danger'} btn-sm`}
                onClick={() => setKillModal(true)}
                disabled={!canToggleKillSwitch}
              >
                {killSwitch ? '해제' : '활성화'}
              </button>
            </div>
            <div className="card-body">
              <p>현재 상태: <strong style={{ color: killSwitch ? 'var(--status-danger)' : 'var(--status-success)' }}>{killSwitch ? '활성 (모든 발송 중지됨)' : '비활성 (정상 운영)'}</strong></p>
            </div>
          </div>

          {/* Settings by category */}
          {loading ? (
            <div className="loading-center"><span className="spinner spinner-lg" /></div>
          ) : (
            Object.entries(settings).map(([category, items]) => (
              <div key={category} className="card" style={{ marginBottom: '16px' }}>
                <div className="card-header">
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <Settings size={16} /> {category}
                  </h3>
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)' }}>키</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)' }}>값</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)' }}>설명</th>
                        <th style={{ padding: '10px 16px', width: '60px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.key} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: '13px' }}>{item.key}</td>
                          <td style={{ padding: '10px 16px', fontSize: '13px' }}>
                            {item.isSensitive ? '********' : (typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value))}
                          </td>
                          <td style={{ padding: '10px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>{item.description ?? '-'}</td>
                          <td style={{ padding: '10px 16px' }}>
                            {canUpdateSettings ? (
                              <button className="btn btn-ghost btn-xs" onClick={() => openEdit(item)}>
                                <Save size={12} />
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </main>
      </div>

      {/* Edit Setting Modal */}
      {editModal && (
        <div className="modal-overlay" onClick={() => setEditModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <h3 style={{ marginBottom: '16px' }}>설정 변경: {editKey}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="label">값</label>
                <textarea className="input" rows={4} value={editValue} onChange={(e) => setEditValue(e.target.value)} style={{ width: '100%', fontFamily: 'monospace', resize: 'vertical' }} />
              </div>
              <div>
                <label className="label">사유 (5자 이상)</label>
                <textarea className="input" rows={2} value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="변경 사유..." style={{ width: '100%', resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setEditModal(false)}>취소</button>
                <button className="btn btn-primary" disabled={editLoading || editReason.length < 5} onClick={handleSave}>
                  {editLoading && <span className="spinner" />} 저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kill Switch Modal */}
      <ConfirmModal
        isOpen={killModal}
        onClose={() => { setKillModal(false); setKillReason(''); }}
        onConfirm={handleKillSwitch}
        title={killSwitch ? '킬 스위치 해제' : '킬 스위치 활성화'}
        message={killSwitch ? '킬 스위치를 해제하면 SMS 발송이 재개됩니다.' : '킬 스위치를 활성화하면 모든 SMS 발송이 즉시 중단됩니다.'}
        confirmText={killSwitch ? '해제' : '활성화'}
        danger={!killSwitch}
        loading={killLoading}
      >
        <div style={{ marginBottom: '12px' }}>
          <label className="label">사유 (5자 이상)</label>
          <textarea className="input" rows={2} value={killReason} onChange={(e) => setKillReason(e.target.value)} placeholder="사유를 입력하세요..." style={{ width: '100%', resize: 'vertical' }} />
        </div>
      </ConfirmModal>

      <SudoModal
        isOpen={showSudoModal}
        onClose={() => {
          setShowSudoModal(false);
          setSudoRetryAction(null);
        }}
        onSuccess={async () => {
          setShowSudoModal(false);
          if (sudoRetryAction === 'kill-switch') {
            await handleKillSwitch();
          } else if (sudoRetryAction === 'setting') {
            await handleSave();
          }
          setSudoRetryAction(null);
        }}
      />
    </div>
  );
}
