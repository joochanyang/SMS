'use client';

import { useState } from 'react';
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
  Radio,
} from 'lucide-react';
import { hasPermission, type Permission } from '@/lib/rbac';

interface SidebarProps {
  adminName: string;
  adminEmail: string;
  adminRole: string;
  killSwitchActive: boolean;
}

const navItems = [
  { href: '/', label: '대시보드', icon: LayoutDashboard, permission: 'dashboard:read' },
  { href: '/users', label: '사용자 관리', icon: Users, permission: 'user:read' },
  { href: '/campaigns', label: '캠페인 모니터링', icon: MessageSquare, permission: 'campaign:read' },
  { href: '/credits', label: '크레딧 관리', icon: Wallet, permission: 'credit:read' },
  { href: '/blacklist', label: '블랙리스트', icon: Ban, permission: 'blacklist:read' },
  { href: '/templates', label: '템플릿 관리', icon: FileText, permission: 'template:read' },
  { href: '/sms-providers', label: 'SMS 라인 관리', icon: Radio, permission: 'setting:read' },
  { href: '/settings', label: '시스템 설정', icon: Settings, permission: 'setting:read' },
  { href: '/audit', label: '감사 로그', icon: ClipboardList, permission: 'audit:read' },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: Permission;
}>;

export default function Sidebar({ adminName, adminRole, killSwitchActive }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  const visibleNavItems = navItems.filter((item) => hasPermission(adminRole, item.permission));

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
          {visibleNavItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`sidebar-link ${isActive(item.href) ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                setMobileOpen(false);
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
