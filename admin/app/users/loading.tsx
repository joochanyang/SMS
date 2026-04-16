export default function UsersLoading() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ width: '180px', height: '32px', borderRadius: '6px', background: 'var(--surface-hover)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ width: '120px', height: '36px', borderRadius: '6px', background: 'var(--surface-hover)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
      <div style={{ background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem', height: '500px', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.15s' }} />
    </div>
  );
}
