'use client';

import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

export default function SignOutButton() {
  return (
    <button
      className="signout-btn"
      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', padding: '0.5rem 0' }}
      onClick={() => signOut({ callbackUrl: '/login' })}
      type="button"
    >
      <LogOut size={16} /> 로그아웃
    </button>
  );
}

