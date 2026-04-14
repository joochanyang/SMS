'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Globe2, Send, CreditCard, History, BarChart3, LayoutDashboard } from 'lucide-react';

const MENU_ITEMS = [
  { name: '대시보드', href: '/dashboard', icon: LayoutDashboard, exact: true },
  { name: '문자 발송', href: '/dashboard/sms-send', icon: Send },
  { name: '발송 내역', href: '/dashboard/history', icon: History },
  { name: '캠페인 관리', href: '/dashboard/campaigns', icon: BarChart3 },
  { name: '지갑 / 크레딧', href: '/dashboard/wallet', icon: CreditCard },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside style={{
      width: '260px',
      borderRight: '1px solid var(--border)',
      backgroundColor: 'var(--surface)',  // Enamel surface color
      display: 'flex',
      flexDirection: 'column',
      zIndex: 50,
    }}>
      <div style={{ padding: '2rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '1.25rem', borderBottom: '1px solid var(--border)', letterSpacing: '-0.02em' }}>
        <Globe2 color="var(--text-main)" />
        <span>Sovereign<span style={{ color: 'var(--text-secondary)' }}>SMS</span></span>
      </div>
      
      <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, paddingLeft: '0.5rem', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>메뉴</div>
        
        {MENU_ITEMS.map((item) => {
          const isActive = item.exact 
            ? pathname === item.href 
            : pathname.startsWith(item.href);
            
          return (
            <Link 
              key={item.href} 
              href={item.href} 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.75rem', 
                padding: '0.75rem 1rem', 
                borderRadius: '8px', 
                transition: 'all 0.2s ease', 
                textDecoration: 'none',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--text-main)' : 'var(--text-secondary)', 
                backgroundColor: isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: isActive ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid transparent',
              }}
              onMouseOver={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-main)';
                }
              }}
              onMouseOut={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
                }
              }}
            >
              <item.icon size={18} color={isActive ? 'var(--text-main)' : 'var(--text-secondary)'} />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
