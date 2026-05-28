# 출시 전 코드 감사 (2026-05-28)

> **점검 방식**: 자동 도구(tsc, eslint, knip) + 핵심 7개 장문 파일 수동 검토 + grep 기반 추가 스캔
> **점검 범위**: TS/TSX 192개 파일 (`.claude/worktrees` 320개는 작업 worktree 사본이므로 제외)
> **결론**: **발송·결제 핵심 경로 안전**. 코드 정리 대상은 대부분 출시 전에 안 고쳐도 되는 종류(파일 정리·문서 정리). 다만 **🔴 보안 위험 1건은 출시 전 처리 필수**.

---

## 우선순위 P0 — 출시 전 반드시 처리

### 🔴 P0-1. 루트의 `.env.bak-*` 평문 백업 2개 (보안 위험)

```
.env.bak-1777043844  (1650 bytes, 2026-04-25)
.env.bak-1777043904  (1648 bytes, 2026-04-25)
```

`.gitignore`가 `.env*`를 ignore하므로 git 푸시되진 않았지만 **로컬 디스크에 평문 SMTP/API 키가 두 벌 더 깔려 있는 상태**. 백업 가치 없음 (현재 `.env`로 충분).

**조치**: `rm .env.bak-1777043844 .env.bak-1777043904`

---

## 우선순위 P1 — 출시 후 조속히 처리

### 🟠 P1-1. TypeScript 컴파일 에러 4건 (`tsc --noEmit` 기준)

```
__tests__/lib/logger.test.ts(8,42): TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
__tests__/lib/logger.test.ts(9,15): TS2704: The operand of a 'delete' operator cannot be a read-only property.
__tests__/lib/logger.test.ts(30,12): TS2704: The operand of a 'delete' operator cannot be a read-only property.
admin/app/api/sms-providers/balances/mapper.ts(1,58): TS2307: Cannot find module '@shared/sms-providers/types'
```

- **logger.test.ts 3건**: Node 22+ 에서 `process.env.NODE_ENV` 이 readonly가 됐는데 테스트가 직접 할당/삭제. `vi.stubEnv('NODE_ENV', 'production')` 로 바꿔야 함.
- **balances/mapper.ts 1건**: `@shared/sms-providers/types` 별칭 미해결 — admin 앱의 `tsconfig.json` paths에 별칭이 없거나 잘못 박힘. PR #1로 들어간 신규 파일이라 admin 빌드는 통과했지만 root `tsc --noEmit` 에서 잡힘.

**영향**: 런타임에는 문제없음 (next build / next dev 둘 다 통과). 다만 CI에서 `tsc` 게이트를 켜면 막힘.

### 🟠 P1-2. ESLint react-hooks 에러 1건

```
admin/app/dashboard-client.tsx:187:5
  187 |     fetchData();
      |     ^^^^^^^^^ Avoid calling setState() directly within an effect
      react-hooks/set-state-in-effect
```

`useEffect` 안에서 `fetchData()`를 동기 호출 → 그 안에서 setState → cascading re-render. 동작은 하지만 React 19 의 set-state-in-effect 규칙 위반. 통상적인 fetch 패턴이라 막상 보면 무해해 보이는데, 정식 패턴(`useTransition` 또는 컴포넌트 mount 직후 1회만 호출하는 ref 패턴)으로 옮기는 게 좋음.

### 🟠 P1-3. 진짜 dead code 확정 — `tps-chart.tsx` + `recharts` 의존성

PR #1에서 대시보드 TPS 차트를 프로바이더 잔액 카드로 교체했지만 **파일 자체와 의존성은 안 지움**:

```
admin/components/tps-chart.tsx       (자기 자신 외에 import 0)
recharts (^3.8.1)                    (tps-chart.tsx 외 사용 0)
```

**조치**: `rm admin/components/tps-chart.tsx` + `npm uninstall recharts` (bundle size 절감).

### 🟠 P1-4. `admin/app/sms-providers/page.tsx` 의 `killSwitch` state

```
54:  const [killSwitch, setKillSwitch] = useState(false);
88:        setKillSwitch(sessionData.killSwitch ?? false);
```

set은 하는데 어디서도 읽지 않음. 주석에 "settings 페이지처럼 화면 표시에 필요해서 session 호출 유지" 라 했지만 정작 표시는 안 함. **세션 호출 자체는 다른 이유로 필요할 수 있으므로 호출은 유지, state 줄만 제거** 권장.

---

## 우선순위 P2 — 시간 날 때 정리

### 🟡 P2-1. 미사용 export 5건 + 미사용 type 3건

```
admin/lib/use-visibility-polling.ts:
  - useVisibilityPolling      ← PR #1 도입 후 ProviderBalanceGrid 가 self-contained 로 구현, hook export 만 안 씀
  - VisibilityPollingState (type)

lib/rate-limiter.ts:
  - resetRateLimit            ← login 성공 시 호출하는 코드는 있음, grep 으로는 잡히는데 knip 이 못 잡은 경우 → 진짜 미사용인지 확인 필요

lib/sms-providers/router.ts:
  - getAllProviders, resolveUserProvider  ← PROGRESS.md 박제대로 발송 경로 미흡수
                                            (PR #1 의 "토대만" 박제와 일치, 정상)

lib/sms-providers/txg.ts:
  - TxgSendBatchUnsupportedError  ← SMPP 활성 시 fail-closed throw 위함, 워커 도입 후 안 던질 수도

admin/app/api/sms-providers/balances/mapper.ts:
  - ProviderName (type)

app/dashboard/address-book/[id]/import-contacts.ts:
  - ImportedContact (type)
```

**조치**: `resolveUserProvider`, `getAllProviders` 는 다음 PR(발송 라인 분기)에 흡수되므로 **유지**. 나머지는 검증 후 제거 가능.

### 🟡 P2-2. 큰 파일 4개 — 분해 후보

| 파일 | 줄수 | useState | 진단 |
|---|---|---|---|
| `admin/app/users/[id]/page.tsx` | 630 | 18 | PR #1에서 카드 4개로 쪼갰지만 부모는 그대로. 카드별 state 를 카드로 옮기면 줄어듦. |
| `app/dashboard/wallet/usdt/usdt-deposit-client.tsx` | 733 | 6 | 단일 화면이지만 입금 흐름 + 폴링 + QR + 거래내역이 한 컴포넌트. |
| `app/dashboard/sms-send/page.tsx` | 726 | 10 | 유저 발송 페이지 모놀리스. 메시지 작성 / 수신자 선택 / 발송 컨펌 / 진행률을 분리하면 깔끔해짐. |
| `admin/app/dashboard-client.tsx` | 652 | 0 | useState 0인데 652줄 — JSX 가 길거나 헬퍼 함수가 많음. JSX 컴포넌트 분리 후보. |

**조치 가이드**: 출시 후 회귀 위험이 가장 낮은 `users/[id]/page.tsx` 부터 (이미 카드 컴포넌트 4개가 별도 파일에 있음 → 부모 state도 카드로 이관). `sms-send/page.tsx` 와 `usdt-deposit-client.tsx` 는 라이브 검증 비용이 크니 미루는 게 안전.

`services/smpp-worker/poller.ts` 575줄도 길지만 **현재 active_sms_provider=smsto 이라 사실상 idle** — 출시 후 TXG 전환 결정될 때 손 대도 충분.

### 🟡 P2-3. 루트의 옛 plan/research 문서 (9개)

```
docs/archive/admin-implementation-plan.md       (40 KB, 2026-04-09)
docs/archive/admin-panel-research.md            (23 KB, 2026-04-09)
docs/archive/implementation_plan.md             (5 KB, 2026-04-09)
docs/archive/plan.md                            (19 KB, 2026-04-09)
docs/archive/research.md                        (25 KB, 2026-04-09)
docs/archive/MULTI-PROVIDER-PLAN.md             (5 KB, 2026-04-14)
docs/archive/PLAN-2026-04-17-substitution-and-speed.md (16 KB)
docs/archive/PLAN-2026-04-27-smpp-migration.md  (19 KB)
docs/archive/smpp.md                            (191 B)
```

옛 작업 산출물. 보존 가치는 있지만 루트에 흩어져 있어 2026-05-29 `docs/archive/` 로 이동 완료.

### 🟡 P2-4. 로컬 stale 브랜치 5개

```
feat/txg-bulk-send-ops
feature/per-user-sms-line          ← PROGRESS.md 박제대로 이미 폐기 결정됨
fix/admin-auth-hardening
fix/phase1-critical-issues
fix/txg-empty-source-addr
```

원격에도 같은 5개 존재. 작업 끝났으면 정리하는 게 좋음. 다만 git 정리는 destructive 이라 **각 브랜치가 main 에 머지됐는지** 확인 후 사용자가 결정.

### 🟡 P2-5. 루트 `.bkit/` 폴더 (Claude Code 옛 작업 산출물)

`.gitignore` 에 포함되어 git에는 없지만 로컬 디스크 점유. `.bkit/{audit,checkpoints,decisions,runtime,state,workflows}` 모두 4월 9-10일 산출물. **조치**: 안전하게 `rm -rf .bkit/` 가능.

### 🟡 P2-6. `_prisma_migrations` 중복 row

```sql
SELECT migration_name, finished_at FROM _prisma_migrations
WHERE migration_name='20260528120000_add_user_sms_provider';
-- 2 rows: 하나는 finished_at NULL (rolled-back?), 하나는 finished_at not null
```

PROGRESS.md 박제대로 `prisma migrate resolve --applied` 를 두 번 했던 흔적. 컬럼은 정상 있고 기능 영향 0 이지만 다음 마이그레이션 작업 전에 정리 권장:

```sql
DELETE FROM _prisma_migrations
WHERE migration_name='20260528120000_add_user_sms_provider'
  AND finished_at IS NULL;
```

---

## 우선순위 P3 — 정보성 (조치 불필요)

### 🟢 P3-1. console.log 잔존 — 문제 없음

19건 발견했으나:
- `scripts/*.ts`: CLI 스크립트이므로 정상 (`console.log` 가 사용자 출력)
- `lib/logger.ts`: 로거 구현부 자체
- `admin/lib/notifications.ts`: `console.warn` (Telegram 미설정 경고, 정상)
- `admin/lib/mfa-crypto.ts`: `console.warn` (암호화 키 미설정 경고, 정상)

**전부 의도된 사용**. 디버그 잔존 없음 ✅.

### 🟢 P3-2. TODO/FIXME — 1건뿐 (정상)

```
app/api/auth/reset-request/route.ts:50: // TODO: 이메일 발송 연동 필요
```

비번 재설정 이메일 연동 — 출시 후 작업 가능. 1건뿐이라 코드 빚 거의 없음 ✅.

### 🟢 P3-3. `'use client'` 누락 — 0건 ✅

`useState`/`useEffect` 사용하는 모든 .tsx 가 정상으로 `'use client'` 선언. App Router 함정 통과.

### 🟢 P3-4. knip "Unused files 89개" — 거짓양성

knip 기본 설정이 admin 앱(별도 Next.js 앱), services/smpp-worker(독립 Docker entry), Next.js file-based routing(`route.ts`, `page.tsx`)을 인식 못 함. **knip.json 설정 추가하면 사라지지만 출시와 무관**.

### 🟢 P3-5. knip "Unused dependencies" 거짓양성 검증 완료

| 패키지 | knip 진단 | 실제 |
|---|---|---|
| `pretendard` | unused | `app/layout.tsx` + `globals.css` 폰트 import (✅사용) |
| `tsx` | unused | `npx tsx scripts/...` 동적 실행 (✅사용) |
| `zod` | unused | 20 파일에서 import (✅사용 — knip 의 명백한 오탐) |
| `smpp` | unused | smpp-worker 2 파일 (✅사용) |
| `@types/bcryptjs` | unused | 정말 안 씀 — bcryptjs v3 가 자체 타입 포함 → 제거 가능 |
| `@vitejs/plugin-react` | unused | `vitest.config.ts` 외 사용 0 → 제거 가능성, vitest 설정 확인 필요 |
| `recharts` | unused | `tps-chart.tsx` 외 사용 0 (P1-3 에서 함께 제거) |

### 🟢 P3-6. 발송 경로 안전성 — 통과 ✅

- `lib/campaign-processor.ts`: `prisma.$transaction` 14건 사용. 비용 차감·SmsLog 박제·캠페인 카운트 갱신을 트랜잭션으로 묶음 → 금전 안전.
- `app/api/sms/campaign/route.ts`: `prisma.$transaction` 8건. 캠페인 생성 시 블랙리스트 체크·환불·잔액 차감을 묶음.
- `SmsLog.providerName` 박제: campaign-processor 3곳(L290, L307, L365)에서 `provider.name` 정상 기록 — 라인 추적 가능.

---

## 한눈 요약

| 우선순위 | 항목 수 | 조치 시점 |
|---|---|---|
| 🔴 P0 (보안) | 1 (`.env.bak-*` 삭제) | **출시 전 필수** |
| 🟠 P1 (품질) | 4 (TS 에러, lint 에러, dead code 1, unused state 1) | **출시 후 1주 내** |
| 🟡 P2 (정리) | 6 (export 정리, 큰 파일 분해, 문서 이동, 브랜치 정리, .bkit, DB row) | **출시 후 여유 있을 때** |
| 🟢 P3 (정보) | 6 (전부 통과 / 거짓양성) | 조치 불필요 |

**핵심**: 발송·결제·인증 경로는 안전. 코드 빚이 거의 없는 깔끔한 상태. **출시 차단 요소는 P0-1 한 건뿐**.
