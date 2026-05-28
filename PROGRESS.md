# SMS 문자사이트 (SovereignSMS) 작업 진행 현황

> ## 🔴 다음 세션 재개 지점 (2026-05-29 PR #3 + PR #4 머지·재배포·라이브 검증 모두 완료)
>
> **재개 명령어**: `/clear` 후 "sms문자사이트 다음 작업" → 이 PROGRESS.md `🔴 다음 세션 재개 지점` 섹션부터
>
> ### 진행 상태 (감사 계획서 P0~P2 거의 전부 정리됨)
> - ✅ **PR #3 squash 머지**: `d16397a refactor(admin): users/[id] 페이지 모달 분해 + HTTP randomUUID 폴리필 (#3)` (2026-05-28 19:30 UTC)
> - ✅ **PR #4 squash 머지**: `37d7007 chore: 출시 후 잡정리 배치 (P1-2 ESLint + P2-3 archive + P2-5 .bkit) (#4)` (2026-05-28 19:34 UTC)
> - ✅ **서버 HEAD = `37d7007`**, admin 컨테이너 재빌드 → `Up (healthy)`, `Next.js 16.2.3 ✓ Ready` (2026-05-29 04:34 KST)
> - ✅ **라이브 검증 통과** (2026-05-29):
>   - PR #3 유저 정보 수정 / 건수 지급 모달 정상 동작 + sudo + AuditLog 기록 OK
>   - PR #3 HTTP 환경 멱등성 키 폴리필 정상 (Network 탭 `Idempotency-Key` 헤더 확인)
>   - PR #4 대시보드 프로바이더 잔액 카드 30초 polling 정상, Console에 `set-state-in-effect` 경고 0건
> - ✅ **머지된 stale 브랜치 4개 정리**: `feat/txg-bulk-send-ops`, `fix/admin-auth-hardening`, `fix/phase1-critical-issues`, `fix/txg-empty-source-addr` (로컬+원격)
>
> ### 감사 계획서 (`docs/2026-05-28-prelaunch-code-audit.md`) 잔여 정리 상태
> | 항목 | 처리 | 비고 |
> |---|---|---|
> | P0-1 (.env.bak 삭제) | ✅ | PR #2 |
> | P1-1 (tsc 4건) | ✅ | PR #2 |
> | P1-2 (ESLint set-state-in-effect) | ✅ **라이브** | PR #4 = React 19 `useEffectEvent` 패턴 |
> | P1-3 (tps-chart 삭제) | ✅ | PR #2 (단, `recharts` npm uninstall 은 보류) |
> | P1-4 (killSwitch state) | ✅ | PR #2 |
> | P2-2 (users/[id] 분해) | ✅ **라이브** | PR #3 = 630→323줄 + 모달 2개 + uuid 폴리필 |
> | P2-3 (옛 plan 9개 archive) | ✅ **라이브** | PR #4 |
> | P2-4 (stale 브랜치 5개) | ✅ 부분 | 머지된 4개 삭제 / `feature/per-user-sms-line` 보류 |
> | P2-5 (.bkit/, .env.bak* 잔여) | ✅ **라이브** | PR #4 |
> | P2-6 (_prisma_migrations 중복 row) | ✅ **보존 결정** | 조사 결과 Row 1 = `rolled_back_at=2026-05-28 06:00:18` 박힌 prisma 표준 패턴 (롤백된 시도 흔적 보존). 감사 보고서의 "NULL row 삭제" 명령은 prisma 표준 모르고 작성한 것 — **삭제 금지** |
>
> ### 다음에 할 수 있는 일 (출시 차단 요소 0, 전부 선택)
> 1. **`feature/per-user-sms-line` 브랜치 정리** (별도 결정 필요): 본 PR(=#1)이 라인 오버라이드의 최소 핵심만 흡수해서 옛 브랜치는 더 이상 머지 대상이 아님. 실제 발송 경로 라인별 전환(`campaign-processor`, SMPP 워커 라인별 claim, `SmsLog.providerName` 박제)은 별도 새 브랜치로 재작성 권장. 정리 명령: `git branch -D feature/per-user-sms-line && git push origin --delete feature/per-user-sms-line`
> 2. **CreditAdjustModal `dailyCreditLimit`/`usedToday` props 전달** — 현재 옵셔널이라 한도 검사 생략됨. CLAUDE.md "관리자 일일 지급 한도" 정책 활성이라면 연결 필요 (typescript-pro 검증 시 의심 항목으로 박제)
> 3. **(옵션) ADMIN 권한 게이트 회귀 테스트** — 일반 ADMIN 계정 1개 생성 후 비번 재설정 시도 → 403 (SUPER_ADMIN 게이트 검증). 미생성이면 스킵
> 4. **(옵션) PR #1 후속**: 발송 경로 라인별 전환 / 비번 재설정 시 유저 이메일·SMS 통보 / NextAuth 활성 세션 강제 종료(invalidate) / 다른 admin 페이지의 `alert()` → `toast` 일괄 교체 / `recharts` npm uninstall
>
> ---
>
> ## 🟢 2026-05-29 PR #3 + PR #4 머지·라이브 검증 완료
>
> **PR #3** `d16397a` — users/[id] 페이지 모달 2개 분해 + HTTP `randomUUID` 폴리필 (감사 P2-2)
> **PR #4** `37d7007` — P1-2 ESLint useEffectEvent + P2-3 옛 plan 9개 `docs/archive/` + P2-5 `.bkit/` 정리
>
> ### 배포 절차 검증 (다음 PR 때 그대로 재사용)
> ```bash
> # 1) 로컬 PR 머지 + sync
> gh pr merge <N> --squash --delete-branch --subject "<title> (#<N>)"
> git fetch origin && git pull --ff-only
>
> # 2) 서버 진단 (PR #3 때 함정 발견 — 아래 박제 참조)
> ssh root@5.161.112.248 'cd /opt/sovereign-sms && git fetch origin && git status --short && git log --oneline -2'
>
> # 3) 서버 git pull + admin 컨테이너만 재빌드 (smpp-worker / user 는 손대지 않음)
> ssh root@5.161.112.248 'cd /opt/sovereign-sms && git pull --ff-only && docker compose up -d --build sovereign-sms-admin'
>
> # 4) Healthcheck + HTTP smoke
> ssh root@5.161.112.248 'cd /opt/sovereign-sms && docker compose ps && docker compose logs --tail=10 sovereign-sms-admin'
> curl -sS -o /dev/null -w "/login HTTP=%{http_code}\n" http://5.161.112.248:3301/login           # 200
> curl -sS -o /dev/null -w "/api/auth/session HTTP=%{http_code}\n" http://5.161.112.248:3301/api/auth/session  # 401 (예상)
> ```
>
> ### 🚨 신규 함정 박제 — 서버-로컬 동시 작업 충돌 (PR #3 배포 시 발생)
> **증상**: 서버에서 `git pull --ff-only` 시 `error: The following untracked working tree files would be overwritten by merge`.
> **원인**: 사용자가 같은 변경을 로컬+서버 양쪽에서 동시 작업 → 로컬은 정식 PR로 머지됐고 서버엔 미커밋 채로 남음. `git pull`이 untracked overwrite 거부.
> **해결**:
> 1. **byte-by-byte diff 로 동일성 검증 먼저** (절대 무조건 reset 금지):
>    ```bash
>    diff <(git show <mergeCommit>:<path>) <path>; echo EXIT=$?
>    ```
>    EXIT=0 이면 동일. 다르면 서버에 사용자 작업이 있는 것 → 사용자 확인 필수.
> 2. 동일성 확인되면 안전 폐기 + pull:
>    ```bash
>    git checkout -- <modified files>          # M 항목 폐기
>    rm -f <untracked files>                   # ?? 항목 폐기
>    git pull --ff-only
>    ```
> **재발 방지**: 서버에서 직접 코드 편집 금지. 모든 변경은 로컬 → PR → 서버 git pull 경로만.
>
> ### 라이브 검증 결과 (2026-05-29)
> | 항목 | 결과 |
> |---|---|
> | PR #3 유저 정보 수정 모달 + sudo + AuditLog `USER_UPDATE` | ✅ |
> | PR #3 건수 지급/차감 모달 + 멱등성 키 발급 + AuditLog | ✅ |
> | PR #3 HTTP 환경 `randomUUID` 폴리필 동작 (Network 탭 `Idempotency-Key` 헤더 확인) | ✅ |
> | PR #4 대시보드 30초 polling 정상 (프로바이더 잔액 카드 자동 갱신) | ✅ |
> | PR #4 Console 에 `set-state-in-effect` 경고 0건 (React 19 `useEffectEvent` 패턴 효과) | ✅ |
> | admin 컨테이너 healthy / Next.js 16.2.3 Ready / `/login` 200 / `/api/auth/session` 401 | ✅ |
>
> ### 본 세션 추가로 박제할 사실
> - **CreditAdjustModal `dailyCreditLimit`/`usedToday` props 미전달**: typescript-pro 검증 시 발견. 모달은 옵셔널로 받아 0 폴백이라 한도 검사 생략. 의도면 무해, "관리자 일일 지급 한도" 정책 활성화하려면 부모(`users/[id]/page.tsx`)가 전달 필요.
> - **`recharts` npm 의존성 잔존**: 감사 P1-3 에서 `tps-chart.tsx` 는 PR #2 에서 삭제됐으나 `recharts` (^3.8.1) 는 양쪽 `package.json` 에 남아 있음. 사용처 0, bundle size 절감 가능. lock 갱신 필요해 별도 PR.
> - **`@types/bcryptjs` / `@vitejs/plugin-react` 검증 후 제거 가능**: 감사 P3-5 거짓양성 검증에서 도출.
>
> ---

> ## 🟢 2026-05-28 관리자 대시보드 + 유저 상세 리팩토링 (브랜치 `feat/admin-dashboard-and-user-detail-refactor`, 19 커밋)
>
> **변경**:
> - 대시보드: TPS 차트 제거 → 프로바이더 잔액 카드(클라 30초 polling + visibility 가드)
> - 유저 상세: 단일 정보 그리드 → 4개 카드(프로필/라우팅/빌링/보안)
> - 라우팅 카드: 발송 라인 오버라이드를 카드 상단 breadcrumb 으로 노출 (SUPER_ADMIN + sudo 필수)
> - **보안 카드(신규)**: 관리자가 유저 비밀번호 강제 재설정 (POST `/api/users/[id]/password`, SUPER_ADMIN + sudo + AuditLog)
> - `react-hot-toast` 도입 + 본 PR scope alert 4개 교체
> - **유저별 발송 라인 토대 흡수**(Track A 분기 충돌 회피): `User.smsProvider` 컬럼 + `pickProviderName` / `resolveUserProvider` export + PATCH 필드. 발송 경로 변경은 별도 후속 PR.
>
> **신규 API**:
> - `GET /api/sms-providers/balances` — 프로바이더 별 잔액 + 활성 라인. 응답 캐시 10초+SWR 20초. 미설정 프로바이더는 외부 HTTP 호출 스킵.
> - `POST /api/users/[id]/password` — SUPER_ADMIN + sudo 필수, bcryptjs cost 12, AuditLog action=`user.password_reset` (metadata에 비번 평문/해시 절대 없음)
>
> **신규 DB 마이그레이션** (이미 적용됨):
> - `20260528120000_add_user_sms_provider` — `User.smsProvider TEXT NULLABLE`. ⚠️ 컬럼이 이미 DB에 있어서(`feature/per-user-sms-line` 테스트 흔적) `prisma migrate resolve --applied` 로 마킹 처리함. 머지 후 서버 재배포 시 추가 작업 불필요.
>
> **함정 박제**:
> - **User=bcryptjs cost 12, AdminUser=argon2id**. 혼동 절대 금지. 비번 재설정 라우트는 User 대상이므로 bcryptjs.
> - **smsto getBalance는 외부 API 호출**. visibility 가드 + 30초 interval 둘 다 적용. 미설정 프로바이더는 fetch 자체 스킵.
> - **requireSudo 시그니처는 `(req, admin)`** — 인자 순서.
> - **AuditLog metadata에 비밀번호 평문/해시 절대 금지**. `previousValue/newValue`도 비움.
> - **User 모델에는 `passwordChangedAt` 컬럼 없음** (그건 AdminUser 전용). 시점은 AuditLog timestamp 로 확인.
> - **`feature/per-user-sms-line` 브랜치는 머지 안 함** — main 과 크게 분기돼 충돌. 본 PR 이 라인 오버라이드의 최소 핵심만 흡수. SmsLog 박제·campaign-processor 분기·SMPP 워커 라인별 claim 은 별도 후속 PR.
> - **신규 admin 페이지를 만들 때**: `'use client' + <></>` fragment + Sidebar/Header 직접 렌더 금지 (AdminShell 공통 layout 패턴, 2026-05-28 `0d81615`). T12 가 이걸 놓쳐 한 번 fix 함.
>
> **chrome MCP 라이브 검증**: 대시보드 잔액 카드 + 4 카드 + 활성 라인 표시 + sudo 403 분기 모두 동작 확인.
>
> **배포**: PR 머지 후 admin 컨테이너 재배포만 필요 (`docker compose up -d --build sovereign-sms-admin`). DB 마이그레이션은 이미 적용된 상태(prisma migrate resolve 로 마킹). 서버 재배포 시 `migrate deploy` 호출되더라도 `Database schema is up to date` 반환됨.
>
> **머지 상태 (2026-05-28 15:38 KST)**: squash 머지 완료 (`5840974`). 원격/로컬 feat 브랜치 삭제 완료. 서버 git pull 완료. admin 컨테이너 빌드+재시작 진행 중 → 완료 후 라이브 검증.

> ## 🟢 2026-05-28 출시 전 안전 클린업 (브랜치 `chore/prelaunch-cleanup`)
>
> **목표**: 발송·결제·인증 핵심 경로는 일절 안 건드리고 안전한 정리만.
>
> **감사 보고서**: `docs/2026-05-28-prelaunch-code-audit.md` (P0~P3 분류 + knip 거짓양성 검증 포함)
>
> **변경**:
> - 🔴 P0-1 **`.env.bak-1777043844`, `.env.bak-1777043904` 삭제** (루트 평문 키 백업 2개. git에는 없었지만 디스크에서 제거)
> - 🟠 P1-1 **logger.test.ts**: Node 22+ `NODE_ENV` readonly 호환 (`process.env.X = ...` / `delete` → `vi.stubEnv` / `vi.unstubAllEnvs`)
> - 🟠 P1-1 **루트 tsconfig.json**: `@shared/*` path alias 추가 (`__tests__/api/admin-provider-balances.test.ts` 가 admin mapper import 하느라 루트 tsc 가 mapper 따라가서 별칭 못 풀던 에러 fix)
> - 🟠 P1-3 **`admin/components/tps-chart.tsx` 삭제** (PR #1에서 대시보드에서 제거됐는데 파일은 남아 있던 dead code)
> - 🟠 P1-4 **`admin/app/sms-providers/page.tsx` killSwitch state 제거** (set만 하고 어디서도 읽지 않던 unused state. session 401 리다이렉트 효과는 그대로 유지)
>
> **회귀 검증**:
> - 루트 `tsc --noEmit`: 에러 4 → **0**
> - admin `tsc --noEmit`: **0** 유지
> - ESLint: warning 1 → **0** (남은 에러 1건 `dashboard-client.tsx:187` set-state-in-effect 는 의도적 보류 — 동작 정상이라 출시 후 별도 처리)
> - vitest: **198/198** 유지 (베이스라인 동일)
>
> **의도적으로 건드리지 않은 것**:
> - 큰 파일 4개(`users/[id]/page.tsx` 630줄, `sms-send/page.tsx` 726줄 등) — 라이브 회귀 위험이 커 출시 후 별도 PR
> - `dashboard-client.tsx` useEffect setState 경고 — 동작 정상이라 보류
> - 의존성 정리(`recharts`, `@types/bcryptjs`, `@vitejs/plugin-react`) — `package.json` 수정은 lock 갱신 필요해 출시 후 별도 PR
> - 옛 plan 문서 9개 `docs/archive/` 이동 — 출시와 무관
> - 로컬 stale 브랜치 5개 / `_prisma_migrations` 중복 row 1건 — 출시와 무관
>
> ---
>
> ## 📦 저장소 이전 (2026-05-28)
> **새 저장소**: `joochanyang/SMS` (https://github.com/joochanyang/SMS)
> **옛 저장소**: `joocy75-hash/infosms` — 더 이상 push 안 함, 그대로 보존
> **이전 시점 이전 PR/이슈 번호**(예: 본문의 "PR #3", "PR #12")는 **옛 저장소(joocy75-hash/infosms) 기준** — 새 저장소에는 해당 번호 없음
> git 히스토리는 전체 그대로 옮겨졌으므로 커밋 SHA는 동일

> ## 🟢 2026-05-28 admin 페이지 전환 깜빡임 제거 (`0d81615` main 머지, 서버 재배포 완료)
>
> **목표**: "반응속도 빠르고 로딩 느낌 안 받기"
>
> **원인 3가지**:
> 1. 모든 페이지가 자기 자신이 Sidebar/Header 렌더 → 전환마다 DOM 재마운트
> 2. 각 페이지 `if (!admin) return <풀스크린 spinner>` → 본문 통째로 가렸다가 다시 그림
> 3. Sidebar 링크가 `<a href> + e.preventDefault() + router.push()` → prefetch 0
>
> **Fix**:
> - `admin/components/admin-shell.tsx` (신규): Sidebar+Header를 layout 레벨에서 한 번만 마운트. admin 세션 정보는 sessionStorage 캐시(즉시 표시) + 30초 백그라운드 refresh
> - `admin/components/conditional-shell.tsx` (신규): `/login`·`/mfa-*` 는 AdminShell 안 끼움
> - `admin/app/layout.tsx`: `<ConditionalShell>` 으로 children 감쌈
> - `admin/components/sidebar.tsx`: `<a href>` → `<Link prefetch>` (soft navigation + 자동 prefetch)
> - `admin/lib/use-admin-info.ts` (신규): 페이지가 RBAC 판단용으로 admin role을 sessionStorage에서 즉시 읽는 훅
> - `admin/app/loading.tsx`: 풀스크린 spinner → 본문 영역 인라인 skeleton
> - 8개 페이지(dashboard/users/campaigns/credits/blacklist/templates/audit/settings/sms-providers): Sidebar/Header 중복 렌더 제거 + `if (!admin)` 분기 제거 + `<div admin-layout>` 외곽 제거 → `<></>` fragment
>
> **chrome MCP 라이브 검증**: 대시보드 진입 직후 8개 페이지 RSC가 백그라운드로 prefetch됨. 사이드바 메뉴 클릭 시 Sidebar/Header DOM uid 그대로 유지 + Header title만 자동 갱신 + 본문만 교체. 깜빡임 사실상 0
>
> ---
>
> ## 🟢 2026-05-28 admin 로그인 무한 redirect 영구 fix (`6b5e8a1` main 머지)
>
> ### 🔥 진짜 진짜 원인 (chrome-devtools MCP로 라이브 재현 후 확정)
> **`NODE_ENV=production` 환경에서 `secure=true` 쿠키를 HTTP 접속(`http://5.161.112.248:3301`)에서 발급 → 브라우저가 거부 → 다음 요청에 `admin_session` 쿠키 안 실림 → proxy.ts가 401/redirect → `/login` 무한 핑퐁**.
>
> 재현 시퀀스 (Chrome MCP `evaluate_script`):
> 1. `POST /api/auth/login` → 200 success
> 2. `document.cookie === ""` (쿠키 거부됨, Set-Cookie 무효)
> 3. `GET /api/auth/session` → 401
> 4. `GET /` → 307 → `/login?redirect=/`
>
> ### Fix (`6b5e8a1`)
> - `admin/lib/admin-session.ts` `cookieOptions()`: `ADMIN_SECURE_COOKIE=true|false` 명시 제어. 미설정 시 NODE_ENV 기반 (HTTPS 환경 안전)
> - 서버 `/opt/sovereign-sms/.env`: 옛 `FORCE_SECURE_COOKIE=false` (코드에서 더 이상 안 읽음) → `ADMIN_SECURE_COOKIE=false` 로 정정
> - 라이브 검증: chrome-devtools로 admin/Asdf!234 로그인 → 대시보드 정상 진입, /api/auth/session=200 ✅
>
> ### 부수로 발견·fix한 진짜 코드 이슈 5건 (한꺼번에 같은 세션, `9bd2570`·`082e744`·`6b5e8a1`)
> 1. `admin/proxy.ts`: CSRF Origin 검증을 `ADMIN_ALLOWED_ORIGINS` 화이트리스트 기반으로. 미설정 시 기존 Host 비교 fallback
> 2. `admin/lib/admin-session.ts`: IP 바인딩에 `ADMIN_SESSION_IP_BIND` 정책 도입 (`strict`/`prefix`/`off`, **기본 prefix**). IPv4 /24·IPv6 /64 prefix 매치
> 3. `admin/app/dashboard-client.tsx`: 401일 때만 `/login` redirect. 5xx·네트워크 장애는 console.error만 — 무한 핑퐁 차단
> 4. auth route 4개(`login`/`setup`/`mfa-verify`/`session`) silent catch에 `console.error`
> 5. **rate-limit 카운터 성공 시 리셋** (`admin/app/api/auth/login/route.ts`): 성공·실패 무관 카운트 버그 fix. 한도도 5→10
>
> ### 앞 진단 정정 (잘못 짚었던 것)
> - "비번 자동완성·rate-limit이 원인이다" → 부분적 사실(rate-limit 버그는 진짜 있었음)이나 **진짜 원인은 secure 쿠키**
> - "코드는 멀쩡" → **틀림**. 쿠키 정책·rate-limit 리셋 두 군데 다 버그였음
> - chrome MCP로 직접 제어 안 했으면 영원히 못 잡았을 가능성
>
> **부수로 발견한 진짜 코드 이슈 4건 동시 fix** (PR 없이 `fix/admin-auth-hardening` → main 머지):
> 1. `admin/proxy.ts`: CSRF Origin 검증을 `ADMIN_ALLOWED_ORIGINS` 화이트리스트 기반으로. 미설정 시 기존 Host 비교 fallback. nginx 뒤 Host/Origin 불일치 환경 대비
> 2. `admin/lib/admin-session.ts`: IP 바인딩에 `ADMIN_SESSION_IP_BIND` 정책 도입 (`strict`/`prefix`/`off`, **기본 prefix**). IPv4 /24·IPv6 /64 prefix 매치 — 셀룰러·WiFi 전환에도 세션 유지
> 3. `admin/app/dashboard-client.tsx`: 401일 때만 `/login` redirect. 5xx·네트워크 장애는 console.error만 — **로그인 무한 핑퐁 차단**
> 4. auth route 4개(`login`/`setup`/`mfa-verify`/`session`) silent catch에 `console.error` 추가 — 500 발생 시 컨테이너 로그로 추적 가능
>
> **함정 박제**:
> - **로그인 rate limit**: `admin/lib/rate-limit.ts:39` `LOGIN: { windowMs: 15*60*1000, maxRequests: 5 }`. **5회 초과 시 15분 차단** + 계정 자체도 LOCKED 15분(`admin/app/api/auth/login/route.ts:147`)
> - rate limit 차단 시 응답은 `429 + "로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도하세요."` — 사용자에겐 명확한데 자동완성/캐시랑 결합되면 "반응 0"으로 느껴짐
> - **본인이 rate limit에 걸렸을 때 풀기**: rate-limit은 메모리 → `ssh root@5.161.112.248 'cd /opt/sovereign-sms && docker compose restart sovereign-sms-admin'`. 계정 lockout이면 추가로 DB UPDATE 필요
>
> **NEW 환경변수 (선택, 미설정 시 안전 기본값)**:
> - `ADMIN_ALLOWED_ORIGINS`: 쉼표분리. 예 `http://5.161.112.248:3301,https://admin.example.com`
> - `ADMIN_SESSION_IP_BIND`: `strict` / `prefix`(기본) / `off`
>
> ---
>
> ## 🔴 다음 세션 재개 지점 (2026-05-28 저장소 이전 후)
>
> ### 즉시 처리 필요 (사용자 액션, 우선순위 순)
> 1. **🚨 옛 GitHub 토큰 revoke 필수** — joocy75-hash 계정의 토큰(2026-05-28 채팅 노출, prefix `ghp_9rQS...`)이 평문 노출됨. ⚠️ 전체 토큰은 의도적으로 안 적음.
>    - https://github.com/settings/tokens 접속(joocy75-hash로 로그인) → 해당 토큰 Revoke
>    - (joocy75-hash 토큰은 새 저장소에 더 이상 필요 없음 — 새 저장소 push는 joochanyang 계정으로 진행됨)
> 2. **서버 배포 origin 갱신** — 서버 `/opt/sovereign-sms`의 git remote도 새 저장소로 교체 필요:
>    - `ssh root@5.161.112.248 "cd /opt/sovereign-sms && git remote set-url origin https://github.com/joochanyang/SMS.git && git pull && docker compose up -d --build"`
>    - 자동 배포(`.github/workflows/deploy.yml`)의 deploy secret(서버 SSH key/path)이 새 저장소에 그대로 옮겨졌는지 확인: https://github.com/joochanyang/SMS/settings/secrets/actions
> 3. **관리자 페이지 첫 로그인** — `admin` / `Asdf!234` → 로그인 직후 관리자 페이지 내에서 비밀번호 변경(운영 SUPER_ADMIN 계정, 위 비번은 채팅 transcript에 남음).
>
> ### 자주 반복할 작업 (앞으로 들어오는 엑셀 적재)
> `~/Desktop/스마/<파일>.xlsx`가 새로 들어오면 — 무헤더(A=번호, B=이름) 가정:
> ```bash
> cd ~/Desktop/sms문자사이트
> npx tsx scripts/import-address-book-chunks.ts \
>   --file "/Users/mr.joo/Desktop/스마/<새파일>.xlsx" \
>   --prefix <접두사> \
>   --user-id cmntvm0q1000039aktjxrp50p \
>   --dry-run
> # 출력 OK면 --dry-run 빼고 재실행
> ```
> - 각 청크 맨 앞에 본인 3개(MY_CONTACTS: 01028855838/01083658229/01029155838) 자동 prepend
> - 청크명 1000 단위 누진(`<접두사>1000, 2000, ...`). 마지막 청크 1000 미만이어도 이름 그대로
> - 적재 후 검증 SQL: `PGPASSWORD='smspass_prod_2026' psql -h 5.161.112.248 -p 5434 -U smsuser -d bulksms -c "SELECT name, (SELECT COUNT(*) FROM \"Contact\" c WHERE c.\"addressBookId\"=ab.id) FROM \"AddressBook\" ab WHERE ab.\"userId\"='cmntvm0q1000039aktjxrp50p' AND ab.name LIKE '<접두사>%' ORDER BY LENGTH(name), name;"`
>
> ### 환경 변경 요약 (이미 적용됨, 참고용)
> - `~/.zshrc`에 `__gh_auto_switch` chpwd hook 추가 — `sms문자사이트`/`SMS` 폴더 들어가면 gh 자동으로 `joochanyang` 전환 (2026-05-28 저장소 이전으로 대상 계정 변경)
> - 기존 `feature/per-user-sms-line` 브랜치는 별도 PR 대기 중(아래 옛 섹션 참조). 이번 PR과 무관, 머지 안 됨
>
> ### 이번 세션 산출물(머지됨)
> - PR #3 `278e6a6` main 머지 완료: 엑셀/CSV 업로드 파서 fix + 주소록 대량 적재 도구
> - DB 적재: 원피.xlsx 35,899행 → 주소록 36개(`원피1000~원피36000`) 총 36,001건 admin 유저에 들어감
> - AdminUser `admin` 비밀번호 재설정 완료 (argon2id, SUPER_ADMIN)
>
> ---
>
> 2026-05-28 추가 — **엑셀 업로드 파서 fix + 주소록 대량 적재 도구 + 원피.xlsx 36개 청크 적재 완료**.
> - 업로드 파서: `lib/contact-import.ts`(신규 공용) — 한글/영문 헤더 자동 매핑(`번호/이름/별명`, `phone/name/nickname`, 별칭 다수). 헤더 인식 실패 시 모든 셀에서 번호 추출 폴백.
> - sms-send 페이지(`app/dashboard/sms-send/page.tsx`): 이전엔 헤더를 무시하고 모든 셀을 번호로 쏟아부어 "유효한 수신 번호 없음" 빈발. 이제 헤더 기반 매핑 + 이름/별명 있으면 `substitutionMode` 자동 on(변수치환 바로 동작). 양식 헤더를 한글 `번호/이름/별명`, 예시도 010 형식으로 통일.
> - 주소록 페이지(`app/dashboard/address-book/[id]/page.tsx`): 양식 컬럼 순서를 sms-send와 맞춤. `import-contacts.ts`는 lib re-export로 축소.
> - 테스트: `__tests__/lib/contact-import.test.ts` 12 케이스 신규. 전체 vitest 194/194 통과.
>
> ### 📌 주소록 대량 적재 절차 (앞으로 추가될 파일 같은 방식)
> 도구: `scripts/import-address-book-chunks.ts` (CLI). 무헤더 엑셀(A열=번호, B열=이름) 가정. 각 청크 맨 앞에 본인 3개 자동 prepend(MY_CONTACTS: 김무석/박진우/김만구).
>
> **사용 패턴**:
> ```bash
> # 1) dry-run으로 청크 수·이름·건수 미리보기 (DB 변경 없음)
> npx tsx scripts/import-address-book-chunks.ts \
>   --file "/Users/mr.joo/Desktop/스마/<파일>.xlsx" \
>   --prefix <접두사> \
>   --user-id cmntvm0q1000039aktjxrp50p \
>   --dry-run
>
> # 2) OK면 --dry-run 빼고 실적재
> npx tsx scripts/import-address-book-chunks.ts \
>   --file "/Users/mr.joo/Desktop/스마/<파일>.xlsx" \
>   --prefix <접두사> \
>   --user-id cmntvm0q1000039aktjxrp50p
> ```
> - `--chunk-size 1000` 기본 (옵션). 청크 이름은 `<접두사>1000, <접두사>2000, ...` 1000 단위 누진.
> - 마지막 청크가 1000 미만이어도 이름은 그대로 누진(예: 35,893행→`<접두사>36000`이 마지막, 893+3=896건).
> - 적재 대상 유저: `admin` (`cmntvm0q1000039aktjxrp50p`). 다른 유저 쓰려면 `--user-id` 변경.
> - 본인 번호 3개를 바꾸려면 스크립트 상단 `MY_CONTACTS` 배열 수정.
> - ⚠️ 원본 엑셀에 헤더 행이 **없어야** A=번호 B=이름 매핑이 맞음. 헤더 있는 파일은 첫 행이 데이터에서 빠지거나 깨질 수 있음 → dry-run 결과 "유효 행" 수치로 검증.
>
> **2026-05-28 실적**: 원피.xlsx(35,899행) → 유효 35,893 → 주소록 36개(원피1000~원피36000) 총 36,001건 admin 유저에 적재 완료.
>
> ---
>
> 이전 업데이트: 2026-05-14 14:50 KST — **HLR Lookup 통합 (발송 후 통신사 정확도 보강) — 코드 100% 완성, 계정 활성화 대기**.
> - 설계 스펙: `docs/superpowers/specs/2026-05-14-hlr-lookup-design.md` (커밋 `ad08b97`)
> - 신규: `lib/sms-providers/infobip-hlr.ts` — Infobip Number Lookup 클라이언트 (`lookupNumbers`/`isHlrEnabled`/`HlrAccountInactiveError`), 방어적 파싱. 20건 단위 테스트.
> - 신규: `app/api/cron/hlr-enrich/route.ts` — 발송 후 HLR 보강 cron. 7일 윈도우 SENT/DELIVERED 행 → 고유번호 → 30일 캐시 조회 → MISS만 HLR 조회(하드캡 `HLR_MAX_LOOKUPS_PER_RUN` 500) → `HlrLookup` upsert → SmsLog networkName/networkCode 정확값 덮어쓰기 + hlrCheckedAt. `INFOBIP_HLR_ENABLED!=='true'`면 no-op.
> - 신규 DB: `HlrLookup` 모델(번호별 30일 캐시) + `SmsLog.hlrCheckedAt`. 마이그레이션 `20260514000000_hlr_lookup_cache` **공유 DB 적용 완료** + `_prisma_migrations` 이력 기록.
> - UI: 유저 페이지 통신사 컬럼 **완전 제거** (관리자 전용화). 관리자 캠페인 상세에 `통신사(라우팅)` + `통신사(HLR)` + `번호이동` 컬럼 + `admin/app/api/campaigns/[id]/route.ts` HlrLookup 조인.
> - 🚨 핵심 제약: Infobip 계정에서 Number Lookup 서비스 **비활성** (`REJECTED_*` 응답). 코드는 완성됐고, 계정 매니저에 활성화 요청 → `INFOBIP_HLR_ENABLED=true` 토글 → cron 등록(`POST /api/cron/hlr-enrich`, 권장 10분) 하면 즉시 동작.
> - 검증: dev 런타임에서 401/skipped/accountInactive 3경로 실검증. accountInactive 시 hlrCheckedAt NULL 유지(재조회 보존)·캐시 미생성 확인. 전체 테스트 166/166 통과.
> - 이전(2026-05-14 05:25): **Infobip 통신사 처리 버그 수정 + reconcile cron 잡 신설** — `lib/sms-providers/mccmnc.ts`(MCCMNC→통신사명 매핑+14테스트), `app/api/infobip/dlr/route.ts` mccMnc 필드 경로 수정, `app/api/cron/infobip-reconcile/route.ts`(DLR 누락 보험, `/sms/1/logs` 보강). 4/27 6건은 logs 보존기간 초과로 `status=SENT` 유지. 운영 cron 등록 필요: `POST /api/cron/infobip-reconcile` 1분 주기.
> 이전 업데이트: 2026-05-13 00:36 — **활성 프로바이더를 `txg` → `infobip` 메인으로 전환** (DB `SystemSetting.active_sms_provider = {"provider":"infobip"}`). 로컬·Hetzner 양쪽 공유 DB라 즉시 반영. SMPP 워커는 폴링만 하고 발송하지 않음(컨테이너는 그대로 유지). TXG로 되돌리려면 같은 키를 `{"provider":"txg"}`로 복구.
> 이전 업데이트: 2026-04-27 13:15 (TXG SMPP 3.4 전면 전환 — HTTP /sendsms·/getreport·webhook DLR·폴링 cron 폐기, 단일 워커 컨테이너로 통합)
> 프로젝트: `/Users/mr.joo/Desktop/sms문자사이트`
> 감사 근거: `.planning/SECURITY-PLAN.md` 전 항목을 실제 코드와 대조

---

## 🆕 2026-04-27 — TXG 메인 발송 SMPP 전환

**배경**: TXG HTTP API의 push DLR 미작동(2026-04-24 사건)과 수시 라우트 silent fail로 신뢰성 문제 누적. TXG 측에서 SMPP 3.4 자격증명 발급. 메인 발송 라인을 SMPP 단일화하여 deliver_sm in-band DLR로 추적 신뢰성 회복.

### 아키텍처 결정
| 항목 | 변경 전 (HTTP) | 변경 후 (SMPP) |
|---|---|---|
| 발송 | `POST /sendsms` 배치 | `submit_sm` PDU 1건씩, 윈도우 50 동시 |
| 인증 | 매 요청 account/password | bind_transceiver 1회, 영속 TCP |
| DLR | Push webhook + 폴링 cron | **같은 연결로 deliver_sm in-band** |
| Next.js 적합성 | API 라우트에서 직접 호출 | API 라우트 부적합 → **별도 워커 컨테이너** |
| 호스팅 | Next.js 컨테이너 내부 | `sovereign-sms-smpp-worker` 신규 |

### 신규 컴포넌트 — `services/smpp-worker/`
| 파일 | 책임 |
|---|---|
| `index.ts` | 메인 엔트리 — config 로드, SMPP bind, 폴러 시작, SIGTERM/SIGINT graceful shutdown |
| `config.ts` | 환경변수 fail-fast 검증 |
| `connection.ts` | bind_transceiver / enquire_link / 재접속 backoff(1s→30s) / submit_sm 윈도잉 / timeout 처리 |
| `segmenter.ts` | UCS-2 BE / GSM-7 자동 감지 + UDH concatenation (한글 70자 초과 시 분할) |
| `poller.ts` | PENDING/RETRY_PENDING 행 claim (FOR UPDATE SKIP LOCKED) → SMPP 송신 → DB 반영 |
| `dlr.ts` | deliver_sm short_message 본문 + TLV(receipted_message_id, message_state) 파싱 → SmsLog 종결 |
| `smpp-types.d.ts` | `smpp` npm 패키지 타입 선언 (공식 .d.ts 부재) |
| `Dockerfile` | tsx 런타임으로 직접 실행, prisma generate 포함 |

### 비용 안전 원칙 (사용자 명시 요구)
TXG는 "submit billing" — 모든 submit_sm에 과금. 이중과금 방지를 위한 보수 정책:
- **submit_sm 응답 미수신**(timeout 또는 disconnect)은 `FAILED + providerStatus='SUBMIT_AMBIGUOUS'`로 종결하고 **재시도 금지**
- **SMPP transient 에러**(THROTTLED/MSGQFUL/일부 SYSERR만 retryable) → `RETRY_PENDING` + 지수 backoff
- **단일 인스턴스 강제**: `docker-compose deploy.replicas: 1` — 다중 바인드는 TXG 계정 정지 사유
- **동시 in-flight 상한**(TXG_SMPP_WINDOW=50) — submit_sm_resp 전에 무한 큐잉 방지

### 폐기된 코드
| 파일 | 사유 |
|---|---|
| `app/api/txg/report/route.ts` | push DLR webhook 폐기 (in-band deliver_sm으로 대체) |
| `app/api/cron/txg-poll-reports/route.ts` | 폴링 이중화 폐기 (in-band DLR이 신뢰 가능) |
| `__tests__/lib/txg-provider.test.ts` | HTTP fetch 모킹 테스트, SMPP 전환으로 무의미 |
| `lib/sms-providers/txg.ts` (sendBatch + getReport + parseResponse + mapTxgEventToStatus 등) | HTTP 발송 경로 제거. 잔액 조회 `getBalance`만 유지 (SMPP에 잔액 query 없음) |

### Next.js 측 통합
- `lib/campaign-processor.ts` — 활성 프로바이더가 `txg`이면 즉시 return (워커가 단독 처리). Infobip/SMS.to만 Next.js 처리.
- `admin/app/api/sms-providers/send-test/route.ts` — TXG는 동기 send-test 불가, 안내 메시지 반환
- `proxy.ts` — `/api/txg/report` publicPaths/csrfExempt에서 제거
- `lib/sms-providers/txg.ts::TxgProvider.sendBatch` — 호출 시 `TxgSendBatchUnsupportedError` 즉시 throw (잘못된 경로 fail-closed)

### 환경변수 변경
**제거**: `TXG_BASE_URL`, `TXG_ACCOUNT`, `TXG_PASSWORD`, `TXG_DLR_SECRET`, `TXG_DLR_WEBHOOK_URL`, `TXG_USE_ENCRYPTION`, `TXG_ENCRYPTION_KEY`

**신규**:
| 변수 | 기본값 | 설명 |
|---|---|---|
| `TXG_SMPP_HOST` | (필수) | TXG 발급 SMPP 서버 |
| `TXG_SMPP_PORT` | 20002 | SMPP 포트 |
| `TXG_SMPP_SYSTEM_ID` | (필수) | TXG Username |
| `TXG_SMPP_PASSWORD` | (필수) | TXG SMPP password (평문) |
| `TXG_HTTP_BALANCE_URL` | — | 잔액 조회 HTTP 엔드포인트 (포트 20003) |
| `TXG_HTTP_ACCOUNT` | — | HTTP /getbalance 계정 |
| `TXG_HTTP_PASSWORD` | — | HTTP /getbalance 비밀번호 |
| `TXG_SMPP_WINDOW` | 50 | 동시 in-flight submit_sm |
| `TXG_SMPP_SUBMIT_TIMEOUT_MS` | 60000 | submit_sm 응답 timeout |
| `TXG_SMPP_ENQUIRE_LINK_MS` | 30000 | keepalive 주기 |
| `TXG_SMPP_POLL_INTERVAL_MS` | 2000 | 워커 PENDING 폴링 주기 |
| `TXG_SMPP_BATCH_SIZE` | 200 | 폴링 1회당 최대 행 수 |

### 의존성
- `smpp@^0.5.1` — SMPP 3.4/5.0 client (farhadi/node-smpp)
- `tsx@^4.21.0` — 워커 TypeScript 런타임 (별도 빌드 단계 불필요)

### 검증
- `npx tsc --noEmit` — 신규 SMPP 코드로 인한 오류 0건 (기존 noise 3건은 logger.test.ts NODE_ENV readonly 이슈)
- `npx next build` — 유저 앱 빌드 성공, 신규 라우트 등록 정상 (TXG HTTP 라우트 사라짐 확인)
- 멀티파트 한글 메시지 분할 로직: 70자 초과 시 UDH 6바이트 헤더 부착 + segment 67자 단위

### 🚨 배포 절차
1. `.env`에 SMPP 환경변수 7개 입력 (위 표 참조). **자격증명 절대 커밋 금지**
2. `docker compose build sovereign-sms-smpp-worker`
3. `docker compose up -d sovereign-sms-smpp-worker`
4. `docker compose logs -f sovereign-sms-smpp-worker` — `bind_transceiver 성공` 로그 확인
5. 관리자 패널에서 활성 프로바이더 = `txg` 설정
6. 본인 캠페인으로 canary 번호 1건 발송 → 통신3사 폰 수신 확인 → DLR `DELIVERED` 전이 확인
7. **(중요)** 외부 cron에서 `/api/cron/txg-poll-reports` 호출 등록되어 있다면 **반드시 제거** (라우트 폐기됨, 401만 받음)
8. **(중요)** TXG 관리 패널에서 push DLR 콜백 URL 등록되어 있다면 **반드시 제거** (in-band DLR로 대체)

### 🔜 후속 과제
| # | 항목 | 공수 | 근거 |
|---|---|---|---|
| 1 | 멀티파트 부분 실패 추적 | 4h | 현재 첫 segment 기준으로 종결 — 2/N 실패 시 사용자에겐 truncated 전달이지만 DELIVERED 표시될 수 있음. 새 컬럼 `messageIdParts: String[]` 검토 |
| 2 | 좀비 SENT 종결 (deliver_sm 미수신 24h) | 2h | SMPP에서도 SMSC가 DLR을 안 주는 경우 가능 — pollRetryCount 대신 `createdAt + 24h < now` 기반 정리 cron |
| 3 | submit_sm 처리율 모니터링 | 2h | 워커가 분당 N건 처리하는지 대시보드 노출 — bind 재접속 횟수, ambiguous 카운트 등 |
| 4 | bind 재접속 알람 | 1h | 5분 내 3회 이상 재접속 시 텔레그램 알람 (TXG 측 SMPP 장애 조기 감지) |
| 5 | DLR 미매칭 message_id 로깅 | 0.5h | 첫 segment 외 part의 deliver_sm은 SmsLog에 매칭 안 됨 — 운영 가시성 위해 별도 카운터 |

---

## 🆕 2026-04-24 — TXG 메인 프로바이더 전환 대비 전달률 추적 시스템

**배경**: TXG-TEL(단가 저렴)을 메인 SMS 프로바이더로 전환하기 위해 전달률 모니터링·DLR 이중화·관측성을 완비함.

### 구조 변경
- **신규 DB 컬럼**: `SmsLog.providerName String?` (+ `[providerName, status, createdAt]` 인덱스)
  - 값: `"infobip" | "smsto" | "txg" | null` (null = 레거시)
  - 발송 시 `lib/campaign-processor.ts`가 3곳에서 자동 기록
- **공용 상태 매퍼**: `mapTxgEventToStatus(sendStatus, deliverStatus)` in `lib/sms-providers/txg.ts`
  - TXG의 sendStatus(0~) + deliverStatus(0~5) → `DELIVERED | FAILED | null` 매핑
  - Push DLR과 cron 폴링이 공유

### DLR 이중화 (Push + Poll)
| 경로 | 엔드포인트 | 주기 | 인증 |
|---|---|---|---|
| Push | `PUT /api/txg/report` | TXG 서버 발신 | `x-txg-token` 헤더 (`TXG_DLR_SECRET`) |
| Poll | `POST /api/cron/txg-poll-reports` | 외부 cron 5분 | `Authorization: Bearer ${CRON_SECRET}` |

- 폴링 대상: 최근 24h `providerName=txg AND status=SENT AND messageId IS NOT NULL`, 최대 5000건
- 500건 chunk 단위 `TxgProvider.getReport(ids)` 호출
- 멱등성: `updateMany { where: { status: { notIn: ["DELIVERED","FAILED"] } } }` + `count > 0`일 때만 카운터 증가 → **종결 상태 재전이로 인한 카운터 중복 증가 원천 차단**

### 보안 강화
- `TXG_DLR_SECRET` 미설정/플레이스홀더("generate-with…")/16자 미만 → 503 전면 차단
- `crypto.timingSafeEqual` + length pre-check (타이밍 공격 방어)
- 헤더로만 전달 (쿼리 파라미터 금지, S-14 유출 방지)
- Rate limit: DLR 분당 200회, cron 분당 5회
- 이벤트 1000건 상한 (DoS 방지)

### 관측성 (Silent Failure 제거)
- `TxgProvider.getReport`: HTTP 에러 throw + `status !== 0` 라벨 포함 throw
- `TxgProvider.getBalance`: 빈 catch 제거 → 3분기 각각 `logger.warn`
- `TxgProvider.parseResponse`: 부분 실패 시 `error: "TXG 응답 array에서 누락 (사유 미상 — /getreport로 확인 필요)"` 명시
- `sendSingle/MultiContent`: 네트워크 오류 시 `providerStatus: 'NETWORK_ERROR'` + `logger.warn`
- `campaign-processor`: `console.error` → `logger.error + toLogError`
- `dashboard-client.tsx`: 빈 `catch { router.push('/login') }` 제거 (서버 장애를 로그인 만료로 둔갑시키는 패턴 근절)

### 대시보드 (관리자 앱)
- API: `admin/app/api/dashboard/stats/route.ts`에 `providerStats: { "24h": [...], "7d": [...] }` 필드 추가
- UI: "SMS 프로바이더별 전달률" 카드 섹션 (24시간/7일 탭, 진행바, 전달률 색상 ≥90% 초록/≥70% 주황/<70% 빨강)
- 집계 규칙:
  - `sent` = `DELIVERED + FAILED + SENT + RETRY_PENDING` (실제 발송 시도)
  - `pending` = `SENT + RETRY_PENDING` (확정 전)
  - `deliveryRate = delivered / sent`
  - `providerName IS NULL` 레거시 로그는 집계 제외 (⚠️ 후속: "미분류: N건" 카드 표시 필요)
- 부수 버그 수정: `systemStatus` 비교 `'ok'` → `'connected'` (서버 응답과 불일치하던 기존 버그)

### 변경/신규 파일 (9개)
| 파일 | 변경 내용 |
|---|---|
| `prisma/schema.prisma` | `SmsLog.providerName` + 인덱스 |
| `lib/sms-providers/txg.ts` | 공용 매퍼 + HTTP 검증 + 로깅 + 부분 실패 명시 |
| `lib/campaign-processor.ts` | providerName 기록 3곳 + logger 전환 |
| `app/api/txg/report/route.ts` | **전면 재작성** — 보안·상태 매핑·멱등성·재전이 방지 |
| `app/api/cron/txg-poll-reports/route.ts` | **신규** Push 누락 대비 폴링 |
| `admin/app/api/dashboard/stats/route.ts` | `providerStats` 집계 추가 |
| `admin/app/dashboard-client.tsx` | 프로바이더별 전달률 카드 + systemStatus 비교 수정 + 빈 catch 제거 |
| `.env.example` | `TXG_DLR_SECRET` 추가 + 설명 |
| `scripts/cron-setup.md` | TXG 폴링 cron / Push DLR 웹훅 등록 가이드 |
| `tsconfig.json` | 빌드 방해하던 `test-txg*.ts` 루트 스크립트 exclude |

### 검증
- `npx tsc --noEmit` — 유저/admin 양쪽 통과
- `npx next build` — 양쪽 성공, 신규 라우트(`/api/txg/report`, `/api/cron/txg-poll-reports`) 등록 확인
- `npx prisma db push` — 스키마 반영 완료 (Hetzner 5.161.112.248:5434/bulksms)
- 전문 에이전트 팀 병렬 투입: typescript-pro(cron), frontend-developer(대시보드), code-reviewer(15건), silent-failure-hunter(9건) — 피드백 Critical/High 12건 모두 반영

### 🚨 배포 후 반드시 해야 할 운영 작업
1. **`.env`에 `TXG_DLR_SECRET` 생성·주입**: `openssl rand -base64 32` 값을 `.env` + TXG 관리 패널 양쪽에 **동일 입력**. `.env.example`의 플레이스홀더 값 그대로 쓰면 503으로 거부됨.
2. **TXG 관리 패널 콜백 등록**: `PUT https://<도메인>/api/txg/report` + 헤더 `x-txg-token: <TXG_DLR_SECRET 값>`
3. **외부 cron 등록**: `POST /api/cron/txg-poll-reports` 5분 주기 (n8n 권장). 상세 절차 `scripts/cron-setup.md` 참조.

### 🔜 후속 개선 과제 (리뷰에서 Major/Minor로 식별, 데이터 누적 후 판단)
| # | 항목 | 공수 | 근거 |
|---|---|---|---|
| 1 | 24h 경과 좀비 SENT 로그 종결 경로 (`pollRetryCount` 또는 `DELIVERY_UNKNOWN` 상태) | 2h | 폴링 윈도우 경과 후 영원히 SENT로 박제되는 로그 발생 가능 |
| 2 | `providerName=null` 복구 크론 (발송 직전 크래시 시 보정) | 1h | 전달률 집계에서 자동 제외돼 장기적 과소 계수 |
| 3 | 대시보드 "미분류: N건" 카드 추가 | 1h | 레거시 로그가 UX에서 침묵 제외됨 |
| 4 | DLR 1000건 배치 처리 성능화 (`groupBy campaignId` + `updateMany`) | 2h | 현재 건당 `$transaction` 순차 실행 |
| 5 | 폴링 누적 낭비 방지 (무응답 N회 시 자동 종결) | 2h | 24h 내내 동일 ID 반복 폴링 |
| 6 | `deliveryRate` 분모 논의 — `delivered/(delivered+failed)` 업계 표준 검토 | 0.5h | 현재 RETRY_PENDING 포함으로 일시적 저하 표시 |

---

## 완료된 작업

### 인프라
- [x] DB: Hetzner PostgreSQL 16 (`5.161.112.248:5434`, user: smsuser, db: bulksms)
- [x] Prisma 7.7 + `@prisma/adapter-pg` 연결 (13개 테이블 생성 완료)
- [x] `.env` 직접 PostgreSQL URL로 변경 (prisma+postgres 제거)
- [x] 빌드 성공 확인 (Next.js 16.2.3 Turbopack)

### 보안 수정 (plan.md 6단계)
- [x] 단계 1: Setup API — GET→POST, 시크릿 검증, 비밀번호 하드코딩 제거
- [x] 단계 2: 크레딧 레이스 컨디션 — `findUnique` 트랜잭션 내부, `{ decrement }` 적용
- [x] 단계 3: 캠페인 취소 환불 — 미처리 건 환불 + Transaction 기록
- [x] 단계 4: proxy.ts 인증 — Next.js 16 proxy (middleware) 활성화 (**금일 완료**)
- [x] 단계 5: DLR 웹훅 보안 — 시크릿 필수화 + `.env.example`
- [x] 단계 6: 빌드 검증

### 발송 테스트 (2026-04-10)
- [x] Admin 계정 생성 (admin@sovereign.com)
- [x] 캠페인 생성 → Infobip 발송 → 실제 수신 확인 (01083658229, 01029155838)
- [x] **버그 수정**: `isTemporaryProviderError` — `PENDING_ACCEPTED` 정상 분류
- [x] **버그 수정**: process 후 PENDING 0이면 자동 COMPLETED 전환
- [x] DLR 웹훅 시뮬레이션 → `deliveredCount` 정상 업데이트 확인
- [x] 크레딧 차감 + Transaction 기록 정상 확인
- Infobip 무료 잔여: ~96건 (4건 사용)

### 관리자 패널 (`/admin` 별도 Next.js 앱)
- [x] 대시보드, 유저관리, 캠페인관리, 크레딧/환불, 블랙리스트, 템플릿, 감사로그, 설정
- [x] MFA (TOTP), RBAC, Kill Switch, Sudo 모드

### USDT-TRC20 자동 충전 시스템 (2026-04-11)
- [x] **Prisma 스키마**: `UsdtDeposit` 모델 (TXID unique 중복 방지, 상태 추적, 시세 Lock)
- [x] **Upbit 시세 연동**: WebSocket 실시간 스트리밍 + REST API fallback (5초 캐시)
- [x] **입금 API** (`/api/usdt/deposit`): 수량 확정 → 시세 Lock (15분) → 지갑 주소 제공
- [x] **TXID 검증 API** (`/api/usdt/verify`): TronGrid + TronScan 이중 fallback 검증
  - Status: SUCCESS 확인
  - To Address: 시스템 관리자 주소 일치
  - Asset: USDT (TRC20) 확인
  - Amount: 신청 수량 일치 (0.01 USDT 허용 오차)
  - Duplicate Check: TXID DB 중복 체크
- [x] **자동 충전**: 검증 통과 시 즉시 크레딧 충전 (Prisma 트랜잭션 + CreditLedger 감사 추적)
- [x] **프론트엔드**: 4단계 입금 플로우 (수량 입력 → 주소 표시 → TXID 검증 → 완료)
  - 실시간 시세 표시 (LIVE WebSocket 상태 인디케이터)
  - 금액 프리셋 (10/50/100/500/1000 USDT)
  - KRW → USD 실시간 환산
  - 카운트다운 타이머 (시세 Lock 유효 기간)
  - 주소 복사 기능
  - TronScan 외부 링크
  - 입금 내역 히스토리
- [x] **보안**: Rate Limiting (검증 API 3/분, 20/시간), 만료 처리, 네트워크 경고

---

## 남은 작업 (SECURITY-PLAN 35건 코드 감사 기준)

**집계: DONE 29 / PARTIAL 3 / OPEN 4 = 36건** (2026-04-19 블로커 4건 + PARTIAL 3건 + OPEN 4건 처리)

### 🔴 OPEN — 미착수 4건 (대공수 항목만 잔존)

| ID | 항목 | 근거 | 공수 |
|---|---|---|---|
| S-06 | Redis 기반 Rate Limiter | `lib/rate-limiter.ts` in-memory Map 그대로. 멀티 인스턴스 배포 전 필수 | 4h |
| T-01 | API 단위 테스트 | `__tests__/api/`에 `register.test.ts`만. USDT/캠페인/크레딧/쿠폰 테스트 없음 | 8h |
| T-02 | Playwright E2E | `playwright.config` 없음, `@playwright/test` 미설치 | 6h |
| F-05 | 환불 요청 엔드포인트 | `/api/refund/` 없음, `RefundRequest` 모델 없음 | 3h |

### ✅ 2026-04-19 추가 처리 (OPEN → DONE 4건)

| ID | 조치 | 변경 파일 |
|---|---|---|
| **O-04** | 감사 오류 교정 — `lib/prisma.ts`에 이미 pg `Pool(max=DB_POOL_MAX, idleTimeout=30s, connectionTimeout=5s)` 구현 완료. `.env.example`에 `DB_POOL_MAX` 문서화 | `.env.example` |
| **O-05** | `LOG_FILE_PATH` 설정 시 JSON Lines 파일 싱크 활성화 (Loki/Promtail 수집용). stream write error 핸들링 포함 | `lib/logger.ts`, `.env.example` |
| **D-02** | 공용 `lib/api-error.ts` (`handleApiError(err, context)`) 신설 + 18개 admin 라우트의 중복 `handleError` 함수 정의 일괄 제거 + `@shared/api-error` import 교체 | `lib/api-error.ts`, 18 × `admin/app/api/**/route.ts` |
| **F-08** | Dashboard 7일 통계를 `prisma.$queryRaw` + `DATE_TRUNC('day')` + `GROUP BY` 로 교체. 로그 N건 전체 fetch → 최대 35행(7일 × 5상태) 집계로 단축 | `app/api/dashboard/stats/route.ts` |

### ✅ 2026-04-19 처리 완료 (배포 블로커 4건)

| ID | 조치 | 변경 파일 |
|---|---|---|
| **S-03** | `/api/setup` 라우트 + 디렉토리 삭제, `.env`/`.env.example`의 `SETUP_SECRET`·`ADMIN_EMAIL` 제거, admin 셋업의 `SETUP_SECRET` fallback 제거 | `app/api/setup/` 삭제, `.env`, `.env.example`, `admin/app/api/auth/setup/route.ts` |
| **S-05** | `FORCE_SECURE_COOKIE` 오버라이드 로직 제거 → 프로덕션 항상 `secure:true`. `.env`의 SMSTO_API_KEY 줄바꿈 누락 버그 수정 | `admin/lib/admin-session.ts`, `.env` |
| **O-01** | GitHub Actions 일일 백업 워크플로우 추가 (KST 03:00, artifact 30일 보존, 실패 시 텔레그램 알림) | `.github/workflows/db-backup.yml` |
| **O-02** | deploy 유저 전환 + 이미지 스냅샷/PREV_SHA 기반 자동 롤백 + 60초 헬스체크. 수동 롤백 스크립트 및 초기 세팅 가이드 | `.github/workflows/deploy.yml`, `scripts/rollback.sh`, `scripts/setup-deploy-user.md` |

### 🟡 PARTIAL — 부분 완료 9건

| ID | 항목 | 현재 상태 | 추가 공수 |
|---|---|---|---|
| S-09 | Admin Proxy DB 세션 검증 | proxy는 쿠키만 체크, DB 검증은 라우트별(`admin/lib/admin-session.ts:117-172`) — edge 레벨 경량체크 미추가 | 2h |
| S-10 | 블랙리스트 암호화 | `phoneHash`는 추가됐으나 `phoneNumber` 평문도 여전히 저장 (`prisma/schema.prisma:193-205`) | 2h |
| O-03 | 모니터링 알림 | admin의 kill-switch/sudo만 텔레그램 알림, 캠페인 프로세서·USDT 실패·Infobip 장애에 미연동 | 3h |

### ✅ 2026-04-19 추가 처리 (PARTIAL 3건)

| ID | 조치 | 변경 파일 |
|---|---|---|
| **R-01** | Upbit 시세 캐시에 `fetchedAt` 필드 추가 + 최대 stale 5분 상한. 환율 `MAX_STALENESS_MS` 1시간 → 5분. 한도 초과 시 throw | `lib/upbit.ts` |
| **R-02** | TronGrid/TronScan 호출을 `fetchWithRetry` 래퍼로 교체 (5xx·429·네트워크 오류에 3회 지수 백오프 400→800→1600ms, 8초 타임아웃) | `lib/tron-verify.ts` |
| **D-01** | 공용 `lib/client-ip.ts` 신설 (`claimed`/`trusted` 모드). `api-rate-limit.ts`, `admin/lib/admin-session.ts`, `admin/lib/audit.ts`의 3중 IP 추출 로직 제거 → 공유 유틸로 통일 | `lib/client-ip.ts`, `lib/api-rate-limit.ts`, `admin/lib/admin-session.ts`, `admin/lib/audit.ts` |

### 🟢 DONE — 완료 확인 18건 (주요)

S-01(비번 8자+영숫자), S-02(CSRF Origin+SameSite=Strict), S-04(보안헤더 전체), S-07(USDT TXID unique+$transaction), S-08(timingSafeEqual cron/DLR), S-11(정지 유저 거부), S-12(로그인 잠금 failedLoginCount/lockedUntil), S-13(MFA AES-256-GCM), S-14(DLR 토큰 헤더전용), F-01(비번찾기 reset-request/reset-password), F-02(USDT 만료 cron), F-03(Upbit 실시간환율), F-04(예약발송 scheduledAt), F-06(캠페인 페이지네이션), F-07(Sender ID 필드+lib), O-06(헬스체크 최소응답), O-07(admin ignoreBuildErrors 제거), D-03/D-04(CreditLedger DEDUCT/REFUND)

### 🚀 배포 운영 남은 2건 (SECURITY-PLAN 외)

| 항목 | 설명 |
|---|---|
| Infobip 대시보드 DLR URL 등록 | 배포 후 외부 URL로 Infobip 콜백 등록 (코드는 준비 완료) |
| admin↔유저앱 도메인/포트 구성 | 두 Next.js 앱 배포 토폴로지 결정 (서브도메인/경로) |

---

## 현재 DB 상태

| 테이블 | 건수 |
|--------|------|
| User | 1 (admin@sovereign.com, 크레딧 999.75) |
| SmsCampaign | 3 (COMPLETED 2, QUEUED 1) |
| SmsLog | 5 (DELIVERED 2, SENT 2, PENDING 1) |
| Transaction | 3 (WITHDRAWAL) |
| AdminUser | 0 (미생성) |
| CreditCoupon | 0 (신규 테이블) |

## 기술 스택

| 항목 | 버전/설정 |
|------|----------|
| Next.js | 16.2.3 (App Router, Turbopack) |
| React | 19.2.4 |
| Prisma | 7.7.0 + @prisma/adapter-pg |
| DB | PostgreSQL 16 (Hetzner 5.161.112.248:5434) |
| 인증 | NextAuth.js 4.24.13 (credentials, JWT) |
| SMS | Infobip (@infobip-api/sdk 0.3.2) |
| 스타일 | Vanilla CSS (글래스모피즘 다크 테마) |

## 접속 정보

```bash
# 유저 앱 (dev)
cd ~/Desktop/sms문자사이트 && npx next dev --port 3000

# 관리자 앱 (dev)  
cd ~/Desktop/sms문자사이트/admin && npx next dev --port 3001

# DB 접속
PGPASSWORD=smspass_prod_2026 psql -h 5.161.112.248 -p 5434 -U smsuser -d bulksms

# Admin 계정
email: admin@sovereign.com / password: admin12345
```

## 이어서 작업 시

```
/clear
→ "sms문자사이트 PROGRESS.md 확인하고 이어서 작업"
```

### 다음 작업자가 꼭 알아야 할 것

1. **SMS 프로바이더 라우팅**: `SystemSetting.active_sms_provider` 값으로 결정됨 (`infobip | smsto | txg`). 관리자 UI `/sms-providers`에서 전환. 실제 발송은 [lib/campaign-processor.ts:234](lib/campaign-processor.ts#L234) `getActiveProvider()` 경유.
2. **TXG 메인 전환 시**: 반드시 `TXG_DLR_SECRET` 주입 + TXG 관리 패널 콜백 등록 + cron 폴링 등록 3종 세트 완료 후 전환. 안 하면 전달률이 `SENT`로 박제됨.
3. **프로바이더별 통계**: `SmsLog.providerName` 컬럼 활용. `null` = 레거시(2026-04-24 이전) — 집계에서 자동 제외됨.
4. **카운터 무결성**: DLR Push / cron 폴링 양쪽에서 `status: { notIn: ["DELIVERED","FAILED"] }` 가드가 걸려 있어 동시 업데이트 시 `deliveredCount/failedCount` 중복 증가 없음. 이 가드를 절대 제거하지 말 것.
5. **DB 마이그레이션 방식**: 본 프로젝트는 Prisma Migrate 파일을 두지 않고 **`npx prisma db push`** 로만 스키마 반영 (`prisma/migrations/` 디렉토리 없음). 신규 컬럼 추가 후 반드시 `npx prisma generate`도 실행.

## 우선순위 권고 (다음 스프린트)

1. **TXG 메인 전환 배포 직전**: 위 "🚨 배포 후 반드시 해야 할 운영 작업" 3단계 수행 (30분)
2. **전달률 품질 개선**: 후속 과제 #1 좀비 SENT 종결 + #3 미분류 카드 (3h) — 실데이터 1주일 누적 후 판단
3. **기존 잔여 (SECURITY-PLAN)**: S-06 Redis RL(4h), T-01 API 테스트(8h), T-02 Playwright E2E(6h), F-05 환불요청(3h)
4. **운영 품질**: O-03 모니터링 텔레그램 알림 확장(3h, 캠페인 프로세서·USDT 실패·Infobip 장애 연동)

**현 스냅샷**: SECURITY-PLAN 36건 중 DONE 29 + PARTIAL 3 + OPEN 4. TXG 전달률 추적은 SECURITY-PLAN 외 신규 기능이며 완료. 배포 블로커 없음.
