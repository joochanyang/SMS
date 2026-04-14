'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Send, CreditCard, History, BarChart3, LayoutDashboard } from 'lucide-react';

const MENU_ITEMS = [
  { name: '문자 발송', href: '/dashboard/sms-send', icon: Send },
  { name: '발송 내역', href: '/dashboard/history', icon: History },
  { name: '캠페인 관리', href: '/dashboard/campaigns', icon: BarChart3 },
  { name: '잔액충전', href: '/dashboard/wallet/usdt', icon: CreditCard },
];

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ color: 'var(--sidebar-text-sec)', fontSize: '0.75rem', fontWeight: 600, paddingLeft: '0.5rem', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>메뉴</div>
      
      {MENU_ITEMS.map((item) => {
        const isActive = pathname.startsWith(item.href);
          
        return (
          <Link 
            key={item.href} 
            href={item.href} 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.75rem', 
              padding: '0.75rem 1rem', 
              borderRadius: '0px', 
              transition: 'all 0.2s ease', 
              textDecoration: 'none',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--sidebar-text)' : 'var(--sidebar-text-sec)', 
              backgroundColor: isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: isActive ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid transparent',
            }}
            onMouseOver={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                (e.currentTarget as HTMLElement).style.color = 'var(--sidebar-text)';
              }
            }}
            onMouseOut={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLElement).style.color = 'var(--sidebar-text-sec)';
              }
            }}
          >
            <item.icon size={18} color={isActive ? 'var(--sidebar-text)' : 'var(--sidebar-text-sec)'} />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
