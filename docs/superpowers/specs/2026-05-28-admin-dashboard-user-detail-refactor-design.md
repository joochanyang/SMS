# 관리자 대시보드 + 유저 상세 페이지 리팩토링 설계

- 작성일: 2026-05-28
- 작성자: Claude (with mr.joo)
- 상태: 사용자 검토 대기
- 대상 PR: `feat/admin-dashboard-and-user-detail-refactor` (가칭, 단일 PR)

## 1. 배경 및 목적

기존 관리자 패널 상태(2026-05-28 기준):
- 대시보드에 "Sending TPS (Last 1 Hour)" 차트가 있으나 운영상 가치보다는 시각 위주
- 유저 상세 페이지(`admin/app/users/[id]/page.tsx`)는 단일 정보 그리드 + 모달 기반 — 라우팅/빌링/보안 관심사가 분리돼 있지 않음
- `feature/per-user-sms-line` 브랜치에 유저별 발송 라인 오버라이드가 구현돼 있으나 드롭다운이 수정 모달 안에 숨겨져 있음 (UX 미달)
- 프로바이더 잔액 표시 UI 없음 (`getBalance()`는 모든 provider에 이미 구현됨)
- 유저 비밀번호 재설정 도구 없음 (현재는 토큰 메일 흐름만 있음)
- 액션 결과 피드백은 `alert()` 일색 — 모던 admin UX와 격차

본 설계는 다음 세 트랙을 한 PR로 묶어 처리한다.

## 2. 전제(Precondition)

- **Track A는 본 spec scope 외**: `feature/per-user-sms-line` 브랜치(커밋 12개)가 본 PR 이전에 main에 머지된 상태여야 한다. 이 spec은 `User.smsProvider` 컬럼, `PATCH /api/users/[id]` 의 smsProvider 필드, `lib/sms-providers/router.ts:resolveUserProvider`, `services/smpp-worker` 의 라인별 claim 로직이 main에 존재한다고 가정한다.
- Track A 머지 후 **SMPP 워커 컨테이너 재배포가 선결**되어야 한다(`poller.ts` 변경됨). 본 PR 작업자가 진행 전 확인.

## 3. 변경 범위 요약

### Track B — 대시보드
- 제거: `tps-chart.tsx` import/사용처(데이터, 컴포넌트, dynamic import 폴백). 컴포넌트 파일은 일단 유지(다른 화면 재사용 가능). 옵션으로 파일 삭제 가능.
- 추가: 프로바이더 잔액 카드 그리드. 활성 라인 강조 배지 + 각 프로바이더의 연결 상태 + 잔액/통화.

### Track C — 유저 상세 페이지
- 상단 정보 영역을 3개 섹션 카드로 재구성:
  1. **프로필 카드** — 기존 이메일/이름/상태 + 정지/차단 액션
  2. **라우팅 카드 (신규)** — 현재 활성 라인 표시 + 드롭다운으로 변경
  3. **빌링 카드** — 크레딧/단가/한도 + 충전·차감·단가수정 액션
- 신규 **보안 카드** — 유저 비밀번호 재설정 (관리자 권한)
- 기존 크레딧 내역 / 캠페인 내역 테이블은 그대로 유지

### Track D — 공통 UX
- `react-hot-toast` 도입. `<Toaster />`를 `admin-shell.tsx`에 mount.
- 모든 액션(`alert` 호출처 + 신규 액션)을 toast로 교체.

## 4. 상세 설계

### 4.1 Dashboard 프로바이더 잔액 카드

#### 4.1.1 컴포넌트: `admin/components/provider-balance-grid.tsx` (신규)

Props:
```ts
type Props = {
  // 폴링 간격(ms). 기본 30_000
  intervalMs?: number;
};
```

내부 동작:
- `useState<ProviderBalanceRow[]>` 보관
- `useEffect`로 컴포넌트 mount 시 1회 `fetch`
- `setInterval(intervalMs)` 으로 주기 refetch
- **가시성 가드 1 (`document.visibilityState`)**: `visibilitychange` 이벤트 구독. `hidden` 상태에서는 interval skip.
- **가시성 가드 2 (`IntersectionObserver`)**: 카드 컨테이너가 viewport 내 진입 시에만 polling 활성화. 50% threshold.
- 수동 "새로고침" 버튼 — 즉시 fetch + 1회성 spinner.
- `Date` 기준 마지막 갱신 시각 표시(상대시각 — "방금 전", "12초 전").

UI 구조:
```
┌─ 프로바이더 잔액 ─────────────────── [↻ 새로고침] ─┐
│ 활성 라인: [infobip]   마지막 갱신: 방금 전        │
│                                                    │
│ ┌── Infobip [활성] ──┐  ┌── SMS.to ──┐  ┌── TXG ──┐ │
│ │ 🟢 연결됨           │  │ 🟢 연결됨   │  │ 🔴 미설정 │ │
│ │ $123.45 USD        │  │ $4,500.00  │  │  -       │ │
│ │ ≈ 13,716 건         │  │ ≈ 500,000건 │  │          │ │
│ └────────────────────┘  └────────────┘  └─────────┘ │
└────────────────────────────────────────────────────┘
```

상태별 배지:
- `connected & active` — 녹색 배지 "활성 + 연결됨"
- `connected & inactive` — 회색 배지 "연결됨 (대기)"
- `configured & balance error` — 노랑 배지 "잔액 조회 실패"
- `not configured` — 빨강 배지 "미설정"

잔액 → 건수 환산: 활성 라인이거나 유저 단가가 정해진 경우 단가로 환산. 단가 알 수 없으면 `≈ N건` 부분 생략(잔액만 표시).

#### 4.1.2 API: `admin/app/api/sms-providers/balances/route.ts` (신규)

```
GET /api/sms-providers/balances
```

- 인증: `requireAuth` + `requirePermission(admin, 'setting:read')`
- 응답:
```ts
{
  activeProvider: string;
  balances: Array<{
    name: 'infobip' | 'smsto' | 'txg';
    label: string;          // PROVIDER_LABELS
    isConfigured: boolean;
    isActive: boolean;
    balance: number | null; // null = 미설정 또는 조회 실패
    currency: string | null;
    fetchedAt: string;      // ISO
    error?: string;         // 오류 메시지(있을 때)
  }>;
}
```
- 구현: 기존 `GET /api/sms-providers` 의 패턴 재사용 + 각 provider `getBalance()` 호출. 모든 호출은 `Promise.allSettled` — 하나가 실패해도 나머지는 응답.
- 응답 헤더: `Cache-Control: private, max-age=10, stale-while-revalidate=20` — 빠르게 새로고침 누른 경우 빠른 폴백, 30초 polling 압박 완화. **서버 메모리 캐시는 두지 않는다** (사용자 선택).
- 모든 호출은 `lib/audit.ts` 로그 대상이 아님 (read action).

#### 4.1.3 Dashboard 페이지 변경

`admin/app/dashboard-client.tsx`:
- TPS 관련 import / state / render 제거:
  - `const TpsChart = dynamic(...)` 제거
  - `interface DashboardStats.tpsData` 제거
  - TpsChart 렌더 부분 제거
- 자리(같은 위치)에 `<ProviderBalanceGrid />` 마운트.
- `interface ProviderStats` 영역(`PROVIDER_LABEL` 등)은 유지 — 24h/7d 통계 영역에서 계속 사용됨.

`admin/app/api/dashboard/route.ts`:
- 응답에서 `tpsData` 필드 제거 (선택). 데이터 수집 자체를 끊으면 cron/배치 영향 없는지 코드 확인. 영향 없다면 응답·집계 둘 다 제거. 영향 있으면 응답에서만 제거.

### 4.2 유저 상세 페이지 카드 재구성

기존 단일 "사용자 정보" 카드를 3개 카드로 분해. 그리드는 모바일 1열, 데스크탑 2열(`repeat(auto-fit, minmax(360px, 1fr))`).

#### 4.2.1 프로필 카드 (`admin-user-profile-card.tsx`)
- 표시: 이메일, 이름, 상태 배지, 가입일, (정지/차단 시) 사유·일시
- 액션 버튼: 수정(이름만), 정지, 정지 해제, 차단
- 기존 `editModal`은 단순화 → 이름·일일한도·캠페인한도 만. 단가는 빌링 카드로 이동.
- 기존 suspend/ban 모달은 그대로 사용.

#### 4.2.2 라우팅 카드 (`admin-user-routing-card.tsx`) — 신규
- 표시: 현재 active 라인 + 오버라이드 여부 표시
  - `[전역 기본] → infobip` (User.smsProvider 가 null)
  - `[유저 오버라이드] → txg` (User.smsProvider 가 'txg')
- 컨트롤:
  - 드롭다운 `<select>`: `전역 기본`, `infobip`, `smsto`, `txg`
  - "변경" 버튼 → confirm modal(사유 5자 이상) → sudo 재인증 흐름 → PATCH `/api/users/[id]` { smsProvider, reason }
  - "전역 기본으로 되돌리기" 버튼 = 드롭다운을 `전역 기본` 선택 + 즉시 변경
- 권한: 드롭다운 enable 조건 = `admin.role === 'SUPER_ADMIN'` (기존 feature 브랜치와 동일 게이트)
- 후방 호환: 기존 `editModal` 안의 발송라인 드롭다운은 **제거**한다. UX 단일화.

표시 디테일 (breadcrumb badge 요구사항):
```
현재 발송 라인
[전역 기본 (infobip)] → [유저 오버라이드] → [txg]
                             ↑ 비활성 (오버라이드 없으면 흐리게)
```
오버라이드가 있으면 두 번째 칸이 활성화돼 색상으로 강조.

#### 4.2.3 빌링 카드 (`admin-user-billing-card.tsx`)
- 표시: 크레딧(KRW), 건당 단가, 일일 발송 한도, 최대 캠페인 크기
- 액션:
  - `[+ 충전]` `[- 차감]` 버튼 — 기존 creditModal 그대로 사용 (변경 없음)
  - 건당 단가 옆 `[수정]` 인라인 버튼 — 단가 전용 미니 모달:
    - 입력: 새 단가(원, step=1, min=1) + 사유(5자+) + (SUPER_ADMIN sudo)
    - 호출: 기존 `PATCH /api/users/[id]` { costPerMessage, reason }
- 권한: 충전/차감 = `credit:adjust_*`, 단가 수정 = `SUPER_ADMIN`

#### 4.2.4 보안 카드 (`admin-user-security-card.tsx`) — 신규
유저(end-user) 비밀번호 재설정 전용 카드.

UI:
```
보안 / 계정
┌─────────────────────────────────────────┐
│ 마지막 비밀번호 변경: 2026-04-12         │
│                                         │
│ ┌ 비밀번호 재설정 ───────────────────┐  │
│ │ 새 비밀번호      [____________]    │  │
│ │ 비밀번호 확인    [____________]    │  │
│ │ 사유 (10자+)     [____________]    │  │
│ │                    [재설정]         │  │
│ └─────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

흐름:
1. 양식 작성 + "재설정" 버튼 클릭
2. 클라 검증: 8자+, 영문+숫자 1개씩, 일치 확인, 사유 10자+
3. confirm modal: "정말로 이 유저의 비밀번호를 재설정합니까? 유저는 다음 로그인 시 새 비밀번호를 사용해야 합니다."
4. POST `/api/users/[id]/password` { newPassword, reason, idempotencyKey } + sudo 헤더
5. 응답 처리:
   - 200 → toast "비밀번호가 재설정되었습니다." + 폼 리셋
   - 403 + requireSudo → sudo modal → 재시도
   - 그 외 → toast 에러
6. **유저 알림 옵션은 본 spec scope 외**. 추후 별도 PR (메일/SMS 전송 인프라 통합 필요).

#### 4.2.5 신규 API: `admin/app/api/users/[id]/password/route.ts`

```
POST /api/users/[id]/password
```

요청:
```ts
{
  newPassword: string;     // 8+ 영+숫
  reason: string;          // 10+
  idempotencyKey: string;  // UUID
}
```

처리:
1. `requireAuth` + `requirePermission(admin, 'user:update')`
2. **sudo 재인증 필수** — `requireSudo(admin, request)`. 미인증 시 `{ error, requireSudo: true }` + 403.
3. 입력 검증:
   - `newPassword.length >= 8`
   - `/[a-zA-Z]/.test(newPassword) && /[0-9]/.test(newPassword)` (기존 reset-password와 동일 규칙)
   - `reason.length >= 10`
4. Idempotency: 동일 `idempotencyKey` + 동일 `userId` + action=`user.password_reset` 인 `AuditLog` 가 최근 1시간 내 존재하면 200 반환(중복 방지). 별도 테이블 신설 안 함 — AuditLog.metadata.idempotencyKey 로만 추적. 조회 인덱스 부담은 1시간 + admin 액션 수 적으므로 무시.
5. `bcryptjs.hash(newPassword, 12)` (기존 register/reset과 동일 cost)
6. `prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() }})`
7. (옵션) 유저의 모든 활성 NextAuth 세션 무효화 — 현재 NextAuth 세션 무효화 메커니즘 확인 필요. 미구현 시 다음 로그인 시 자동 갱신되므로 본 PR scope 외.
8. `logAdminAction({ action: 'user.password_reset', resourceType: 'User', resourceId: userId, metadata: { reason, idempotencyKey }})` — **비밀번호 자체는 절대 로그에 남기지 않음**
9. 200 응답 `{ ok: true }`

권한 RBAC:
- 기존 `user:update` 권한 재사용. 별도 권한 `user:reset_password` 신설하지 않음 (이미 sudo + RBAC 이중 게이트).

### 4.3 react-hot-toast 도입

- 패키지: `react-hot-toast` (≈3KB). pnpm 또는 npm에 admin 워크스페이스만 설치.
- `admin/components/admin-shell.tsx`에 `<Toaster position="top-right" toastOptions={{ duration: 4000 }} />` 마운트.
- `alert()` 호출 모두 교체:
  - 유저 상세 페이지: `handleCreditAdjust`, `handleEdit`, 신규 password handler, 신규 routing handler
  - 다른 페이지(sms-providers, settings 등)는 본 PR scope 외 (다른 PR로). 다만 새로 작업하는 곳에선 toast 사용.

### 4.4 디자인 토큰 / 스타일

- 기존 글래스모피즘 다크 테마(`admin/app/globals.css`) 유지.
- 신규 카드는 `.card` + `.card-header` + `.card-body` 기존 클래스 재사용.
- 배지: 기존 `.badge`, `.badge-active`, `.badge-muted` 재사용. 새 클래스 필요 시 `.badge-warning`(노랑) 추가.
- breadcrumb 스타일(라우팅 카드): 새 `.routing-breadcrumb` 클래스 — 단순 inline-flex + `→` 구분자.
- 라이트/다크 모드 호환: 현재 admin은 다크 단일이라 별도 라이트 모드 작업 없음 (요청에는 있으나 admin 자체가 다크 전용 — scope 외).

### 4.5 권한(RBAC)

- 신규 액션은 기존 권한 매트릭스에 추가 권한 신설 없이 처리:
  - 잔액 조회: `setting:read` (기존)
  - 라인 변경: 기존 `user:update` + sudo(SUPER_ADMIN) (feature branch와 동일)
  - 비밀번호 재설정: `user:update` + sudo(SUPER_ADMIN)
  - 단가 수정: `user:update` + sudo(SUPER_ADMIN) (기존)

### 4.6 AuditLog 액션명 (신규)

- `user.password_reset` — { reason, idempotencyKey }
- (line override는 feature branch에서 이미 정의됨 — 그대로 사용)

### 4.7 테스트

#### 4.7.1 API 단위 테스트 (vitest)
- `__tests__/api/admin-provider-balances.test.ts`
  - 인증 없으면 401
  - 권한 없으면 403
  - infobip만 isConfigured일 때 응답 형태
  - getBalance 실패 시 partial 응답
- `__tests__/api/admin-user-password-reset.test.ts`
  - 비-sudo 시 403 + requireSudo
  - 짧은 비번 400
  - 영문/숫자 빠짐 400
  - 짧은 사유 400
  - 동일 idempotencyKey 재호출 시 1회만 hash + 1회만 audit
  - 성공 시 passwordChangedAt 갱신 + audit 기록

#### 4.7.2 컴포넌트 테스트 (가벼움)
- `provider-balance-grid.test.tsx`
  - 활성 라인 배지 표시
  - 미설정 프로바이더 빨강 배지
  - 가시성 hidden 시 fetch 안 일어남(타이머 mock)
- `admin-user-routing-card.test.tsx`
  - smsProvider=null 일 때 "전역 기본" 강조
  - SUPER_ADMIN 아닐 때 select disabled
- `admin-user-security-card.test.tsx`
  - 비번 불일치 시 버튼 disabled
  - 사유 미달 시 disabled

전체 vitest 기존 194/194 통과를 깨지 않음.

### 4.8 점진적 출시 / 롤백

- 본 PR은 단일 PR로 merge. 환경변수 토글 없음.
- 롤백 시: PR revert + admin 컨테이너 재배포만으로 복구. DB 마이그레이션 없음.
- (스키마 변경: 없음. `passwordChangedAt`는 이미 schema에 존재함.)

## 5. 비-목표(Out of Scope)

- 유저에게 비밀번호 재설정 사실 이메일/SMS 통보 — 별도 PR
- NextAuth 활성 세션 강제 종료(invalidate) — 별도 PR
- 다른 admin 페이지(sms-providers, settings, blacklist 등)의 alert→toast 교체 — 별도 PR
- 라이트 모드 — admin은 다크 전용 유지
- 대시보드 TPS 차트 데이터 수집 파이프라인 자체 제거 — 응답에서만 제거, 백엔드 집계는 유지 가능

## 6. 함정 / 주의사항 박제

- **smsto getBalance는 외부 API 호출 + 유료 가능성**. 30초 polling + 가시성 가드(visibilitychange + IntersectionObserver) 둘 다 반드시 적용.
- **react-hot-toast SSR 주의**: Next 16 App Router에서 `<Toaster />`는 클라이언트 컴포넌트. admin-shell.tsx 가 이미 `'use client'`인지 확인 → 아니면 별도 client wrapper로 격리.
- **비밀번호 hash cost 12 고정** — 기존 코드와 동일. 너무 낮추거나 높이면 안 됨.
- **AuditLog metadata에 비밀번호 평문/해시 절대 금지**. metadata 직렬화 전 자동 redact 가드 없음 — 호출부에서 보장.
- **CSRF/Origin 화이트리스트**: 신규 POST 라우트도 `proxy.ts`의 `ADMIN_ALLOWED_ORIGINS` 화이트리스트 통과해야 함. 변경 불필요 — 기존 라우트와 동일 path 패턴.
- **idempotencyKey 충돌**: 같은 idempotencyKey로 다른 newPassword 보내면 어떻게 처리? → 1회 처리된 키는 그대로 200 반환(첫 요청 result 캐시). hash 재계산 안 함. 호출부 책임.

## 7. 마이그레이션 / 배포

- DB 마이그레이션: 없음
- 환경변수 추가: 없음
- 외부 서비스 의존: 없음 (이미 등록된 infobip/smsto/txg)
- 배포 순서:
  1. Track A(feature/per-user-sms-line)가 main에 머지되고 SMPP 워커 재배포 완료된 상태인지 확인
  2. 본 PR 머지
  3. admin 컨테이너 재배포 (`docker compose up -d --build sovereign-sms-admin`)
  4. 라이브 검증: chrome MCP 또는 수동 — 대시보드 잔액 카드 표시 + 유저 상세 라우팅 카드 표시 + 비번 재설정 1회 dry-run

## 8. 위험 / 미해결 질문

- (해결됨) feature/per-user-sms-line 머지 시점 — 본 PR 이전 별도 PR로 처리
- (해결됨) Toast 라이브러리 — react-hot-toast
- (해결됨) Polling 방식 — 클라이언트 30초 + visibility 가드
- (해결됨) 비밀번호 리셋 대상 — 유저(end-user)
- (남은 위험) 라이브 환경에서 smsto/txg getBalance 호출 부담 측정 안 됨. 머지 후 1일 모니터링 — 호출 빈도 폭증 시 서버 측 캐시 도입(별도 hotfix).

## 9. 작업 분해 미리보기 (writing-plans 입력용)

1. react-hot-toast 패키지 설치 + Toaster mount + 기존 alert 4개 교체(스코프 내만)
2. `GET /api/sms-providers/balances` 라우트 + 테스트
3. `<ProviderBalanceGrid />` 컴포넌트 + 가시성 가드 + 테스트
4. Dashboard에 mount + TPS 제거
5. `<AdminUserRoutingCard />` + 기존 editModal에서 라인 드롭다운 제거
6. `<AdminUserProfileCard />` + `<AdminUserBillingCard />` (기존 정보 그리드 분해)
7. `POST /api/users/[id]/password` + 테스트
8. `<AdminUserSecurityCard />` + 컴포넌트 테스트
9. 유저 상세 페이지 전체를 4개 카드로 재구성하고 기존 모달들 연결
10. PROGRESS.md / CLAUDE.md 신규 함정·운영 절차 갱신
11. PR 본문 작성 + 라이브 검증 체크리스트

---

본 spec은 작성·자체 검토 직후 사용자 검토를 거친 뒤 `superpowers:writing-plans`로 구현 계획서 생성으로 이어진다.
