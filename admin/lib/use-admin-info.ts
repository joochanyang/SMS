'use client';

import { useEffect, useState } from 'react';

export interface AdminInfo {
  name: string;
  username: string;
  role: string;
}

/**
 * AdminShell이 sessionStorage에 저장한 admin 정보를 페이지에서 읽는다.
 * 페이지 컴포넌트가 직접 `/api/auth/session` 호출하지 않아도 RBAC 판단 가능.
 *
 * 초기값은 sessionStorage에서 동기 로드 → 페이지 진입 시 깜빡임 없이 즉시 role 사용 가능.
 * 그 후 AdminShell이 30초마다 storage 갱신하므로 자동으로 최신 상태 따라옴.
 */
export function useAdminInfo(): AdminInfo | null {
  const [info, setInfo] = useState<AdminInfo | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem('admin_info');
      return raw ? (JSON.parse(raw) as AdminInfo) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    function refresh() {
      try {
        const raw = sessionStorage.getItem('admin_info');
        if (raw) setInfo(JSON.parse(raw) as AdminInfo);
      } catch {
        // sessionStorage 파싱 실패는 무시
      }
    }
    // 같은 탭에서 sessionStorage 변경은 storage 이벤트가 안 뜸 →
    // polling 으로 보조 (AdminShell이 30초마다 갱신하므로 충분히 자주)
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  return info;
}
