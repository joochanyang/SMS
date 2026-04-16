export default function WalletLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="glass-card" style={{ padding: '1.5rem', height: '150px', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div className="glass-card" style={{ padding: '1.5rem', height: '350px', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.15s' }} />
    </div>
  );
}
