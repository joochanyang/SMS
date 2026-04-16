export default function CampaignsLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ width: '200px', height: '32px', borderRadius: '6px', background: 'var(--border)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ width: '120px', height: '36px', borderRadius: '6px', background: 'var(--border)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
      <div className="glass-card" style={{ padding: '1.5rem', height: '500px', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.15s' }} />
    </div>
  );
}
