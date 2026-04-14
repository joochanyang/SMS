# SMS 문자사이트 (SovereignSMS) 작업 진행 현황

> 마지막 업데이트: 2026-04-11 (USDT-TRC20 자동 충전 시스템 완료)
> 프로젝트: `/Users/mr.joo/Desktop/sms문자사이트`

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

## 남은 작업 (우선순위순)

### P0: CRITICAL — 배포 전 필수

| # | 작업 | 설명 | 예상 |
|---|------|------|------|
| ~~1~~ | ~~**admin 패널 middleware 추가**~~ | ✅ 이미 `admin/proxy.ts` 구현 완료 | 완료 |
| 2 | **DLR 웹훅 외부 URL 등록** | localhost에서는 Infobip 콜백 불가. 배포 후 Infobip 대시보드에서 DLR URL 등록 필요 | 배포 후 |
| 3 | **Infobip 발신번호 설정** | 현재 `from` 미지정. Infobip 자동할당 중. 필요시 Sender ID 등록 | 10분 |

### P1: HIGH — 핵심 기능 완성

| # | 작업 | 설명 | 예상 |
|---|------|------|------|
| ~~4~~ | ~~**크레딧 충전 기능**~~ | ✅ 쿠폰코드 시스템 구현 (CreditCoupon 모델 + 유저 redeem API + admin 쿠폰 생성 API + 지갑 UI) | 완료 |
| ~~5~~ | ~~**블랙리스트 발송 차단 연동**~~ | ✅ 캠페인 생성 시 필터링 + 발송 시 이중 체크 + 차단 건 환불 처리 | 완료 |
| ~~6~~ | ~~**캠페인 자동 process**~~ | ✅ cron API 존재 + rate limit 적용 + 헬스체크 `/api/health` + `scripts/cron-setup.md` 문서 + `.env.example` | 완료 |
| ~~7~~ | ~~**회원가입 기능**~~ | ✅ `/register` 페이지 + `/api/auth/register` API + 로그인↔회원가입 링크 연결 | 완료 |

### P2: MEDIUM — 운영 품질

| # | 작업 | 설명 | 예상 |
|---|------|------|------|
| ~~8~~ | ~~**Rate Limiting 적용**~~ | ✅ 전체 API 7개에 적용 완료 (register 3/10, redeem 5/30, stats 30/300, dlr 200/5000, campaign GET 30/300, cron 5/120, campaign POST 기존) | 완료 |
| ~~9~~ | ~~**에러 모니터링/구조화 로깅**~~ | ✅ `lib/logger.ts` 구조화 로거 이미 구현 (dev=컬러, prod=JSON, LOG_LEVEL 필터링) | 완료 |
| ~~10~~ | ~~**테스트 코드**~~ | ✅ 69개 테스트 (sms-policy 42개 + rate-limiter 8개 + logger 12개 + 엣지케이스 7개) 전부 통과 | 완료 |
| ~~11~~ | ~~**SMS 발송 페이지 UX 개선**~~ | ✅ CSV 드래그앤드롭 + 유효/무효 번호 카운트 + 발송 확인 모달 + 발송 중 취소 버튼 | 완료 |
| ~~12~~ | ~~**캠페인 상세 페이지**~~ | ✅ 상태 필터링(6종) + 진행률 바 + 재발송 API/UI(`/api/sms/campaign/[id]/retry`) + 메시지 전문 토글 | 완료 |

### P3: LOW — 개선/배포

| # | 작업 | 설명 | 예상 |
|---|------|------|------|
| 13 | **admin↔유저앱 배포 구성** | 두 개 별도 Next.js 앱. 포트/도메인 설정 미정의 | 1시간 |
| ~~14~~ | ~~**대시보드 통계/차트**~~ | ✅ recharts AreaChart + PieChart + 오버뷰 카드 4개 이미 구현 완료 | 완료 |
| ~~15~~ | ~~**방치 데이터 정리**~~ | ✅ `scripts/cleanup-test-data.ts` 스크립트 이미 존재 (dry-run 지원, 트랜잭션 안전 삭제) | 완료 |
| ~~16~~ | ~~**`sms/send` 레거시 API 정리**~~ | ✅ 이미 제거됨 — `app/api/sms/` 아래 campaign만 존재 | 완료 |

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
