'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Toaster } from 'react-hot-toast';
import Sidebar from './sidebar';
import Header from './header';

interface AdminInfo {
  name: string;
  username: string;
  role: string;
}

interface SessionResponse {
  admin?: AdminInfo;
  killSwitch?: boolean;
  killSwitchLevel?: string;
}

const PATH_TITLES: Array<{ match: (p: string) => boolean; title: string }> = [
  { match: (p) => p === '/', title: '대시보드' },
  { match: (p) => p.startsWith('/users'), title: '사용자 관리' },
  { match: (p) => p.startsWith('/campaigns'), title: '캠페인 모니터링' },
  { match: (p) => p.startsWith('/credits'), title: '크레딧 관리' },
  { match: (p) => p.startsWith('/blacklist'), title: '블랙리스트' },
  { match: (p) => p.startsWith('/templates'), title: '템플릿 관리' },
  { match: (p) => p.startsWith('/sms-providers'), title: 'SMS 라인 관리' },
  { match: (p) => p.startsWith('/settings'), title: '시스템 설정' },
  { match: (p) => p.startsWith('/audit'), title: '감사 로그' },
];

function titleFor(pathname: string): string {
  return PATH_TITLES.find((p) => p.match(pathname))?.title ?? '관리자';
}

/**
 * AdminShell: Sidebar + Header를 모든 admin 페이지 공통으로 한 번만 렌더.
 *
 * 페이지 전환 시 sidebar/header는 그대로 두고 children만 교체되므로 깜빡임 없음.
 * admin 세션 정보는 한 번만 가져와서 sessionStorage에 캐시 — 페이지 진입 시
 * 즉시 보이고, 백그라운드에서 30초마다 refresh.
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminInfo | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem('admin_info');
      return raw ? (JSON.parse(raw) as AdminInfo) : null;
    } catch {
      return null;
    }
  });
  const [killSwitch, setKillSwitch] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as SessionResponse;
        if (cancelled) return;
        if (data.admin) {
          setAdmin(data.admin);
          try {
            sessionStorage.setItem('admin_info', JSON.stringify(data.admin));
          } catch {
            // sessionStorage 쓰기 실패는 무시 — 메모리 상태만 사용
          }
        }
        setKillSwitch(
          data.killSwitch === true ||
            data.killSwitchLevel === 'GLOBAL_STOP' ||
            data.killSwitchLevel === 'GLOBAL_PAUSE',
        );
      } catch {
        // 네트워크 일시 장애는 무시 — 다음 폴링에서 회복
      }
    }

    refresh();
    const id = setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router]);

  return (
    <div className="admin-layout">
      <Sidebar
        adminName={admin?.name ?? ''}
        adminEmail={admin?.username ?? ''}
        adminRole={admin?.role ?? ''}
        killSwitchActive={killSwitch}
      />
      <div className="admin-main">
        <Header
          title={titleFor(pathname)}
          killSwitchActive={killSwitch}
          adminName={admin?.name}
        />
        <main className="admin-content">{children}</main>
      </div>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          },
          success: { iconTheme: { primary: 'var(--status-success)', secondary: 'var(--surface)' } },
          error: { iconTheme: { primary: 'var(--status-danger)', secondary: 'var(--surface)' } },
        }}
      />
    </div>
  );
}
