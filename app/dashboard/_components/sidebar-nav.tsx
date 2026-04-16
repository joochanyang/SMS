'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Send, CreditCard, BarChart3, BookUser } from 'lucide-react';

const MENU_ITEMS = [
  { name: '문자 발송', href: '/dashboard/sms-send', icon: Send },
  { name: '발송내역 관리', href: '/dashboard/campaigns', icon: BarChart3 },
  { name: '주소록', href: '/dashboard/address-book', icon: BookUser },
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
            className={isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              borderRadius: '0px',
              textDecoration: 'none',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--sidebar-text)' : 'var(--sidebar-text-sec)',
              backgroundColor: isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: isActive ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid transparent',
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
