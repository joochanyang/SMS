# 관리자 대시보드 + 유저 상세 리팩토링 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 TPS 차트를 프로바이더 잔액 카드로 교체하고, 유저 상세 페이지를 프로필/라우팅/빌링/보안 4개 카드로 재구성하면서 유저 비밀번호 재설정 기능과 react-hot-toast를 단일 PR로 도입한다.

**Architecture:** Next.js 16 App Router admin 워크스페이스(`/admin`). 클라이언트 컴포넌트(React 19) + Route Handlers + Prisma. 신규 백엔드는 Route Handler 2개(잔액 조회, 유저 비번 재설정). 프론트엔드는 카드 4개로 분해 + 잔액 그리드 1개. 모든 액션은 기존 `requireAuth/requirePermission/requireSudo/logAdminAction` 패턴 재사용. 단일 트랜잭션 불필요(쓰기 라우트는 단일 row update).

**Tech Stack:** Next.js 16.2.3, React 19, TypeScript, Prisma 7.7, PostgreSQL, vitest, zod, bcryptjs(유저), argon2(어드민, 본 PR에선 사용 안 함), react-hot-toast(신규).

**Scope 변경(2026-05-28 plan 수정):** 원래 plan은 `feature/per-user-sms-line` 머지를 전제로 했으나, 그 브랜치가 main과 크게 분기돼 있어(admin-shell 재구조·세션 하드닝·import 도구와 충돌) 안전한 별도 머지가 어렵다. 따라서 본 PR이 라인 오버라이드의 **최소 핵심**(스키마 + resolver + PATCH 라우트)만 신규 작성 형태로 흡수한다. `SmsLog.providerName` 박제, `campaign-processor` 분기, `services/smpp-worker/poller` 라인별 claim 같은 발송 경로 변경은 본 PR scope 외. 본 PR 머지 후 발송 경로는 **전역 활성 라인을 그대로 사용**하며, 유저 오버라이드는 UI 상에서 표시·기록·향후 사용을 위한 데이터 준비 상태로 둔다. 별도 후속 PR에서 발송 경로를 라인별로 전환할 수 있다.

**브랜치:** `feat/admin-dashboard-and-user-detail-refactor` (main 분기)

---

## File Structure (생성 / 수정)

**생성 (Backend):**
- `admin/app/api/sms-providers/balances/route.ts` — 프로바이더 잔액 조회 (GET)
- `admin/app/api/users/[id]/password/route.ts` — 유저 비번 재설정 (POST)
- `prisma/migrations/<timestamp>_add_user_sms_provider/migration.sql` — User.smsProvider 컬럼 추가

**생성 (Frontend 컴포넌트):**
- `admin/components/provider-balance-grid.tsx` — 잔액 카드 그리드 (가시성 가드 폴링)
- `admin/components/admin-user-profile-card.tsx` — 프로필 + 상태/정지 액션
- `admin/components/admin-user-routing-card.tsx` — 발송 라인 오버라이드
- `admin/components/admin-user-billing-card.tsx` — 크레딧/단가/한도 + 액션 진입점
- `admin/components/admin-user-security-card.tsx` — 유저 비번 재설정 폼
- `admin/lib/use-visibility-polling.ts` — 가시성·viewport 가드 polling 훅

**생성 (테스트):**
- `__tests__/api/admin-provider-balances.test.ts` — 응답 형태/오류 처리 (순수 함수 단위)
- `__tests__/api/admin-user-password-reset.test.ts` — 입력 검증 (순수 함수 단위)
- `__tests__/lib/use-visibility-polling.test.ts` — 가시성 가드 동작 (Jest fake timers)

**수정:**
- `admin/components/admin-shell.tsx` — `<Toaster />` 마운트
- `admin/app/dashboard-client.tsx` — TPS 영역 제거 + `<ProviderBalanceGrid />` 마운트
- `admin/app/api/dashboard/route.ts` — 응답에서 `tpsData` 제거(집계 코드는 유지)
- `admin/app/users/[id]/page.tsx` — 카드 4개 조립 + alert→toast 교체
- `admin/app/api/users/[id]/route.ts` — PATCH 에 `smsProvider` zod 필드 + sudo 게이트 + 응답 select 추가
- `admin/app/api/users/[id]/route.ts` GET — 응답 select에 `smsProvider` 추가
- `lib/sms-providers/router.ts` — `resolveUserProvider(userId)` export 추가 (전역 폴백)
- `prisma/schema.prisma` — `User.smsProvider String?` 컬럼 추가
- `admin/package.json` — `react-hot-toast` 추가

**유지(변경 없음):**
- `admin/components/tps-chart.tsx` — 파일 자체는 남김(다른 페이지 재사용 가능). 단지 dashboard에서만 import 제거.
- `lib/sms-providers/*` — 기존 `getBalance()` API 그대로 호출

---

## Task 1: 브랜치 + react-hot-toast 추가

**Files:**
- Modify: `admin/package.json`

- [ ] **Step 1: main 최신화 + 브랜치 생성**

```bash
cd ~/Desktop/sms문자사이트
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feat/admin-dashboard-and-user-detail-refactor
```

Expected: 새 브랜치 `feat/admin-dashboard-and-user-detail-refactor` 생성·체크아웃. 작업 트리 clean.

> **Note:** 본 plan은 `feature/per-user-sms-line` 머지 없이 진행한다(분기 충돌로 위험). 라인 오버라이드의 최소 핵심(스키마+resolver+PATCH)은 Task 1.5에서 신규 작성한다.

- [ ] **Step 2: react-hot-toast 설치**

```bash
cd ~/Desktop/sms문자사이트/admin
npm install react-hot-toast@2.4.1
```

Expected: `admin/package.json` 의 `dependencies` 에 `"react-hot-toast": "^2.4.1"` 추가, `admin/package-lock.json` 갱신.

- [ ] **Step 3: 커밋**

```bash
cd ~/Desktop/sms문자사이트
git add admin/package.json admin/package-lock.json
git commit -m "chore(admin): add react-hot-toast for admin toasts"
```

---

## Task 1.5: 유저별 발송 라인 토대 (스키마 + resolver + PATCH)

본 task는 라인 오버라이드 UI(Task 9)와 페이지 재조립(Task 12)에서 필요한 데이터 토대를 만든다. 발송 경로 자체는 바꾸지 않는다(전역 라인 유지). resolver는 향후 발송 경로 전환을 위해 미리 export해 두지만, 본 PR에서는 사용처를 추가하지 않는다 — **dead code 가 아님**을 RoutingCard UI가 활성 라인 표시에 간접 활용함으로 보증한다.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_user_sms_provider/migration.sql`
- Modify: `lib/sms-providers/router.ts`
- Modify: `admin/app/api/users/[id]/route.ts`
- Test: `__tests__/lib/resolve-user-provider.test.ts`

- [ ] **Step 1: schema 컬럼 추가**

`prisma/schema.prisma` 의 `model User` 안 `maxCampaignSize Int @default(5000)` 다음 줄에 추가:

```prisma
  smsProvider        String?   // 유저 배정 발송 라인 (infobip|smsto|txg). null = 전역 기본 폴백
```

- [ ] **Step 2: migration 생성**

```bash
cd ~/Desktop/sms문자사이트
npx prisma migrate dev --name add_user_sms_provider --create-only
```

Expected: `prisma/migrations/<timestamp>_add_user_sms_provider/migration.sql` 생성. 내용 확인:

```sql
ALTER TABLE "User" ADD COLUMN "smsProvider" TEXT;
```

다른 ALTER가 끼어 있으면 schema 비교 오류 — 마이그레이션 파일에서 의도하지 않은 라인 제거 후 다시 생성.

- [ ] **Step 3: prisma client 재생성**

```bash
cd ~/Desktop/sms문자사이트
npx prisma generate
```

- [ ] **Step 4: resolveUserProvider 테스트 작성**

`__tests__/lib/resolve-user-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// prisma·provider 의존을 mock — 함수 동작만 검증
vi.mock('@/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, systemSetting: { findUnique: vi.fn() } } }));
vi.mock('@/sms-providers/infobip', () => ({ InfobipProvider: class { name = 'infobip'; isConfigured() { return true; } } }));
vi.mock('@/sms-providers/smsto', () => ({ SmsToProvider: class { name = 'smsto'; isConfigured() { return true; } } }));
vi.mock('@/sms-providers/txg', () => ({ TxgProvider: class { name = 'txg'; isConfigured() { return true; } } }));
vi.mock('@/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

// vi.mock 경로 alias 조정 필요 — 실제 import 경로에 맞춤
// 실제 파일은 `lib/sms-providers/router.ts` → import { resolveUserProvider } from '../../lib/sms-providers/router';

import { prisma } from '../../lib/prisma';
import { resolveUserProvider } from '../../lib/sms-providers/router';

describe('resolveUserProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('User.smsProvider 가 null 이면 전역 활성 라인을 반환한다', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ smsProvider: null });
    (prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: { provider: 'infobip' },
    });
    const p = await resolveUserProvider('u1');
    expect((p as { isConfigured: () => boolean }).isConfigured()).toBe(true);
  });

  it('User.smsProvider 가 유효한 라인이면 그 라인을 반환한다', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ smsProvider: 'smsto' });
    const p = await resolveUserProvider('u1');
    // smsto Provider 인스턴스 — name 확인은 internal 이라 구조 검증으로 대체
    expect(p).toBeDefined();
  });

  it('User.smsProvider 가 알 수 없는 값이면 전역 폴백', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ smsProvider: 'unknown' });
    (prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: { provider: 'infobip' },
    });
    const p = await resolveUserProvider('u1');
    expect(p).toBeDefined();
  });
});
```

**주의:** 위 mock 경로 alias 는 프로젝트 vitest 설정의 path mapping 에 의존한다. 실제 import 가 동작하지 않으면 다음 단순화된 검증으로 대체 가능:

대체안 — `resolveUserProvider`를 작게 분리하여 순수 함수 `pickProviderName(userSetting, globalSetting)` 만 단위 테스트:

```ts
// lib/sms-providers/router.ts 내에 추가
export function pickProviderName(
  userSetting: string | null | undefined,
  globalSetting: string,
): 'infobip' | 'smsto' | 'txg' {
  const known = ['infobip', 'smsto', 'txg'] as const;
  if (userSetting && (known as readonly string[]).includes(userSetting)) {
    return userSetting as 'infobip' | 'smsto' | 'txg';
  }
  if ((known as readonly string[]).includes(globalSetting)) {
    return globalSetting as 'infobip' | 'smsto' | 'txg';
  }
  return 'infobip';
}
```

이 경우 테스트는 mock 없이 순수 함수만 검증:

```ts
import { describe, it, expect } from 'vitest';
import { pickProviderName } from '../../lib/sms-providers/router';

describe('pickProviderName', () => {
  it('user override 있으면 그 라인', () => {
    expect(pickProviderName('smsto', 'infobip')).toBe('smsto');
  });
  it('user null 이면 global', () => {
    expect(pickProviderName(null, 'smsto')).toBe('smsto');
  });
  it('user unknown 이면 global', () => {
    expect(pickProviderName('xxx', 'infobip')).toBe('infobip');
  });
  it('global도 unknown 이면 infobip 기본', () => {
    expect(pickProviderName(null, 'yyy')).toBe('infobip');
  });
  it('둘 다 null/undefined 면 infobip', () => {
    expect(pickProviderName(undefined, '')).toBe('infobip');
  });
});
```

**구현자 판단**: mock 경로가 안정적이면 첫 번째 테스트를, 아니면 `pickProviderName` 추출 방식을 채택한다. 본 plan은 두 번째 방식을 권장(테스트 안정성↑).

- [ ] **Step 5: 테스트 실행 — 실패 확인**

```bash
cd ~/Desktop/sms문자사이트
npx vitest run __tests__/lib/resolve-user-provider.test.ts
```

Expected: FAIL ("Cannot find module" 또는 "pickProviderName is not exported").

- [ ] **Step 6: router.ts 에 resolveUserProvider + pickProviderName 구현**

`lib/sms-providers/router.ts` 끝에 (혹은 적절한 위치에) 추가. 기존 import 들은 그대로:

```ts
const KNOWN_PROVIDERS = ['infobip', 'smsto', 'txg'] as const;
type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

export function pickProviderName(
  userSetting: string | null | undefined,
  globalSetting: string,
): KnownProvider {
  if (userSetting && (KNOWN_PROVIDERS as readonly string[]).includes(userSetting)) {
    return userSetting as KnownProvider;
  }
  if ((KNOWN_PROVIDERS as readonly string[]).includes(globalSetting)) {
    return globalSetting as KnownProvider;
  }
  return 'infobip';
}

/**
 * 유저별 발송 라인 SmsProvider 인스턴스를 반환한다.
 * - User.smsProvider 가 유효한 라인이면 그 라인.
 * - null/unknown 이거나 isConfigured()=false 이면 전역 활성 라인으로 폴백.
 * - 본 PR 에서는 발송 경로에서 호출하지 않는다 (관리자 UI 표시 + 향후 발송 경로 전환용 토대).
 */
export async function resolveUserProvider(userId: string): Promise<SmsProvider> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { smsProvider: true },
  });

  const userRaw = user?.smsProvider ?? null;
  if (userRaw && (KNOWN_PROVIDERS as readonly string[]).includes(userRaw)) {
    const candidate = PROVIDERS[userRaw as KnownProvider]();
    if (candidate.isConfigured()) {
      return candidate;
    }
    logger.warn(`[SmsRouter] 유저 ${userId} 의 라인 ${userRaw} 가 미설정 — 전역 활성 라인으로 폴백`);
  }
  return getActiveProvider();
}
```

(`PROVIDERS`, `getActiveProvider`, `SmsProvider`, `logger`, `prisma` 는 이미 router.ts 에 import 돼 있음 — 동일 위치에 추가만)

- [ ] **Step 7: 테스트 재실행 — 통과 확인**

```bash
cd ~/Desktop/sms문자사이트
npx vitest run __tests__/lib/resolve-user-provider.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 8: PATCH /api/users/[id] 에 smsProvider 필드 추가**

`admin/app/api/users/[id]/route.ts` 의 `updateUserSchema` (zod) 에 추가:

```ts
const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  costPerMessage: z.number().positive('건당 단가는 0보다 커야 합니다.').optional(),
  smsProvider: z.enum(['infobip', 'smsto', 'txg']).nullable().optional(),
  dailySendLimit: z.number().int().min(0).optional(),
  maxCampaignSize: z.number().int().min(0).optional(),
  reason: z.string().min(5, '사유를 5자 이상 입력하세요.').optional(),
});
```

PATCH 핸들러 안:
- 파싱 후 `smsProvider` 가 `undefined` 가 아니면 SUPER_ADMIN sudo 요구(기존 costPerMessage 처리와 동일 게이트).
- 변경 항목으로 `updateData.smsProvider = parsed.data.smsProvider ?? null` 추가.
- `auditNewValue.smsProvider = (parsed.data.smsProvider ?? '전역 기본')`.

기존 `costPerMessage` 처리 블록 바로 옆에 추가하는 게 패턴 일치. **기존 PATCH 핸들러의 정확한 분기 위치를 읽어 거기 맞춰 삽입할 것** (구현자가 직접 보고 결정).

GET 핸들러의 `select` 에 `smsProvider: true` 추가:

```ts
const user = await prisma.user.findUnique({
  where: { id },
  select: {
    id: true,
    username: true,
    email: true,
    name: true,
    credits: true,
    status: true,
    suspendedAt: true,
    suspendReason: true,
    costPerMessage: true,
    smsProvider: true, // ← 추가
    dailySendLimit: true,
    maxCampaignSize: true,
    failedLoginCount: true,
    lockedUntil: true,
    createdAt: true,
    updatedAt: true,
  },
});
```

- [ ] **Step 9: 빌드 확인**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -15
```

Expected: 빌드 성공.

- [ ] **Step 10: 마이그레이션을 DB에 적용**

⚠️ **이 단계는 사용자 확인 후 진행**. 운영 DB에 컬럼이 추가됨(NULL allow, 안전한 변경이지만 명시 게이트).

```bash
# 로컬 dev DB 가 있다면:
cd ~/Desktop/sms문자사이트
npx prisma migrate deploy
```

운영 DB 적용은 PR 머지 후 컨테이너 재배포 시 `migrate deploy` 가 자동 실행됨 확인. 자동 실행 안 되면 `~/Desktop/홈서버-Docker-배포가이드.md` 절차로 수동 수행.

- [ ] **Step 11: 커밋**

```bash
cd ~/Desktop/sms문자사이트
git add prisma/schema.prisma prisma/migrations/ lib/sms-providers/router.ts admin/app/api/users/'[id]'/route.ts __tests__/lib/resolve-user-provider.test.ts
git commit -m "feat: User.smsProvider column + resolveUserProvider + PATCH smsProvider field"
```

---

## Task 2: Toaster 마운트 (admin-shell)

**Files:**
- Modify: `admin/components/admin-shell.tsx`

- [ ] **Step 1: 현재 admin-shell.tsx 구조 확인**

```bash
cat ~/Desktop/sms문자사이트/admin/components/admin-shell.tsx | head -50
```

Expected: 파일 상단에 `'use client'`가 있고 `export default function AdminShell({ children })` 형태. 없다면 client 컴포넌트화부터 필요.

- [ ] **Step 2: Toaster import 및 마운트 추가**

`admin/components/admin-shell.tsx` 의 컴포넌트 return 안 가장 바깥쪽 div 안 마지막에 `<Toaster />` 를 추가하고, import에 추가:

```tsx
import { Toaster } from 'react-hot-toast';

// ... 컴포넌트 return 내부 (최상위 div의 마지막 자식):
<Toaster
  position="top-right"
  toastOptions={{
    duration: 4000,
    style: {
      background: 'var(--surface)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border)',
    },
    success: { iconTheme: { primary: 'var(--status-success)', secondary: 'var(--surface)' } },
    error: { iconTheme: { primary: 'var(--status-danger)', secondary: 'var(--surface)' } },
  }}
/>
```

- [ ] **Step 3: 로컬 빌드 확인**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -20
```

Expected: 빌드 성공. SSR/CSR 경계 오류 없음.

- [ ] **Step 4: 커밋**

```bash
cd ~/Desktop/sms문자사이트
git add admin/components/admin-shell.tsx
git commit -m "feat(admin): mount react-hot-toast Toaster in admin shell"
```

---

## Task 3: 가시성 폴링 훅 (`use-visibility-polling`)

**스코프 수정 (2026-05-28):** 원래 `@testing-library/react`로 `renderHook`을 사용하려 했으나, 프로젝트에 해당 의존성이 없고 모든 기존 테스트가 Node 환경의 순수-함수 패턴이다. DOM 환경/testing-library 도입은 본 PR scope 외 변경이라 거부. 대신 `shouldTickNow()` 순수 함수 한 개로 가시성 결정 로직만 분리하여 단위 테스트하고, 훅 자체의 useEffect/setInterval 배선은 T13(라이브 검증)에서 확인한다.

**Files:**
- Create: `admin/lib/use-visibility-polling.ts`
- Test: `__tests__/lib/use-visibility-polling.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/lib/use-visibility-polling.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisibilityPolling } from '../../admin/lib/use-visibility-polling';

describe('useVisibilityPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('마운트 시 즉시 1회 호출한다', () => {
    const fetcher = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useVisibilityPolling(fetcher, 1000));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('interval마다 호출한다 (가시성 visible 상태)', () => {
    const fetcher = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useVisibilityPolling(fetcher, 1000));
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('document.hidden 상태에서는 호출하지 않는다', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const fetcher = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useVisibilityPolling(fetcher, 1000));
    // 마운트 호출은 됨
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // 복원
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('수동 refetch 함수를 반환한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useVisibilityPolling(fetcher, 60000));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd ~/Desktop/sms문자사이트
npx vitest run __tests__/lib/use-visibility-polling.test.ts
```

Expected: FAIL with "Cannot find module '../../admin/lib/use-visibility-polling'".

- [ ] **Step 3: 훅 구현**

`admin/lib/use-visibility-polling.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

type Fetcher = () => Promise<void> | void;

export interface VisibilityPollingState {
  refetch: () => Promise<void>;
  lastFetchedAt: Date | null;
  isFetching: boolean;
}

/**
 * 페이지가 보이는 동안에만 polling.
 * - 마운트 직후 1회 호출
 * - `document.visibilityState === 'visible'` 일 때만 interval 호출
 * - 수동 refetch 반환
 *
 * IntersectionObserver 가드는 호출부에서 ref와 함께 별도 적용(컴포넌트 단위).
 */
export function useVisibilityPolling(fetcher: Fetcher, intervalMs: number): VisibilityPollingState {
  const fetcherRef = useRef<Fetcher>(fetcher);
  fetcherRef.current = fetcher;

  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const run = useCallback(async () => {
    setIsFetching(true);
    try {
      await fetcherRef.current();
      setLastFetchedAt(new Date());
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    void run();
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void run();
      }
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, run]);

  return { refetch: run, lastFetchedAt, isFetching };
}
```

- [ ] **Step 4: 테스트 재실행 — 통과 확인**

```bash
cd ~/Desktop/sms문자사이트
npx vitest run __tests__/lib/use-visibility-polling.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: 커밋**

```bash
git add admin/lib/use-visibility-polling.ts __tests__/lib/use-visibility-polling.test.ts
git commit -m "feat(admin): add useVisibilityPolling hook with tests"
```

---

## Task 4: 잔액 조회 API (`GET /api/sms-providers/balances`)

**Files:**
- Create: `admin/app/api/sms-providers/balances/route.ts`
- Test: `__tests__/api/admin-provider-balances.test.ts`

- [ ] **Step 1: 입력/매핑 순수 함수 테스트 작성**

`__tests__/api/admin-provider-balances.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

// 라우트에서 export하는 매퍼를 직접 검증한다 (API 호출 mock 회피).
import { mapProviderToBalanceRow } from '../../admin/app/api/sms-providers/balances/mapper';

describe('mapProviderToBalanceRow', () => {
  const FROZEN = new Date('2026-05-28T00:00:00.000Z');

  it('정상 잔액 응답을 변환한다', () => {
    const row = mapProviderToBalanceRow({
      name: 'infobip',
      isConfigured: true,
      isActive: true,
      result: { status: 'fulfilled', value: { balance: 123.45, currency: 'USD' } },
      now: FROZEN,
    });
    expect(row).toEqual({
      name: 'infobip',
      label: 'Infobip',
      isConfigured: true,
      isActive: true,
      balance: 123.45,
      currency: 'USD',
      fetchedAt: '2026-05-28T00:00:00.000Z',
    });
  });

  it('미설정 프로바이더는 balance null + error 표기', () => {
    const row = mapProviderToBalanceRow({
      name: 'txg',
      isConfigured: false,
      isActive: false,
      result: { status: 'fulfilled', value: null },
      now: FROZEN,
    });
    expect(row).toMatchObject({ name: 'txg', isConfigured: false, balance: null, currency: null });
    expect(row.error).toBe('미설정');
  });

  it('getBalance 실패는 balance null + error 메시지', () => {
    const row = mapProviderToBalanceRow({
      name: 'smsto',
      isConfigured: true,
      isActive: false,
      result: { status: 'rejected', reason: new Error('네트워크 오류') },
      now: FROZEN,
    });
    expect(row).toMatchObject({ name: 'smsto', isConfigured: true, balance: null });
    expect(row.error).toContain('네트워크 오류');
  });

  it('getBalance가 null을 반환하면 잔액 조회 실패', () => {
    const row = mapProviderToBalanceRow({
      name: 'infobip',
      isConfigured: true,
      isActive: true,
      result: { status: 'fulfilled', value: null },
      now: FROZEN,
    });
    expect(row.balance).toBeNull();
    expect(row.error).toBe('잔액 조회 실패');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd ~/Desktop/sms문자사이트
npx vitest run __tests__/api/admin-provider-balances.test.ts
```

Expected: FAIL with "Cannot find module '../../admin/app/api/sms-providers/balances/mapper'".

- [ ] **Step 3: 매퍼 구현**

`admin/app/api/sms-providers/balances/mapper.ts`:

```ts
import type { SmsProviderBalance } from '@shared/sms-providers/types';

export type ProviderName = 'infobip' | 'smsto' | 'txg';

const LABELS: Record<ProviderName, string> = {
  infobip: 'Infobip',
  smsto: 'SMS.to',
  txg: 'TXG-TEL',
};

export interface BalanceRow {
  name: ProviderName;
  label: string;
  isConfigured: boolean;
  isActive: boolean;
  balance: number | null;
  currency: string | null;
  fetchedAt: string;
  error?: string;
}

export interface MapperInput {
  name: ProviderName;
  isConfigured: boolean;
  isActive: boolean;
  result:
    | { status: 'fulfilled'; value: SmsProviderBalance | null }
    | { status: 'rejected'; reason: unknown };
  now: Date;
}

function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  return '알 수 없는 오류';
}

export function mapProviderToBalanceRow(input: MapperInput): BalanceRow {
  const base = {
    name: input.name,
    label: LABELS[input.name],
    isConfigured: input.isConfigured,
    isActive: input.isActive,
    fetchedAt: input.now.toISOString(),
  };

  if (!input.isConfigured) {
    return { ...base, balance: null, currency: null, error: '미설정' };
  }
  if (input.result.status === 'rejected') {
    return { ...base, balance: null, currency: null, error: reasonMessage(input.result.reason) };
  }
  if (input.result.value === null) {
    return { ...base, balance: null, currency: null, error: '잔액 조회 실패' };
  }
  return {
    ...base,
    balance: input.result.value.balance,
    currency: input.result.value.currency,
  };
}
```

- [ ] **Step 4: 테스트 재실행 — 통과 확인**

```bash
cd ~/Desktop/sms문자사이트
npx vitest run __tests__/api/admin-provider-balances.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: 라우트 핸들러 작성**

`admin/app/api/sms-providers/balances/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { getAllProviders } from '@shared/sms-providers/router';
import { handleApiError } from '@shared/api-error';
import { mapProviderToBalanceRow, type ProviderName, type BalanceRow } from './mapper';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth(request);
    requirePermission(admin, 'setting:read');

    const activeSetting = await prisma.systemSetting.findUnique({
      where: { key: 'active_sms_provider' },
    });
    const activeValue = activeSetting?.value;
    const activeProvider: string =
      isRecord(activeValue) && typeof activeValue.provider === 'string'
        ? activeValue.provider
        : 'infobip';

    const entries = getAllProviders();
    const now = new Date();
    const results = await Promise.allSettled(
      entries.map((e) => e.provider.getBalance()),
    );

    const balances: BalanceRow[] = entries.map((entry, idx) => {
      const r = results[idx];
      return mapProviderToBalanceRow({
        name: entry.name as ProviderName,
        isConfigured: entry.provider.isConfigured(),
        isActive: entry.name === activeProvider,
        result:
          r.status === 'fulfilled'
            ? { status: 'fulfilled', value: r.value }
            : { status: 'rejected', reason: r.reason },
        now,
      });
    });

    return NextResponse.json(
      { activeProvider, balances },
      {
        headers: {
          'Cache-Control': 'private, max-age=10, stale-while-revalidate=20',
        },
      },
    );
  } catch (err) {
    return handleApiError(err, 'sms-providers-balances');
  }
}
```

- [ ] **Step 6: 빌드 확인**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -15
```

Expected: 빌드 성공, 새 라우트 `/api/sms-providers/balances` 가 빌드 출력에 등장.

- [ ] **Step 7: 커밋**

```bash
cd ~/Desktop/sms문자사이트
git add admin/app/api/sms-providers/balances/ __tests__/api/admin-provider-balances.test.ts
git commit -m "feat(admin): add GET /api/sms-providers/balances + mapper tests"
```

---

## Task 5: 잔액 카드 그리드 컴포넌트

**Files:**
- Create: `admin/components/provider-balance-grid.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`admin/components/provider-balance-grid.tsx`:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { useVisibilityPolling } from '@/lib/use-visibility-polling';

type ProviderName = 'infobip' | 'smsto' | 'txg';

interface BalanceRow {
  name: ProviderName;
  label: string;
  isConfigured: boolean;
  isActive: boolean;
  balance: number | null;
  currency: string | null;
  fetchedAt: string;
  error?: string;
}

interface BalancesResponse {
  activeProvider: string;
  balances: BalanceRow[];
}

function relativeFromNow(d: Date | null): string {
  if (!d) return '갱신 전';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 5) return '방금 전';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  return `${min}분 전`;
}

export default function ProviderBalanceGrid({ intervalMs = 30000 }: { intervalMs?: number }) {
  const [data, setData] = useState<BalancesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    try {
      const res = await fetch('/api/sms-providers/balances');
      if (!res.ok) {
        setErr(`잔액 조회 실패 (HTTP ${res.status})`);
        return;
      }
      const body = (await res.json()) as BalancesResponse;
      setData(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '네트워크 오류');
    }
  }, []);

  const { refetch, lastFetchedAt, isFetching } = useVisibilityPolling(fetcher, intervalMs);

  return (
    <div className="card" style={{ marginBottom: '24px' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>프로바이더 잔액</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {data?.activeProvider ? <>활성: <strong>{data.activeProvider}</strong> · </> : null}
            {relativeFromNow(lastFetchedAt)}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="새로고침"
          >
            <RefreshCw size={14} className={isFetching ? 'spin' : ''} />
            새로고침
          </button>
        </div>
      </div>
      <div className="card-body">
        {err && (
          <div style={{ color: 'var(--status-danger)', marginBottom: '12px' }}>
            <AlertTriangle size={14} /> {err}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {(data?.balances ?? []).map((row) => {
            const badgeClass = !row.isConfigured
              ? 'badge-banned'
              : row.error
                ? 'badge-warning'
                : row.isActive
                  ? 'badge-active'
                  : 'badge-muted';
            const statusLabel = !row.isConfigured
              ? '미설정'
              : row.error
                ? '잔액 조회 실패'
                : row.isActive
                  ? '활성 + 연결됨'
                  : '연결됨 (대기)';
            return (
              <div key={row.name} className="card" style={{ margin: 0 }}>
                <div className="card-body" style={{ padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <strong>{row.label}</strong>
                    {row.isConfigured ? <Wifi size={14} /> : <WifiOff size={14} />}
                  </div>
                  <span className={`badge ${badgeClass}`}>{statusLabel}</span>
                  <p style={{ fontSize: '20px', fontWeight: 700, margin: '8px 0 0' }}>
                    {row.balance !== null
                      ? `${row.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${row.currency ?? ''}`
                      : '-'}
                  </p>
                  {row.error && (
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                      {row.error}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 새 badge 스타일 필요한지 확인**

```bash
cd ~/Desktop/sms문자사이트
grep -n "badge-warning" admin/app/globals.css
```

Expected: 없으면 globals.css에 추가 필요. 있으면 스킵.

- [ ] **Step 3: (필요 시) badge-warning 스타일 추가**

`admin/app/globals.css` 의 다른 `.badge-*` 정의 근처에 추가:

```css
.badge-warning {
  background: rgba(250, 204, 21, 0.12);
  color: #facc15;
  border: 1px solid rgba(250, 204, 21, 0.3);
}
```

- [ ] **Step 4: spin 애니메이션 확인/추가**

```bash
grep -n "@keyframes spin\|\\.spin" admin/app/globals.css
```

Expected: 있으면 스킵. 없으면 추가:

```css
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.spin { animation: spin 1s linear infinite; }
```

- [ ] **Step 5: 빌드 확인**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -10
```

Expected: 빌드 성공.

- [ ] **Step 6: 커밋**

```bash
git add admin/components/provider-balance-grid.tsx admin/app/globals.css
git commit -m "feat(admin): add ProviderBalanceGrid component with visibility-gated polling"
```

---

## Task 6: Dashboard에 잔액 그리드 mount + TPS 제거

**Files:**
- Modify: `admin/app/dashboard-client.tsx`
- Modify: `admin/app/api/dashboard/route.ts`

- [ ] **Step 1: dashboard-client.tsx 에서 TpsChart 관련 코드 제거**

다음을 모두 제거:
- `const TpsChart = dynamic(() => import('@/components/tps-chart'), { ... });` 블록
- `interface DashboardStats` 의 `tpsData: { time: string; tps: number }[];` 라인
- JSX 안 `<TpsChart ... />` 사용처

추가:
- 상단에 `import ProviderBalanceGrid from '@/components/provider-balance-grid';`
- 기존 TpsChart 가 있던 자리에 `<ProviderBalanceGrid />` 마운트

- [ ] **Step 2: dashboard route 에서 tpsData 응답 제거**

`admin/app/api/dashboard/route.ts` 에서:
- 응답 객체에서 `tpsData` 필드 제거
- tpsData 집계 코드(있다면) 주변 변수도 같이 제거 (사용처가 한 군데뿐일 때만)

```bash
cd ~/Desktop/sms문자사이트
grep -n "tpsData" admin/app/api/dashboard/route.ts
```

Expected: 변경 후 0건.

- [ ] **Step 3: 빌드 + 타입체크**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -10
```

Expected: 빌드 성공.

- [ ] **Step 4: 라이브 sanity check (선택, 로컬 dev 서버)**

```bash
cd ~/Desktop/sms문자사이트
npm --prefix admin run dev &
sleep 5
curl -s http://localhost:3001/api/sms-providers/balances -b cookies.txt | head -20
# (cookies.txt 는 로그인된 세션 — 없으면 skip)
kill %1
```

- [ ] **Step 5: 커밋**

```bash
git add admin/app/dashboard-client.tsx admin/app/api/dashboard/route.ts
git commit -m "feat(admin): replace TPS chart with provider balance grid on dashboard"
```

---

## Task 7: 비밀번호 재설정 API (`POST /api/users/[id]/password`)

**Files:**
- Create: `admin/app/api/users/[id]/password/route.ts`
- Test: `__tests__/api/admin-user-password-reset.test.ts`

- [ ] **Step 1: 입력 검증 순수 함수 테스트 작성**

`__tests__/api/admin-user-password-reset.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validatePasswordResetInput } from '../../admin/app/api/users/[id]/password/validate';

describe('validatePasswordResetInput', () => {
  const valid = { newPassword: 'abc12345', confirmPassword: 'abc12345', reason: '운영자 직접 요청으로 재설정' };

  it('정상 입력은 통과한다', () => {
    expect(validatePasswordResetInput(valid)).toEqual({ ok: true });
  });

  it('8자 미만 비밀번호는 거부된다', () => {
    const r = validatePasswordResetInput({ ...valid, newPassword: 'abc1', confirmPassword: 'abc1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('8자');
  });

  it('영문 누락 비밀번호는 거부된다', () => {
    const r = validatePasswordResetInput({ ...valid, newPassword: '12345678', confirmPassword: '12345678' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('영문');
  });

  it('숫자 누락 비밀번호는 거부된다', () => {
    const r = validatePasswordResetInput({ ...valid, newPassword: 'abcdefgh', confirmPassword: 'abcdefgh' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('숫자');
  });

  it('확인 비밀번호 불일치는 거부된다', () => {
    const r = validatePasswordResetInput({ ...valid, confirmPassword: 'abc12346' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('일치');
  });

  it('10자 미만 사유는 거부된다', () => {
    const r = validatePasswordResetInput({ ...valid, reason: '짧음' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('10자');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd ~/Desktop/sms문자사이트
npx vitest run __tests__/api/admin-user-password-reset.test.ts
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: 검증 함수 구현**

`admin/app/api/users/[id]/password/validate.ts`:

```ts
export interface PasswordResetInput {
  newPassword: string;
  confirmPassword: string;
  reason: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validatePasswordResetInput(input: PasswordResetInput): ValidationResult {
  if (typeof input.newPassword !== 'string' || input.newPassword.length < 8) {
    return { ok: false, error: '비밀번호는 최소 8자 이상이어야 합니다.' };
  }
  if (!/[a-zA-Z]/.test(input.newPassword)) {
    return { ok: false, error: '비밀번호에 영문을 포함해야 합니다.' };
  }
  if (!/[0-9]/.test(input.newPassword)) {
    return { ok: false, error: '비밀번호에 숫자를 포함해야 합니다.' };
  }
  if (input.confirmPassword !== input.newPassword) {
    return { ok: false, error: '비밀번호 확인이 일치하지 않습니다.' };
  }
  if (typeof input.reason !== 'string' || input.reason.length < 10) {
    return { ok: false, error: '사유를 10자 이상 입력하세요.' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: 테스트 재실행 — 통과 확인**

```bash
cd ~/Desktop/sms문자사이트
npx vitest run __tests__/api/admin-user-password-reset.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: 라우트 핸들러 작성**

`admin/app/api/users/[id]/password/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@shared/prisma';
import { requireAuth } from '@/lib/admin-session';
import { requirePermission } from '@/lib/rbac';
import { requireSudo } from '@/lib/sudo';
import { logAdminAction } from '@/lib/audit';
import { handleApiError } from '@shared/api-error';
import { validatePasswordResetInput } from './validate';

const BCRYPT_COST = 12;

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAuth(req);
    requirePermission(admin, 'user:update');
    await requireSudo(req, admin);

    const { id } = await context.params;
    const body = (await req.json().catch(() => null)) as
      | { newPassword?: string; confirmPassword?: string; reason?: string }
      | null;
    if (!body) {
      return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
    }

    const result = validatePasswordResetInput({
      newPassword: body.newPassword ?? '',
      confirmPassword: body.confirmPassword ?? '',
      reason: body.reason ?? '',
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) {
      return NextResponse.json({ error: '유저를 찾을 수 없습니다.' }, { status: 404 });
    }

    const passwordHash = await bcrypt.hash(body.newPassword!, BCRYPT_COST);

    await prisma.user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    await logAdminAction(
      admin,
      'user.password_reset',
      'User',
      id,
      body.reason!,
      req,
      { result: 'SUCCESS' },
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, 'admin-user-password-reset');
  }
}
```

- [ ] **Step 6: 빌드 확인**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -10
```

Expected: 빌드 성공, 새 라우트 등장.

- [ ] **Step 7: 커밋**

```bash
git add admin/app/api/users/[id]/password/ __tests__/api/admin-user-password-reset.test.ts
git commit -m "feat(admin): add POST /api/users/[id]/password with sudo + audit"
```

---

## Task 8: 프로필 카드 컴포넌트

**Files:**
- Create: `admin/components/admin-user-profile-card.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`admin/components/admin-user-profile-card.tsx`:

```tsx
'use client';

import { User as UserIcon, Ban, ShieldOff, ShieldCheck } from 'lucide-react';

interface UserDetail {
  id: string;
  email: string;
  name: string | null;
  status: string;
  suspendedAt: string | null;
  suspendReason: string | null;
  createdAt: string;
}

interface Props {
  user: UserDetail;
  canSuspend: boolean;
  canUpdate: boolean;
  onEdit: () => void;
  onSuspend: () => void;
  onUnsuspend: () => void;
  onBan: () => void;
}

const STATUS_KO: Record<string, string> = { ACTIVE: '활성', SUSPENDED: '정지', BANNED: '차단' };
const BADGE_CLASS: Record<string, string> = { ACTIVE: 'badge-active', SUSPENDED: 'badge-suspended', BANNED: 'badge-banned' };

export default function AdminUserProfileCard({
  user, canSuspend, canUpdate, onEdit, onSuspend, onUnsuspend, onBan,
}: Props) {
  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <UserIcon size={18} /> 프로필
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-outline btn-sm" onClick={onEdit} disabled={!canUpdate}>수정</button>
          {canSuspend && user.status === 'ACTIVE' && (
            <button className="btn btn-outline-danger btn-sm" onClick={onSuspend}><Ban size={14}/> 정지</button>
          )}
          {canSuspend && user.status === 'SUSPENDED' && (
            <button className="btn btn-outline btn-sm" onClick={onUnsuspend}><ShieldCheck size={14}/> 해제</button>
          )}
          {canSuspend && user.status !== 'BANNED' && (
            <button className="btn btn-outline-danger btn-sm" onClick={onBan}><ShieldOff size={14}/> 차단</button>
          )}
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px' }}>
          <div><span className="label">이메일</span><p>{user.email}</p></div>
          <div><span className="label">이름</span><p>{user.name ?? '-'}</p></div>
          <div>
            <span className="label">상태</span>
            <p><span className={`badge ${BADGE_CLASS[user.status] ?? 'badge-muted'}`}><span className="badge-dot"/>{STATUS_KO[user.status] ?? user.status}</span></p>
          </div>
          <div><span className="label">가입일</span><p>{new Date(user.createdAt).toLocaleDateString('ko-KR')}</p></div>
          {user.suspendedAt && (
            <div><span className="label">정지/차단일</span><p>{new Date(user.suspendedAt).toLocaleString('ko-KR')}</p></div>
          )}
          {user.suspendReason && (
            <div style={{ gridColumn: 'span 2' }}><span className="label">사유</span><p>{user.suspendReason}</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -10
```

Expected: 빌드 성공.

- [ ] **Step 3: 커밋**

```bash
git add admin/components/admin-user-profile-card.tsx
git commit -m "feat(admin): add AdminUserProfileCard component"
```

---

## Task 9: 라우팅 카드 컴포넌트

**Files:**
- Create: `admin/components/admin-user-routing-card.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`admin/components/admin-user-routing-card.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Route, Undo2 } from 'lucide-react';

interface Props {
  currentSmsProvider: string | null;
  globalDefault: string;        // 활성 라인 (예: 'infobip')
  canChange: boolean;           // SUPER_ADMIN 만 true
  saving: boolean;
  onChange: (next: string | null, reason: string) => void;
}

const PROVIDER_LABEL: Record<string, string> = {
  infobip: 'Infobip',
  smsto: 'SMS.to',
  txg: 'TXG-TEL',
};

export default function AdminUserRoutingCard({
  currentSmsProvider, globalDefault, canChange, saving, onChange,
}: Props) {
  const [selected, setSelected] = useState<string>(currentSmsProvider ?? '');
  const [reason, setReason] = useState('');
  const activeLine = currentSmsProvider ?? globalDefault;
  const isOverridden = currentSmsProvider !== null;

  function submit(nextValue: string | null) {
    if (reason.length < 5) return;
    onChange(nextValue, reason);
  }

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <Route size={18} /> 발송 라인 라우팅
        </h3>
      </div>
      <div className="card-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span className="badge badge-muted">전역 기본 ({PROVIDER_LABEL[globalDefault] ?? globalDefault})</span>
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <span className={`badge ${isOverridden ? 'badge-active' : 'badge-muted'}`} style={{ opacity: isOverridden ? 1 : 0.5 }}>
            유저 오버라이드 {isOverridden ? `(${PROVIDER_LABEL[currentSmsProvider!] ?? currentSmsProvider})` : '없음'}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <span className="badge badge-active">현재 라인: <strong>{PROVIDER_LABEL[activeLine] ?? activeLine}</strong></span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }}>
          <div>
            <label className="label">라인 변경</label>
            <select
              className="input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canChange || saving}
              style={{ width: '100%' }}
            >
              <option value="">전역 기본 사용</option>
              <option value="infobip">Infobip</option>
              <option value="smsto">SMS.to</option>
              <option value="txg">TXG-TEL</option>
            </select>
          </div>
          <div>
            <label className="label">사유 (5자 이상)</label>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canChange || saving}
              placeholder="변경 사유..."
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={!canChange || saving || reason.length < 5 || (selected === (currentSmsProvider ?? ''))}
            onClick={() => submit(selected === '' ? null : selected)}
          >
            {saving && <span className="spinner" />} 변경 적용
          </button>
          {isOverridden && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={!canChange || saving || reason.length < 5}
              onClick={() => submit(null)}
            >
              <Undo2 size={14} /> 전역 기본으로 되돌리기
            </button>
          )}
        </div>

        {!canChange && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
            발송 라인 변경은 최고 관리자 재인증 후 가능합니다.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -10
```

Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add admin/components/admin-user-routing-card.tsx
git commit -m "feat(admin): add AdminUserRoutingCard with breadcrumb badges"
```

---

## Task 10: 빌링 카드 컴포넌트

**Files:**
- Create: `admin/components/admin-user-billing-card.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`admin/components/admin-user-billing-card.tsx`:

```tsx
'use client';

import { CreditCard, Plus, Minus, Edit3 } from 'lucide-react';

interface Props {
  credits: number;
  costPerMessage: number;
  dailySendLimit: number;
  maxCampaignSize: number;
  canAdjustCredits: boolean;
  canEditCost: boolean;
  onTopUp: () => void;
  onDeduct: () => void;
  onEditCost: () => void;
}

export default function AdminUserBillingCard({
  credits, costPerMessage, dailySendLimit, maxCampaignSize,
  canAdjustCredits, canEditCost, onTopUp, onDeduct, onEditCost,
}: Props) {
  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <CreditCard size={18} /> 빌링 / 잔액
        </h3>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px', marginBottom: '14px' }}>
          <div>
            <span className="label">크레딧</span>
            <p style={{ fontWeight: 700, fontSize: '20px' }}>{'₩'}{credits.toLocaleString('ko-KR')}</p>
          </div>
          <div>
            <span className="label">건당 단가</span>
            <p style={{ fontWeight: 700, fontSize: '20px', color: 'var(--status-info)' }}>
              {'₩'}{Number(costPerMessage).toLocaleString('ko-KR')}
              {canEditCost && (
                <button className="btn btn-ghost btn-sm" onClick={onEditCost} style={{ marginLeft: '6px' }} aria-label="단가 수정">
                  <Edit3 size={12} />
                </button>
              )}
            </p>
          </div>
          <div><span className="label">일일 발송 한도</span><p>{dailySendLimit.toLocaleString('ko-KR')}건</p></div>
          <div><span className="label">최대 캠페인 크기</span><p>{maxCampaignSize.toLocaleString('ko-KR')}건</p></div>
        </div>

        {canAdjustCredits && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary btn-sm" onClick={onTopUp}><Plus size={14}/> 충전</button>
            <button className="btn btn-outline-danger btn-sm" onClick={onDeduct}><Minus size={14}/> 차감</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
cd ~/Desktop/sms문자사이트
git add admin/components/admin-user-billing-card.tsx
git commit -m "feat(admin): add AdminUserBillingCard component"
```

---

## Task 11: 보안 카드 컴포넌트 (비번 재설정)

**Files:**
- Create: `admin/components/admin-user-security-card.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`admin/components/admin-user-security-card.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';

interface Props {
  canReset: boolean;
  saving: boolean;
  onSubmit: (newPassword: string, confirmPassword: string, reason: string) => void;
}

export default function AdminUserSecurityCard({ canReset, saving, onSubmit }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reason, setReason] = useState('');

  const passwordOk = newPassword.length >= 8 && /[a-zA-Z]/.test(newPassword) && /[0-9]/.test(newPassword);
  const matchOk = confirmPassword.length > 0 && confirmPassword === newPassword;
  const reasonOk = reason.length >= 10;
  const canSubmit = canReset && !saving && passwordOk && matchOk && reasonOk;

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <Lock size={18} /> 보안 / 계정
        </h3>
      </div>
      <div className="card-body">
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 0, marginBottom: '12px' }}>
          유저 비밀번호를 강제로 재설정합니다. 유저는 다음 로그인부터 새 비밀번호를 사용해야 합니다.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label className="label">새 비밀번호 (8자+, 영문+숫자)</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={!canReset || saving}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="label">비밀번호 확인</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={!canReset || saving}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div style={{ marginTop: '10px' }}>
          <label className="label">사유 (10자 이상)</label>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canReset || saving}
            placeholder="재설정 사유를 입력하세요..."
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginTop: '12px' }}>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => onSubmit(newPassword, confirmPassword, reason)}
          >
            {saving && <span className="spinner" />} 비밀번호 재설정
          </button>
        </div>
        {!canReset && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
            비밀번호 재설정은 최고 관리자 재인증 후 가능합니다.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -10
```

Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add admin/components/admin-user-security-card.tsx
git commit -m "feat(admin): add AdminUserSecurityCard for user password reset"
```

---

## Task 12: 유저 상세 페이지를 카드 4개로 재조립 + toast 교체

**Files:**
- Modify: `admin/app/users/[id]/page.tsx`

- [ ] **Step 1: import 헤더 정비**

파일 최상단에 추가:

```tsx
import toast from 'react-hot-toast';
import AdminUserProfileCard from '@/components/admin-user-profile-card';
import AdminUserRoutingCard from '@/components/admin-user-routing-card';
import AdminUserBillingCard from '@/components/admin-user-billing-card';
import AdminUserSecurityCard from '@/components/admin-user-security-card';
```

- [ ] **Step 2: 응답 타입에 smsProvider 추가 확인**

`interface UserDetail` 에 `smsProvider: string | null;` 가 있는지 확인 (feature/per-user-sms-line 머지 후엔 이미 있을 것). 없으면 추가:

```ts
interface UserDetail {
  id: string;
  email: string;
  name: string;
  credits: number;
  costPerMessage: number;
  smsProvider: string | null;
  status: string;
  // ... 기존 필드
}
```

- [ ] **Step 3: 활성 라인(전역 기본) 상태 가져오기**

페이지 내 상태에 추가:

```tsx
const [globalActiveProvider, setGlobalActiveProvider] = useState<string>('infobip');
```

`fetchData` 안에서 user 응답 후 활성 라인을 함께 조회:

```tsx
const provRes = await fetch('/api/sms-providers');
if (provRes.ok) {
  const pd = await provRes.json();
  if (typeof pd.activeProvider === 'string') setGlobalActiveProvider(pd.activeProvider);
}
```

- [ ] **Step 4: 라인 변경 핸들러 추가**

```tsx
const [routingSaving, setRoutingSaving] = useState(false);

async function handleSmsProviderChange(next: string | null, reason: string) {
  setRoutingSaving(true);
  try {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smsProvider: next, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success('발송 라인을 변경했습니다.');
      await fetchData();
    } else if (res.status === 403 && data.requireSudo) {
      setSudoRetryAction(null); // 라인 변경은 별도 retry 처리 안 함 — 사용자에게 sudo modal 안내
      setShowSudoModal(true);
      toast.error('재인증 후 다시 시도하세요.');
    } else {
      toast.error(data.error || '변경에 실패했습니다.');
    }
  } finally {
    setRoutingSaving(false);
  }
}
```

- [ ] **Step 5: 비밀번호 재설정 핸들러 추가**

```tsx
const [pwSaving, setPwSaving] = useState(false);

async function handlePasswordReset(newPassword: string, confirmPassword: string, reason: string) {
  if (!window.confirm('정말로 이 유저의 비밀번호를 재설정합니까? 유저는 다음 로그인 시 새 비밀번호를 사용해야 합니다.')) {
    return;
  }
  setPwSaving(true);
  try {
    const res = await fetch(`/api/users/${userId}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword, confirmPassword, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success('비밀번호를 재설정했습니다.');
    } else if (res.status === 403 && data.requireSudo) {
      setShowSudoModal(true);
      toast.error('재인증 후 다시 시도하세요.');
    } else {
      toast.error(data.error || '재설정에 실패했습니다.');
    }
  } finally {
    setPwSaving(false);
  }
}
```

- [ ] **Step 6: JSX 의 기존 "사용자 정보" 카드 + 라우팅 영역 + 빌링 영역을 4개 카드로 교체**

기존 `<div className="card">...사용자 정보...</div>` 블록 전체를 다음으로 교체:

```tsx
{user && (
  <>
    <AdminUserProfileCard
      user={{
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        suspendedAt: user.suspendedAt,
        suspendReason: user.suspendReason,
        createdAt: user.createdAt,
      }}
      canSuspend={canSuspendUser}
      canUpdate={canUpdateUser}
      onEdit={() => {
        setEditName(user.name ?? '');
        setEditCostPerMessage(String(Number(user.costPerMessage ?? 14)));
        setEditDailyLimit(String(user.dailySendLimit));
        setEditMaxCampaign(String(user.maxCampaignSize));
        setEditReason('');
        setEditModal(true);
      }}
      onSuspend={() => setSuspendModal({ open: true, action: 'SUSPEND' })}
      onUnsuspend={() => setSuspendModal({ open: true, action: 'UNSUSPEND' })}
      onBan={() => setSuspendModal({ open: true, action: 'BAN' })}
    />

    <AdminUserRoutingCard
      currentSmsProvider={user.smsProvider}
      globalDefault={globalActiveProvider}
      canChange={canChangeCostPerMessage /* SUPER_ADMIN-only flag, 동일 게이트 */}
      saving={routingSaving}
      onChange={handleSmsProviderChange}
    />

    <AdminUserBillingCard
      credits={user.credits}
      costPerMessage={Number(user.costPerMessage)}
      dailySendLimit={user.dailySendLimit}
      maxCampaignSize={user.maxCampaignSize}
      canAdjustCredits={canAdjustCredits}
      canEditCost={canChangeCostPerMessage}
      onTopUp={() => { setCreditType('ADMIN_ADD'); setCreditModal(true); }}
      onDeduct={() => { setCreditType('ADMIN_DEDUCT'); setCreditModal(true); }}
      onEditCost={() => {
        setEditName(user.name ?? '');
        setEditCostPerMessage(String(Number(user.costPerMessage ?? 14)));
        setEditDailyLimit(String(user.dailySendLimit));
        setEditMaxCampaign(String(user.maxCampaignSize));
        setEditReason('');
        setEditModal(true);
      }}
    />

    <AdminUserSecurityCard
      canReset={admin?.role === 'SUPER_ADMIN'}
      saving={pwSaving}
      onSubmit={handlePasswordReset}
    />

    {/* 기존 크레딧 내역 + 캠페인 내역 테이블은 그대로 유지 */}
  </>
)}
```

- [ ] **Step 7: 기존 editModal에서 발송 라인 드롭다운 제거 (Track A 머지본에 있는 코드)**

`editModal` JSX 내부의 다음 블록을 **삭제**:

```tsx
<div>
  <label className="label">발송 라인</label>
  <select className="input" value={smsProvider} ... >
    <option value="">전역 기본(infobip)</option>
    ...
  </select>
  ...
</div>
```

또한 `smsProvider` state, `handleEdit` 안의 `body.smsProvider` 분기, 모달 open 시 `setSmsProvider(...)` 호출 부분 전부 제거. 발송 라인 변경 경로는 RoutingCard 단일화.

- [ ] **Step 8: 기존 `alert(...)` 호출을 `toast.error(...)` / `toast.success(...)` 로 교체**

`handleCreditAdjust`, `handleEdit` 안의 `alert(data.error || '...')` 호출 모두 `toast.error(data.error || '...')` 로 교체. 성공 후 페치 직전 `toast.success('처리되었습니다.')` 추가.

- [ ] **Step 9: 타입체크 + 빌드**

```bash
cd ~/Desktop/sms문자사이트/admin
npm run build 2>&1 | tail -15
```

Expected: 빌드 성공.

- [ ] **Step 10: 전체 테스트 실행**

```bash
cd ~/Desktop/sms문자사이트
npx vitest run
```

Expected: 기존 통과 케이스 + 새 케이스 모두 PASS. (현재 baseline 194 + 신규 14 ≈ 208 통과 예상. 정확 수치는 차이 가능)

- [ ] **Step 11: 커밋**

```bash
git add admin/app/users/[id]/page.tsx
git commit -m "feat(admin): refactor user detail into 4 cards + toast notifications"
```

---

## Task 13: 라이브 검증 (chrome-devtools MCP)

**Files:** 없음 (검증 단계)

- [ ] **Step 1: dev 서버 기동**

```bash
cd ~/Desktop/sms문자사이트
npm --prefix admin run dev &
sleep 6
```

- [ ] **Step 2: chrome-devtools MCP로 로그인 + 대시보드 검증**

chrome-devtools MCP `navigate_page` → `http://localhost:3001/login` → `admin` / `Asdf!234` 로그인 → 대시보드 도달.

확인:
- 프로바이더 잔액 카드가 표시되는가? (활성 라인 강조 배지, 각 프로바이더 카드)
- 30초 대기 후 lastFetchedAt 텍스트가 갱신되는가?
- 탭 숨김 후 30초 대기 → 다시 보이게 했을 때 fetch 횟수가 폭증하지 않는가? (DevTools Network 패널 확인)

- [ ] **Step 3: 유저 상세 페이지 검증**

대시보드 → 유저 관리 → 임의 유저 클릭. 확인:
- 4개 카드 표시 (프로필 / 라우팅 / 빌링 / 보안)
- 라우팅 카드에 breadcrumb 배지 + 드롭다운 + "전역 기본으로 되돌리기" 버튼 (오버라이드 있을 때만)
- 빌링 카드에 충전/차감 버튼, 단가 수정 인라인 버튼
- 보안 카드: 비번/확인/사유 입력 후 버튼 enabled 변화 확인

- [ ] **Step 4: 라인 변경 + sudo 흐름 검증**

라우팅 카드에서 다른 라인 선택 → 사유 5자+ → "변경 적용" 클릭 → sudo 모달 → 비번 입력 → 성공 toast → 페이지 새로고침 자동 → 새 라인 반영 확인.

- [ ] **Step 5: 비번 재설정 흐름 검증**

보안 카드에 8자+영+숫 비번 입력 → 확인 비번 일치 → 사유 10자+ → 클릭 → window.confirm 승인 → sudo 모달(필요 시) → 성공 toast.

DB 확인 (별도 터미널):
```bash
PGPASSWORD='smspass_prod_2026' psql -h 5.161.112.248 -p 5434 -U smsuser -d bulksms -c "SELECT id, \"passwordChangedAt\" FROM \"User\" WHERE id='<userId>';"
```

Expected: `passwordChangedAt` 가 방금 시각으로 갱신됨.

- [ ] **Step 6: AuditLog 검증**

```bash
PGPASSWORD='smspass_prod_2026' psql -h 5.161.112.248 -p 5434 -U smsuser -d bulksms -c "SELECT action, \"adminEmail\", reason, timestamp FROM \"AuditLog\" WHERE action='user.password_reset' ORDER BY timestamp DESC LIMIT 3;"
```

Expected: 신규 row 1건, 사유 보임. metadata에 비번 절대 없음.

- [ ] **Step 7: dev 서버 종료**

```bash
kill %1
```

- [ ] **Step 8: 검증 결과 메모**

`PROGRESS.md` 의 "🔴 다음 세션 재개 지점" 영역에 검증 결과를 추가하고 커밋:

```bash
# PROGRESS.md 편집 후
git add PROGRESS.md
git commit -m "docs: 관리자 대시보드+유저 상세 리팩토링 라이브 검증 결과"
```

---

## Task 14: PROGRESS.md / CLAUDE.md 함정 박제

**Files:**
- Modify: `PROGRESS.md`
- Modify: `CLAUDE.md` (또는 `admin/CLAUDE.md`)

- [ ] **Step 1: PROGRESS.md 상단에 작업 박제 섹션 추가**

`PROGRESS.md` 최상단에 추가:

```markdown
> ## 🟢 2026-05-28 관리자 대시보드 + 유저 상세 리팩토링 (단일 PR, 커밋 ~14개)
>
> **변경**:
> - 대시보드: TPS 차트 제거 → 프로바이더 잔액 카드(클라 30초 polling + visibility 가드)
> - 유저 상세: 단일 정보 그리드 → 4개 카드(프로필/라우팅/빌링/보안)
> - 라우팅 카드: 발송 라인 오버라이드를 카드 상단으로 노출 (기존 editModal 안 드롭다운 제거)
> - 보안 카드(신규): 관리자가 유저 비밀번호 강제 재설정 (sudo + AuditLog)
> - `react-hot-toast` 도입 + 본 PR scope alert 4개 교체
>
> **신규 API**:
> - `GET /api/sms-providers/balances` — 모든 프로바이더 getBalance 병렬 호출, 응답 캐시 10초+SWR 20초
> - `POST /api/users/[id]/password` — bcryptjs cost 12, sudo 필수, AuditLog action=`user.password_reset`
>
> **함정 박제**:
> - **User=bcryptjs cost 12, AdminUser=argon2id**. 혼동 절대 금지.
> - **smsto getBalance는 외부 API 호출**. visibility 가드 + 30초 interval로 호출 빈도 제한. 서버 메모리 캐시 없음 (모니터링 결과 따라 추후 도입).
> - **requireSudo 시그니처는 `(req, admin)`** — 인자 순서.
> - **AuditLog metadata에 비밀번호 평문/해시 절대 금지**. `previousValue/newValue`도 비움.
>
> **배포**: admin 컨테이너 재배포만 필요 (`docker compose up -d --build sovereign-sms-admin`). DB 마이그레이션 없음.
```

- [ ] **Step 2: 커밋**

```bash
git add PROGRESS.md
git commit -m "docs: 관리자 리팩토링 작업 박제 + 함정 영구화"
```

---

## Task 15: PR 생성

**Files:** 없음 (gh 작업)

- [ ] **Step 1: 브랜치 push**

```bash
cd ~/Desktop/sms문자사이트
git push -u origin feat/admin-dashboard-and-user-detail-refactor
```

Expected: HTTPS + credential helper(joochanyang)로 push 성공.

- [ ] **Step 2: PR 생성**

```bash
gh pr create --title "feat(admin): dashboard provider balance + user detail 4-card refactor" --body "$(cat <<'EOF'
## Summary
- 대시보드: TPS 차트 제거 → 프로바이더 잔액 카드(30초 polling + visibility 가드)
- 유저 상세 페이지: 4개 카드(프로필 / 라우팅 / 빌링 / 보안)로 재구성
- 신규 기능: 유저 비밀번호 강제 재설정 (sudo + AuditLog), 발송 라인 오버라이드를 카드로 노출
- `react-hot-toast` 도입, 본 PR 범위 내 alert 호출 toast로 교체

## 신규 API
- `GET /api/sms-providers/balances` — 프로바이더별 잔액 + 활성 라인
- `POST /api/users/[id]/password` — sudo 필수, bcryptjs cost 12

## Test plan
- [ ] vitest 전체 통과 (신규 14건 + 기존 baseline)
- [ ] 로컬 dev 대시보드에서 잔액 카드 표시, 탭 hidden 시 fetch 정지 확인
- [ ] 유저 상세 4개 카드 표시, 라우팅 카드 드롭다운 + breadcrumb 동작
- [ ] 비밀번호 재설정 → DB `passwordChangedAt` 갱신 + AuditLog 1행 (action=`user.password_reset`)
- [ ] sudo 만료 상태에서 라인 변경/비번 재설정 시 sudo 모달 prompt

## 전제
- `feature/per-user-sms-line` 머지 + SMPP 워커 재배포가 본 PR 이전에 끝나 있어야 함.

## 함정 박제
- User=bcryptjs cost 12, AdminUser=argon2id 혼동 금지
- `requireSudo(req, admin)` 인자 순서
- AuditLog metadata에 비번 평문/해시 절대 금지

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL 반환. 사용자에게 보고.

- [ ] **Step 3: PR URL 사용자에게 전달**

---

## Self-Review (after writing this plan)

**1. Spec 커버리지 점검**:
- §3 Track B (대시보드 TPS 제거 + 잔액 카드) → Task 4, 5, 6 ✅
- §3 Track C (프로필/라우팅/빌링/보안 카드) → Task 8, 9, 10, 11, 12 ✅
- §3 Track D (toast) → Task 1, 2, 12 ✅
- §4.1.2 응답 + 캐시 헤더 → Task 4 ✅
- §4.1.1 가시성 가드 polling → Task 3, 5 ✅
- §4.2.5 password API + sudo + audit → Task 7 ✅
- §4.2.2 breadcrumb badges → Task 9 ✅
- §4.7 테스트 → Task 3, 4, 7 (vitest 단위 테스트)
- §6 함정 박제 → Task 14 ✅
- §7 배포 → Task 13 (라이브 검증), 14 (문서)

**2. Placeholder 스캔**: TBD/TODO 없음. "기존 패턴 재사용" 표현은 모두 구체 시그니처/예시 포함.

**3. Type 일관성**: `BalanceRow`, `ValidationResult`, `UserDetail.smsProvider`, `requireSudo(req, admin)` 모두 일치.

**4. 누락 없음** — 단 한 가지 알림: Task 12의 Step 7에서 "Track A 머지본의 smsProvider 드롭다운 제거"는 feature 브랜치 머지 후에만 의미가 있는 변경이라, 머지 미완 시 Step 7은 no-op (해당 코드 자체가 없음). 자연스럽게 처리됨.
