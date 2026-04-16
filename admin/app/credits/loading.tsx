export default function CreditsLoading() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem', height: '100px', animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
      <div style={{ background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem', height: '400px', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.15s' }} />
    </div>
  );
}
