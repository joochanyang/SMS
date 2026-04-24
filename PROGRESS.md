# SMS 문자사이트 (SovereignSMS) 작업 진행 현황

> 마지막 업데이트: 2026-04-24 12:00 (TXG 전달률 추적 시스템 완성 — DLR 보안 + 폴링 이중화 + 프로바이더별 대시보드)
> 프로젝트: `/Users/mr.joo/Desktop/sms문자사이트`
> 감사 근거: `.planning/SECURITY-PLAN.md` 전 항목을 실제 코드와 대조

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
