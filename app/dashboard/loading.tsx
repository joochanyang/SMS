export default function DashboardLoading() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 상단 카드 스켈레톤 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="glass-card"
            style={{
              padding: '1.5rem',
              borderRadius: '8px',
              height: '120px',
              background: 'var(--surface)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        ))}
      </div>
      {/* 메인 컨텐츠 스켈레톤 */}
      <div
        className="glass-card"
        style={{
          padding: '1.5rem',
          borderRadius: '8px',
          height: '300px',
          background: 'var(--surface)',
          animation: 'pulse 1.5s ease-in-out infinite',
          animationDelay: '0.2s',
        }}
      />
    </div>
  );
}
