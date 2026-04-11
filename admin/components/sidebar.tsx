'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Wallet,
  Ban,
  FileText,
  Settings,
  ClipboardList,
  Power,
  LogOut,
  Shield,
  Menu,
  X,
  User,
} from 'lucide-react';

interface SidebarProps {
  adminName: string;
  adminEmail: string;
  adminRole: string;
  killSwitchActive: boolean;
}

const navItems = [
  { href: '/', label: '대시보드', icon: LayoutDashboard },
  { href: '/users', label: '사용자 관리', icon: Users },
  { href: '/campaigns', label: '캠페인 모니터링', icon: MessageSquare },
  { href: '/credits', label: '크레딧 관리', icon: Wallet },
  { href: '/blacklist', label: '블랙리스트', icon: Ban },
  { href: '/templates', label: '템플릿 관리', icon: FileText },
  { href: '/settings', label: '시스템 설정', icon: Settings },
  { href: '/audit', label: '감사 로그', icon: ClipboardList },
];

export default function Sidebar({ adminName, adminEmail, adminRole, killSwitchActive }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    router.push('/login');
  }

  return (
    <>
      <button
        className="sidebar-toggle"
        onClick={() => setMobileOpen(true)}
        aria-label="메뉴 열기"
      >
        <Menu size={20} />
      </button>

      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Shield size={20} />
          </div>
          <h1>
            SovereignSMS
            <span>관리자 패널</span>
          </h1>
          {mobileOpen && (
            <button
              className="modal-close"
              onClick={() => setMobileOpen(false)}
              style={{ marginLeft: 'auto' }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">메뉴</div>
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`sidebar-link ${isActive(item.href) ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                router.push(item.href);
              }}
            >
              <item.icon size={20} />
              {item.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className={`sidebar-kill-switch ${killSwitchActive ? 'active' : 'inactive'}`}>
            <span className={`sidebar-kill-dot ${killSwitchActive ? 'active' : 'inactive'}`} />
            <Power size={16} />
            <span>긴급 중지: {killSwitchActive ? '활성' : '비활성'}</span>
          </div>

          <div className="sidebar-admin-info">
            <div className="sidebar-admin-avatar">
              <User size={16} />
            </div>
            <div className="sidebar-admin-info-text">
              <div className="name">{adminName}</div>
              <div className="role">{adminRole}</div>
            </div>
          </div>

          <button className="sidebar-logout" onClick={handleLogout}>
            <LogOut size={16} />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}
