'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import AdminShell from './admin-shell';

const PUBLIC_PATHS = ['/login', '/mfa-verify', '/mfa-setup'];

/**
 * 인증 페이지(/login, /mfa-*)에는 Sidebar/Header가 필요 없으므로
 * pathname을 보고 조건부로 AdminShell을 끼움.
 *
 * 보호 페이지에는 AdminShell이 항상 마운트된 채로 children만 교체되므로
 * 페이지 전환 시 sidebar/header가 깜빡이지 않음.
 */
export default function ConditionalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic) {
    return <>{children}</>;
  }
  return <AdminShell>{children}</AdminShell>;
}
