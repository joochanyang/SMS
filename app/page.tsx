'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Shield, Zap, Globe2 } from 'lucide-react';

export default function Home() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header className="glass-header" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '70px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 2rem',
        justifyContent: 'space-between',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.25rem' }}>
          <Globe2 color="var(--primary)" />
          <span>Sovereign<span style={{ color: 'var(--primary)' }}>SMS</span></span>
        </div>
        <nav style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>Pricing</span>
          <span style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>API Docs</span>
          <span style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>Dashboard</span>
          <button className="btn-primary">Sign In</button>
        </nav>
      </header>

      {/* Hero Section */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 2rem 4rem', textAlign: 'center' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          style={{ maxWidth: '800px' }}
        >
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            borderRadius: '999px',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            color: 'var(--primary)',
            fontSize: '0.875rem',
            fontWeight: 500,
            marginBottom: '2rem'
          }}>
            <Zap size={16} /> Now with 99.9% Global Delivery Rate
          </div>
          <h1 style={{ fontSize: '4rem', fontWeight: 700, lineHeight: 1.1, marginBottom: '1.5rem' }}>
            Enterprise Mass SMS,<br />
            <span style={{ color: 'var(--text-secondary)' }}>Delivered with Precision.</span>
          </h1>
          <p style={{ fontSize: '1.25rem', color: 'var(--text-secondary)', marginBottom: '3rem', maxWidth: '600px', margin: '0 auto 3rem' }}>
            Secure, reliable, and blazingly fast routing for critical financial alerts, marketing campaigns, and notifications worldwide.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button className="btn-primary" style={{ padding: '1rem 2.5rem', fontSize: '1.125rem' }}>Start Free Trial</button>
            <button className="glass-card" style={{
              padding: '1rem 2.5rem',
              fontSize: '1.125rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              Contact Sales
            </button>
          </div>
        </motion.div>

        {/* Feature Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '2rem',
          width: '100%',
          maxWidth: '1200px',
          marginTop: '6rem'
        }}>
          {[
            { tag: 'Global Reach', title: 'Infobip Integration', desc: 'Direct routing to 190+ countries with minimal latency.' },
            { tag: 'Fintech Security', title: 'Bank-Grade Tracking', desc: 'End-to-end delivery reports and realtime status updates.' },
            { tag: 'High Volume', title: '1-Million+ Batching', desc: 'Process enormous CSV files smoothly without blocking UI.' },
          ].map((feat, i) => (
            <motion.div
              key={feat.title}
              className="glass-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.1 }}
              style={{ padding: '2rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)'
              }}>
                <Shield size={24} />
              </div>
              <div>
                <div style={{ fontSize: '0.875rem', color: 'var(--primary)', fontWeight: 600, marginBottom: '0.5rem' }}>{feat.tag}</div>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>{feat.title}</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{feat.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
}
