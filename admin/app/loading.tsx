/**
 * AdminShell이 layout에 항상 마운트되어 있으므로 본문 영역만 차지하는
 * 인라인 skeleton을 렌더. 화면 전체를 가려서 깜빡이게 만드는 풀스크린
 * spinner는 의도적으로 사용하지 않음.
 */
export default function AdminLoading() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        color: '#94A3B8',
        fontSize: '0.875rem',
      }}
    >
      <div
        style={{
          width: '24px',
          height: '24px',
          border: '2px solid rgba(16, 185, 129, 0.2)',
          borderTop: '2px solid #10B981',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          marginRight: '10px',
        }}
      />
      불러오는 중…
    </div>
  );
}
