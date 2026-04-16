export default function AdminLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#020617' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
        <div style={{
          width: '40px', height: '40px', border: '3px solid rgba(16, 185, 129, 0.2)',
          borderTop: '3px solid #10B981', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ color: '#94A3B8', fontSize: '0.875rem' }}>로딩 중...</span>
      </div>
    </div>
  );
}
