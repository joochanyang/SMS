import React from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Globe2 } from 'lucide-react';
import SignOutButton from './_components/signout-button';
import SidebarNav from './_components/sidebar-nav';
import DashboardHeader from './_components/dashboard-header';

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
        borderRight: '1px solid var(--sidebar-border)',
        backgroundColor: 'var(--sidebar-surface)',
        color: 'var(--sidebar-text)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ padding: '2rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '1.25rem', borderBottom: '1px solid var(--sidebar-border)', letterSpacing: '-0.02em' }}>
          <Globe2 color="var(--sidebar-text)" />
          <span>Sovereign<span style={{ color: 'var(--sidebar-text-sec)' }}>SMS</span></span>
        </div>
        
        <SidebarNav />

        <div style={{ padding: '1.5rem', borderTop: '1px solid var(--sidebar-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '0px', backgroundColor: 'var(--sidebar-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--sidebar-border)', fontWeight: 600 }}>
              {session.user?.name?.[0]?.toUpperCase() || session.user?.email?.[0]?.toUpperCase()}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user?.name || session.user?.email}</div>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg-color)' }}>
        <DashboardHeader />
        <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
