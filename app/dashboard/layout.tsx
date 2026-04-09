import React from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Globe2, Send, CreditCard, History } from 'lucide-react';
import SignOutButton from './_components/signout-button';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-color)' }}>
      {/* Sidebar */}
      <aside style={{
        width: '260px',
        borderRight: '1px solid var(--border)',
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ padding: '2rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.25rem', borderBottom: '1px solid var(--border)' }}>
          <Globe2 color="var(--primary)" />
          <span>Sovereign<span style={{ color: 'var(--primary)' }}>SMS</span></span>
        </div>
        
        <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, paddingLeft: '0.5rem', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Menu</div>
          <a href="/dashboard/sms-send" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', color: 'var(--text-main)', backgroundColor: 'rgba(16, 185, 129, 0.1)', fontWeight: 500 }}>
            <Send size={18} color="var(--primary)" />
            Send SMS
          </a>
          <a href="/dashboard/history" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', color: 'var(--text-secondary)', transition: 'background-color 0.2s ease', fontWeight: 500 }}>
            <History size={18} />
            Target Tracking
          </a>
          <a href="/dashboard/wallet" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '8px', color: 'var(--text-secondary)', transition: 'background-color 0.2s ease', fontWeight: 500 }}>
            <CreditCard size={18} />
            Wallet & Credits
          </a>
        </nav>

        <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '18px', backgroundColor: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', fontWeight: 600 }}>
              {session.user?.name?.[0] || session.user?.email?.[0]?.toUpperCase()}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user?.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user?.email}</div>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <header style={{ height: '70px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 2rem', backgroundColor: 'rgba(2, 6, 23, 0.7)', backdropFilter: 'blur(12px)' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Dashboard Overview</h1>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
