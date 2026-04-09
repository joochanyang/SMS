'use client';

import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

export default function SignOutButton() {
  return (
    <button
      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', padding: '0.5rem 0', transition: 'color 0.2s ease' }}
      onMouseOver={(e) => {
        e.currentTarget.style.color = '#ef4444';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
      onClick={() => signOut({ callbackUrl: '/login' })}
      type="button"
    >
      <LogOut size={16} /> Sign Out
    </button>
  );
}

