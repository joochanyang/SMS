'use client';

import { usePathname } from 'next/navigation';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '대시보드',
  '/dashboard/sms-send': '문자 발송',
  '/dashboard/campaigns': '발송내역 관리',
  '/dashboard/address-book': '주소록 관리',
  '/dashboard/wallet/usdt': 'USDT 충전',
};

export default function DashboardHeader() {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] || '대시보드';

  return (
    <header style={{ height: '70px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 2rem', backgroundColor: '#FFFFFF' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{title}</h1>
    </header>
  );
}
