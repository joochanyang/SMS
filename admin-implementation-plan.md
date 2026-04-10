# SovereignSMS 관리자 패널 — 완벽 구현 계획서

> 작성일: 2026-04-09
> 기반 문서: `admin-panel-research.md`
> 원칙: **SMS 크레딧 = 현금. 보안 실패 = 금전 손실. 오류 발송 = 비가역적 피해.**

---

## A. 프로젝트 구조 (완전 분리)

```
sms문자사이트/                    ← 기존 사용자 앱 (변경 최소화)
├── app/                        ← 사용자 페이지 (기존 유지)
├── lib/                        ← 공유 라이브러리 (prisma, infobip, sms-policy)
├── prisma/schema.prisma        ← DB 스키마 (관리자 테이블 추가)
│
├── admin/                      ★ 완전 분리된 관리자 앱 (별도 Next.js 앱)
│   ├── app/
│   │   ├── layout.tsx          ← 관리자 레이아웃 (사이드바 + 헤더)
│   │   ├── page.tsx            ← 대시보드 (메인)
│   │   ├── login/
│   │   │   └── page.tsx        ← 관리자 로그인 (MFA 포함)
│   │   ├── mfa-setup/
│   │   │   └── page.tsx        ← MFA 초기 설정
│   │   ├── mfa-verify/
│   │   │   └── page.tsx        ← MFA 검증 단계
│   │   │
│   │   ├── users/              ★ 사용자 관리
│   │   │   ├── page.tsx        ← 사용자 목록 (검색/필터/정렬)
│   │   │   └── [id]/
│   │   │       └── page.tsx    ← 사용자 상세 (프로필 + 크레딧 + 발송 이력)
│   │   │
│   │   ├── campaigns/          ★ 캠페인 모니터링
│   │   │   ├── page.tsx        ← 전체 캠페인 목록 (실시간)
│   │   │   └── [id]/
│   │   │       └── page.tsx    ← 캠페인 상세 (메시지별 상태)
│   │   │
│   │   ├── credits/            ★ 크레딧/재무
│   │   │   ├── page.tsx        ← 크레딧 관리 (충전/조정/이력)
│   │   │   ├── reconciliation/
│   │   │   │   └── page.tsx    ← 정산 대조
│   │   │   └── refunds/
│   │   │       └── page.tsx    ← 환불 관리
│   │   │
│   │   ├── blacklist/          ★ 블랙리스트/DNC
│   │   │   └── page.tsx        ← 블랙리스트 관리
│   │   │
│   │   ├── templates/          ★ 메시지 템플릿 승인
│   │   │   └── page.tsx        ← 템플릿 승인/반려
│   │   │
│   │   ├── settings/           ★ 시스템 설정
│   │   │   ├── page.tsx        ← 발송 한도, 알림, 킬스위치
│   │   │   └── admins/
│   │   │       └── page.tsx    ← 관리자 계정 관리
│   │   │
│   │   ├── audit/              ★ 감사 로그
│   │   │   └── page.tsx        ← 감사 로그 조회/검색
│   │   │
│   │   └── api/                ★ 관리자 전용 API
│   │       ├── auth/
│   │       │   ├── login/route.ts       ← 로그인 (argon2id + IP 검증)
│   │       │   ├── mfa-verify/route.ts  ← MFA TOTP 검증
│   │       │   ├── mfa-setup/route.ts   ← MFA 초기 설정
│   │       │   ├── logout/route.ts      ← 로그아웃 (세션 삭제)
│   │       │   └── session/route.ts     ← 세션 확인
│   │       ├── users/
│   │       │   ├── route.ts             ← GET: 목록, POST: 생성
│   │       │   └── [id]/
│   │       │       ├── route.ts         ← GET: 상세, PATCH: 수정
│   │       │       ├── suspend/route.ts ← POST: 정지/해제
│   │       │       └── credits/route.ts ← POST: 크레딧 조정
│   │       ├── campaigns/
│   │       │   ├── route.ts             ← GET: 전체 캠페인 목록
│   │       │   └── [id]/
│   │       │       ├── route.ts         ← GET: 상세
│   │       │       └── stop/route.ts    ← POST: 긴급 중지
│   │       ├── credits/
│   │       │   ├── ledger/route.ts      ← GET: 크레딧 원장
│   │       │   ├── reconciliation/route.ts ← GET/POST: 정산 대조
│   │       │   └── refunds/
│   │       │       ├── route.ts         ← GET: 환불 목록, POST: 환불 요청
│   │       │       └── [id]/route.ts    ← PATCH: 승인/거부
│   │       ├── blacklist/
│   │       │   └── route.ts             ← CRUD
│   │       ├── templates/
│   │       │   └── [id]/route.ts        ← PATCH: 승인/반려
│   │       ├── settings/
│   │       │   ├── route.ts             ← GET/PATCH: 시스템 설정
│   │       │   ├── kill-switch/route.ts ← POST: 킬스위치
│   │       │   └── admins/
│   │       │       ├── route.ts         ← CRUD 관리자 계정
│   │       │       └── [id]/route.ts    ← 개별 관리자 관리
│   │       ├── audit/
│   │       │   └── route.ts             ← GET: 감사 로그 조회
│   │       └── dashboard/
│   │           └── stats/route.ts       ← GET: 대시보드 통계
│   │
│   ├── lib/
│   │   ├── admin-auth.ts       ← 관리자 인증 (argon2id + TOTP)
│   │   ├── admin-session.ts    ← 세션 관리 (30분 타임아웃, IP 바인딩)
│   │   ├── rbac.ts             ← RBAC 권한 검증 미들웨어
│   │   ├── audit.ts            ← 감사 로그 기록 유틸
│   │   ├── rate-limit.ts       ← Rate Limiting (인메모리 + DB)
│   │   ├── anomaly.ts          ← 이상 탐지 로직
│   │   ├── notifications.ts    ← Telegram + 이메일 알림
│   │   └── sudo.ts             ← Sudo Mode (민감 작업 비밀번호 재확인)
│   │
│   ├── components/
│   │   ├── sidebar.tsx         ← 사이드바 네비게이션
│   │   ├── header.tsx          ← 헤더 (관리자 정보 + 킬스위치)
│   │   ├── data-table.tsx      ← 범용 데이터 테이블 (정렬/필터/페이지네이션)
│   │   ├── stat-card.tsx       ← 통계 카드
│   │   ├── confirm-modal.tsx   ← 이중 확인 모달
│   │   ├── sudo-modal.tsx      ← 비밀번호 재입력 모달
│   │   ├── kill-switch.tsx     ← 킬스위치 버튼
│   │   └── audit-badge.tsx     ← 감사 행위 뱃지
│   │
│   ├── proxy.ts                ← 관리자 Proxy (인증 + IP 검증)
│   ├── next.config.ts
│   ├── package.json
│   └── tsconfig.json
│
└── shared/                     ★ 사용자 앱 + 관리자 앱 공유
    ├── prisma.ts               ← Prisma Client (기존 lib/prisma.ts 이동)
    ├── infobip.ts              ← Infobip Client
    └── sms-policy.ts           ← SMS 정책
```

---

## B. 에이전트 팀 구성

| 에이전트 | 담당 | 활용 단계 |
|---------|------|----------|
| **security-auditor** | 인증/RBAC/세션 보안 검증 | Phase 1 완료 후 |
| **typescript-pro** | Prisma 스키마, 타입 안전성, Zod 검증 | Phase 1~4 |
| **database-architect** | 스키마 설계, 인덱스, 파티셔닝 | Phase 1 |
| **frontend-architect** | 관리자 UI 컴포넌트, 레이아웃 | Phase 3~4 |
| **test-automator** | 보안 테스트, API 테스트 | Phase 5 |
| **performance-engineer** | 대시보드 실시간 성능, 쿼리 최적화 | Phase 4 |

---

## C. DB 스키마 변경 명세

### C-1. 신규 테이블 (Prisma Schema 추가)

```prisma
// ===== 관리자 계정 =====
model AdminUser {
  id                String   @id @default(cuid())
  email             String   @unique
  passwordHash      String                          // argon2id
  name              String
  role              String   @default("VIEWER")     // SUPER_ADMIN, ADMIN, SUPPORT, VIEWER
  status            String   @default("ACTIVE")     // ACTIVE, LOCKED, DISABLED

  // MFA
  mfaSecret         String?                         // TOTP secret (AES-256-GCM 암호화)
  mfaEnabled        Boolean  @default(false)
  mfaBackupCodes    String[] @default([])            // 해시된 백업 코드

  // 보안
  allowedIps        String[] @default([])            // IP 화이트리스트
  failedLoginCount  Int      @default(0)
  lockedUntil       DateTime?
  passwordChangedAt DateTime @default(now())
  previousPasswords String[] @default([])            // 최근 10개 해시

  // 한도
  dailyCreditLimit  Float    @default(5000000)       // 일일 크레딧 조정 한도 (원)

  // 타임스탬프
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  lastLoginAt       DateTime?
  createdById       String?
  createdBy         AdminUser? @relation("AdminCreator", fields: [createdById], references: [id])
  createdAdmins     AdminUser[] @relation("AdminCreator")

  // Relations
  sessions          AdminSession[]
  auditLogs         AuditLog[]

  @@index([email])
  @@index([role, status])
}

// ===== 관리자 세션 =====
model AdminSession {
  id              String    @id @default(cuid())
  adminId         String
  admin           AdminUser @relation(fields: [adminId], references: [id], onDelete: Cascade)
  sessionToken    String    @unique
  ipAddress       String
  userAgent       String?
  expiresAt       DateTime
  lastActivityAt  DateTime  @default(now())
  mfaVerified     Boolean   @default(false)          // MFA 검증 완료 여부
  createdAt       DateTime  @default(now())

  @@index([sessionToken])
  @@index([adminId])
  @@index([expiresAt])
}

// ===== 감사 로그 (불변) =====
model AuditLog {
  id            String    @id @default(cuid())
  timestamp     DateTime  @default(now())
  adminId       String
  admin         AdminUser @relation(fields: [adminId], references: [id])
  adminEmail    String                               // 비정규화
  action        String                               // LOGIN, USER_SUSPEND, CREDIT_ADJUST 등
  targetType    String                               // USER, CAMPAIGN, SYSTEM, CREDIT, ADMIN
  targetId      String?
  previousValue Json?                                // 변경 전
  newValue      Json?                                // 변경 후
  reason        String                               // 사유 (필수)
  ipAddress     String
  userAgent     String?
  result        String    @default("SUCCESS")         // SUCCESS, FAILURE
  metadata      Json?

  @@index([adminId, timestamp])
  @@index([action, timestamp])
  @@index([targetType, targetId, timestamp])
  @@index([timestamp])
}

// ===== 시스템 설정 =====
model SystemSetting {
  key          String   @id
  value        Json
  category     String                                // RATE_LIMIT, SENDING, SECURITY, NOTIFICATION, COMPLIANCE, FINANCIAL
  description  String?
  isSensitive  Boolean  @default(false)
  updatedAt    DateTime @default(now()) @updatedAt
  updatedById  String?

  @@index([category])
}

// ===== 블랙리스트 =====
model Blacklist {
  id           String    @id @default(cuid())
  phoneNumber  String                                // E.164 (+821012345678)
  phoneHash    String                                // SHA-256
  type         String                                // SYSTEM, USER_OPTOUT, ADMIN, CARRIER, COMPLAINT
  reason       String?
  source       String?                               // 출처
  userId       String?                               // 특정 사용자 전용 블랙리스트
  isGlobal     Boolean   @default(true)
  createdAt    DateTime  @default(now())
  createdById  String?                               // 등록한 관리자
  expiresAt    DateTime?                             // NULL = 영구

  @@unique([phoneHash, userId])
  @@index([phoneHash])
  @@index([type])
  @@index([userId])
}

// ===== 크레딧 원장 (복식부기, 불변) =====
model CreditLedger {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  type            String                             // CHARGE, DEDUCT, REFUND, ADJUST, BONUS
  amount          Float                              // 양수=증가, 음수=감소
  balanceAfter    Float                              // 변동 후 잔액
  referenceType   String?                            // CAMPAIGN, ADMIN_ADJUST, PAYMENT, REFUND
  referenceId     String?
  description     String
  adminId         String?                            // 관리자 조정인 경우
  idempotencyKey  String?   @unique                  // 멱등성 키
  createdAt       DateTime  @default(now())

  @@index([userId, createdAt])
  @@index([type, createdAt])
}

// ===== 발송 한도 설정 =====
model RateLimitConfig {
  id              String    @id @default(cuid())
  targetType      String                             // GLOBAL, USER, SENDER_ID
  targetId        String?                            // NULL = 기본값
  maxPerSecond    Int?
  maxPerMinute    Int?
  maxPerHour      Int?
  maxPerDay       Int?
  maxPerCampaign  Int?
  maxCostPerDay   Float?
  maxCostPerMonth Float?
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  updatedById     String?

  @@index([targetType, targetId])
}

// ===== 메시지 템플릿 =====
model MessageTemplate {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  name          String
  content       String
  type          String                               // INFORMATIONAL, ADVERTISING, AUTHENTICATION
  status        String    @default("PENDING")         // PENDING, APPROVED, REJECTED, REVOKED
  reviewedById  String?
  reviewedAt    DateTime?
  rejectReason  String?
  variables     String[]  @default([])                // {{name}}, {{code}} 등
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([userId, status])
  @@index([status])
}

// ===== 환불 요청 =====
model RefundRequest {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  amount          Float
  reason          String
  evidence        Json?                              // 증빙 자료
  status          String    @default("PENDING")       // PENDING, APPROVED_L1, APPROVED_L2, EXECUTED, REJECTED
  requestedAt     DateTime  @default(now())
  l1ApprovedById  String?
  l1ApprovedAt    DateTime?
  l2ApprovedById  String?
  l2ApprovedAt    DateTime?
  executedAt      DateTime?
  rejectReason    String?

  @@index([userId, status])
  @@index([status])
}
```

### C-2. 기존 User 모델 수정

```prisma
model User {
  // ... 기존 필드 유지 ...
  status          String    @default("ACTIVE")       // NEW: ACTIVE, SUSPENDED, BANNED
  suspendedAt     DateTime?                          // NEW
  suspendReason   String?                            // NEW
  dailySendLimit  Int       @default(10000)           // NEW: 일일 발송 한도
  maxCampaignSize Int       @default(5000)            // NEW: 캠페인 최대 건수

  // NEW Relations
  creditLedger    CreditLedger[]
  templates       MessageTemplate[]
  refundRequests  RefundRequest[]
}
```

---

## D. 구현 단계 (Phase별 상세)

### Phase 1: 기반 인프라 + 인증 (CRITICAL)

> **목표**: 관리자 앱 스캐폴딩, 인증 시스템, 감사 로그가 동작하는 최소 기반

#### 단계 1-1: 프로젝트 초기화

* [ ] `admin/` 디렉토리에 Next.js 16 앱 생성
* [ ] `package.json` 설정 (의존성: argon2, otpauth, lucide-react, recharts, zod)
* [ ] `tsconfig.json` — strict mode, path aliases
* [ ] `next.config.ts` — basePath 없음 (별도 도메인 배포)
* [ ] 공유 라이브러리 참조 설정 (`shared/` → prisma, infobip, sms-policy)

**변경 파일**: `admin/package.json`, `admin/tsconfig.json`, `admin/next.config.ts`
**신규 파일**: `admin/` 디렉토리 전체

#### 단계 1-2: DB 스키마 확장

* [ ] `prisma/schema.prisma`에 관리자 테이블 7개 추가 (C-1 참조)
* [ ] User 모델에 status, dailySendLimit, 관계 필드 추가 (C-2 참조)
* [ ] `prisma db push` 또는 마이그레이션 실행
* [ ] 검증: `prisma studio`에서 테이블 확인

**변경 파일**: `prisma/schema.prisma`

#### 단계 1-3: 관리자 인증 시스템

* [ ] `admin/lib/admin-auth.ts` 구현
  - argon2id 해싱 (memory=65536, iterations=3, parallelism=4)
  - 비밀번호 정책 검증 (16자 이상, 대소문자+숫자+특수)
  - 이전 10개 비밀번호 재사용 방지
* [ ] `admin/lib/admin-session.ts` 구현
  - 세션 토큰 생성 (crypto.randomBytes(32))
  - HttpOnly + Secure + SameSite=Strict 쿠키
  - IP + User-Agent 바인딩
  - 30분 비활성 타임아웃, 8시간 절대 최대
  - 동시 세션 1개 제한 (새 로그인 시 기존 세션 무효화)
* [ ] `admin/api/auth/login/route.ts` 구현
  - POST: 이메일+비밀번호 → argon2id 검증
  - IP 화이트리스트 검증 (allowedIps 비어있으면 미검증, 있으면 필수)
  - 로그인 실패 카운트 (5회 → 15분 잠금, 10회 → 영구)
  - 성공 시 MFA 필요 여부 분기
  - 감사 로그: LOGIN_SUCCESS / LOGIN_FAILURE
* [ ] `admin/api/auth/mfa-setup/route.ts` 구현
  - GET: TOTP 시크릿 생성 + QR코드 URI 반환
  - POST: 코드 검증 → mfaEnabled=true, 백업코드 10개 반환
* [ ] `admin/api/auth/mfa-verify/route.ts` 구현
  - POST: TOTP 코드 검증 → 세션에 mfaVerified=true 마킹
  - 백업 코드로도 검증 가능 (일회용, 사용 후 삭제)
* [ ] `admin/api/auth/logout/route.ts` 구현
  - POST: 세션 삭제 + 쿠키 제거 + 감사 로그
* [ ] `admin/api/auth/session/route.ts` 구현
  - GET: 현재 세션 유효성 + 관리자 정보 반환
* [ ] 검증: 로그인 → MFA → 세션 → 로그아웃 전체 플로우 테스트
* [ ] 검증: 잘못된 비밀번호 5회 → 계정 잠금 확인
* [ ] 검증: 다른 IP에서 접속 시 차단 확인

**신규 파일**: `admin/lib/admin-auth.ts`, `admin/lib/admin-session.ts`, API 라우트 6개

#### 단계 1-4: RBAC 미들웨어

* [ ] `admin/lib/rbac.ts` 구현
  - 권한 매트릭스 정의 (역할별 허용 action 목록)
  - `requireRole(minRole)` — 최소 역할 검증
  - `requirePermission(action)` — 세분화 권한 검증
  - API 라우트에서 `const admin = await requireAuth(req); requirePermission(admin, 'CREDIT_ADJUST');`
* [ ] `admin/proxy.ts` 구현
  - 모든 `/api/` 요청에 세션 검증
  - 모든 페이지 요청에 세션 + MFA 검증
  - 미인증 → `/login` 리다이렉트
  - 세션 있지만 MFA 미완료 → `/mfa-verify` 리다이렉트

**신규 파일**: `admin/lib/rbac.ts`, `admin/proxy.ts`

#### 단계 1-5: 감사 로그 시스템

* [ ] `admin/lib/audit.ts` 구현
  ```typescript
  async function logAudit(params: {
    adminId: string;
    adminEmail: string;
    action: string;
    targetType: string;
    targetId?: string;
    previousValue?: any;
    newValue?: any;
    reason: string;
    req: NextRequest;
    result?: 'SUCCESS' | 'FAILURE';
  }): Promise<void>
  ```
  - 모든 관리자 API에서 호출
  - IP, User-Agent 자동 추출
  - 실패 시에도 기록 (try-catch 내부에서도)
* [ ] `admin/api/audit/route.ts` — GET: 감사 로그 조회 (SUPER_ADMIN + ADMIN)
  - 필터: 날짜 범위, 관리자, action, targetType
  - 페이지네이션 (커서 기반)
  - 감사 로그 조회 자체도 감사 로그에 기록

**신규 파일**: `admin/lib/audit.ts`, `admin/api/audit/route.ts`

#### 단계 1-6: Sudo Mode

* [ ] `admin/lib/sudo.ts` 구현
  - 크레딧 조정, 사용자 삭제, Kill Switch 등 민감 작업 시 비밀번호 재입력 요구
  - 검증 성공 시 5분간 sudo 상태 유지 (세션에 `sudoUntil` 타임스탬프)
* [ ] `admin/components/sudo-modal.tsx` — 비밀번호 재입력 모달

**신규 파일**: `admin/lib/sudo.ts`, `admin/components/sudo-modal.tsx`

#### 단계 1-7: 초기 SUPER_ADMIN 설정 API

* [ ] `admin/api/auth/setup/route.ts` 구현
  - POST: 최초 1회만 실행 가능 (AdminUser 0명일 때만)
  - SETUP_SECRET 환경변수 검증
  - SUPER_ADMIN 계정 생성 → MFA 설정 강제 안내
  - 이후 호출 → 403

**신규 파일**: `admin/api/auth/setup/route.ts`

---

### Phase 2: 핵심 관리 기능 (HIGH)

> **목표**: 사용자 관리, 크레딧 조정, 캠페인 모니터링, Kill Switch

#### 단계 2-1: 사용자 관리 API

* [ ] `admin/api/users/route.ts`
  - GET: 사용자 목록 (검색, 필터, 정렬, 페이지네이션)
    - 검색: 이메일, 이름 (LIKE)
    - 필터: 상태(ACTIVE/SUSPENDED/BANNED), 잔액 범위
    - 정렬: 가입일, 잔액, 이름
    - 페이지네이션: offset + limit (기본 20)
  - POST: 사용자 생성 (ADMIN 이상)
* [ ] `admin/api/users/[id]/route.ts`
  - GET: 사용자 상세 (프로필 + 최근 크레딧 이력 10건 + 최근 캠페인 10건 + 로그인 이력)
  - PATCH: 사용자 정보 수정 (이름, 일일한도, 캠페인한도)
  - 감사 로그 기록
* [ ] `admin/api/users/[id]/suspend/route.ts`
  - POST: `{ action: "suspend" | "unsuspend" | "ban", reason: string }`
  - 정지 시: status=SUSPENDED, suspendedAt=now, suspendReason 기록
  - 정지된 사용자의 진행 중 캠페인 자동 일시정지
  - 해제 시: status=ACTIVE, suspendedAt/suspendReason null
  - 감사 로그 기록

**신규 파일**: API 라우트 3개

#### 단계 2-2: 크레딧 관리 API

* [ ] `admin/api/users/[id]/credits/route.ts`
  - POST: 크레딧 조정
    ```typescript
    body: {
      type: "CHARGE" | "DEDUCT" | "ADJUST" | "BONUS";
      amount: number;        // 양수
      reason: string;        // 필수, 최소 10자
      sudoToken?: string;    // 10만원 이상 시 sudo 검증
    }
    ```
  - 검증:
    - 금액 > 0 확인
    - reason 최소 10자
    - DEDUCT 시 잔액 >= 금액 확인
    - 10만원 이상: sudo mode 필요
    - 100만원 이상: SUPER_ADMIN만 가능
    - 관리자별 일일 한도 초과 검증
  - 실행:
    - DB 트랜잭션: User.credits 갱신 + CreditLedger INSERT
    - `{ decrement }` 또는 `{ increment }` 사용 (atomic)
    - CreditLedger에 balanceAfter 기록
    - idempotencyKey로 중복 방지
  - 감사 로그: CREDIT_ADJUST (before/after 스냅샷)
* [ ] `admin/api/credits/ledger/route.ts`
  - GET: 크레딧 원장 조회 (사용자 ID 필터, 날짜 범위, 타입 필터, 페이지네이션)

**신규 파일**: API 라우트 2개

#### 단계 2-3: 캠페인 모니터링 API

* [ ] `admin/api/campaigns/route.ts`
  - GET: 전체 캠페인 목록 (모든 사용자)
    - 필터: 상태, 사용자ID, 날짜 범위
    - 정렬: 생성일, 발송률
    - 실시간 통계: 발송중 캠페인 강조
* [ ] `admin/api/campaigns/[id]/route.ts`
  - GET: 캠페인 상세 + 메시지별 상태 (SmsLog 포함, 페이지네이션)
* [ ] `admin/api/campaigns/[id]/stop/route.ts`
  - POST: 캠페인 긴급 중지
    - PENDING/RETRY_PENDING 로그 → CANCELLED
    - 미발송 건 크레딧 자동 환불 (기존 취소 로직 재사용)
    - 감사 로그: CAMPAIGN_STOP

**신규 파일**: API 라우트 3개

#### 단계 2-4: Kill Switch API

* [ ] `admin/api/settings/kill-switch/route.ts`
  - GET: 현재 킬스위치 상태
  - POST: 킬스위치 활성화/비활성화
    - `{ level: "NORMAL" | "GLOBAL_PAUSE" | "GLOBAL_STOP", reason: string }`
    - SUPER_ADMIN만 가능
    - sudo mode 필수
    - GLOBAL_PAUSE: 모든 진행 중 캠페인 일시정지
    - GLOBAL_STOP: 모든 캠페인 중지 + 미발송 환불
    - Telegram 알림 발송
    - 감사 로그: KILL_SWITCH_ACTIVATE / KILL_SWITCH_DEACTIVATE
* [ ] 사용자 앱 `campaign/[id]/process/route.ts` 수정
  - 발송 전 SystemSetting의 kill_switch_status 확인
  - GLOBAL_PAUSE/GLOBAL_STOP이면 발송 거부 (429 반환)
  - 정지된 사용자(status !== "ACTIVE")면 발송 거부

**신규 파일**: API 라우트 1개
**변경 파일**: `app/api/sms/campaign/[id]/process/route.ts`

#### 단계 2-5: 발송 한도 설정 API

* [ ] `admin/api/settings/route.ts`
  - GET: 시스템 설정 전체 조회 (카테고리별)
  - PATCH: 설정 변경 (SUPER_ADMIN + ADMIN)
    - 감사 로그 기록 (before/after)
* [ ] RateLimitConfig CRUD (전역 한도 + 사용자별 한도)
* [ ] 사용자 앱 연동: 캠페인 생성 시 한도 검증 로직 추가

**신규 파일**: API 라우트 1개
**변경 파일**: `app/api/sms/campaign/route.ts` (한도 검증 추가)

---

### Phase 3: 관리자 UI (HIGH)

> **목표**: 모든 관리 기능을 위한 프론트엔드

#### 단계 3-1: 레이아웃 + 공통 컴포넌트

* [ ] `admin/app/layout.tsx` — 루트 레이아웃 (CSS 변수, 폰트)
  - 디자인: 다크 테마 (기존 Sovereign 테마와 일관)
  - 사이드바 + 헤더 + 메인 콘텐츠 3단 구조
* [ ] `admin/components/sidebar.tsx`
  ```
  [로고] SovereignSMS Admin
  ─────────────────────
  📊 대시보드
  👥 사용자 관리
  📨 캠페인 모니터링
  💰 크레딧 관리
  🚫 블랙리스트
  📝 템플릿 관리
  ⚙️ 시스템 설정
  📋 감사 로그
  ─────────────────────
  🔴 Kill Switch [NORMAL]
  👤 admin@sovereign.com
  🚪 로그아웃
  ```
* [ ] `admin/components/header.tsx` — 현재 페이지 타이틀 + 킬스위치 상태 표시
* [ ] `admin/components/data-table.tsx` — 범용 테이블 (정렬, 필터, 페이지네이션)
* [ ] `admin/components/stat-card.tsx` — 통계 카드 (숫자 + 변동률)
* [ ] `admin/components/confirm-modal.tsx` — 이중 확인 모달 ("정말 실행하시겠습니까?")
* [ ] `admin/components/kill-switch.tsx` — 킬스위치 토글 (빨간색, 확인 모달 연동)

**신규 파일**: 레이아웃 1개 + 컴포넌트 6개

#### 단계 3-2: 로그인 + MFA 페이지

* [ ] `admin/app/login/page.tsx` — 이메일 + 비밀번호 폼
  - 실패 시 남은 시도 횟수 표시
  - 계정 잠금 시 잠금 해제 시간 표시
* [ ] `admin/app/mfa-verify/page.tsx` — TOTP 6자리 입력
  - "백업 코드 사용" 링크
  - 30초 타이머 표시
* [ ] `admin/app/mfa-setup/page.tsx` — QR코드 + 수동 입력 키 표시
  - 6자리 확인 코드 입력
  - 백업 코드 10개 표시 (다운로드 버튼)

**신규 파일**: 페이지 3개

#### 단계 3-3: 대시보드 메인

* [ ] `admin/app/page.tsx` — 대시보드
  ```
  ┌──────────────────────────────────────────────────┐
  │  오늘 발송      오늘 성공률      오늘 비용         │
  │  45,231건       97.0%          ₩2,715,860       │
  │  ▲12.3%         ▼0.5%          ▲8.2%            │
  ├──────────────────────────────────────────────────┤
  │  [실시간 발송 TPS 차트] (최근 1시간, 5초 갱신)     │
  ├──────────────────────────────────────────────────┤
  │  진행중 캠페인 (3건)                               │
  │  #1234 홍길동 10,000건 중 4,521건 ████░░░ 45.2%   │
  │  #1235 김철수  5,000건 중 5,000건 ████████ 100%    │
  ├──────────────────────────────────────────────────┤
  │  시스템 상태                                       │
  │  Infobip: ✅ (p95: 120ms)  DB: ✅  큐: 1,234건    │
  ├──────────────────────────────────────────────────┤
  │  최근 알림 (5건)                                   │
  └──────────────────────────────────────────────────┘
  ```
* [ ] `admin/api/dashboard/stats/route.ts` — 대시보드 통계 API
  - 오늘 총 발송/성공/실패/비용
  - 진행중 캠페인 목록
  - 시스템 상태 (DB, Infobip)
  - 전일 대비 증감률

**신규 파일**: 페이지 1개 + API 1개

#### 단계 3-4: 사용자 관리 페이지

* [ ] `admin/app/users/page.tsx` — 사용자 목록
  - 검색바 (이메일/이름)
  - 필터: 상태(전체/활성/정지/차단), 잔액 범위
  - 테이블: 이메일, 이름, 잔액, 상태, 가입일, 마지막 활동
  - 행 클릭 → 상세 페이지
  - 상태 뱃지 (ACTIVE=녹색, SUSPENDED=노란색, BANNED=빨간색)
* [ ] `admin/app/users/[id]/page.tsx` — 사용자 상세
  ```
  ┌──── 프로필 ─────┬──── 크레딧 ─────────────────┐
  │ 이름: 홍길동     │ 잔액: ₩1,234,567           │
  │ 이메일: hong@..  │ [충전] [차감] [보정]         │
  │ 상태: ACTIVE     │                             │
  │ 가입일: 2026-..  │ 최근 거래                    │
  │ [정지] [차단]    │ +500,000 충전 (04-09)       │
  │                  │ -25,000 캠페인 (04-09)       │
  ├──── 캠페인 이력 ─┴─────────────────────────────┤
  │ #1234 대량발송 10,000건 성공 97% ₩500,000       │
  │ #1233 알림발송  2,000건 성공 99% ₩100,000       │
  └────────────────────────────────────────────────┘
  ```
  - 크레딧 조정: 금액 + 유형 + 사유 입력 → 확인 모달 → (고액 시 sudo)
  - 사용자 정지/해제: 사유 입력 필수 → 확인 모달

**신규 파일**: 페이지 2개

#### 단계 3-5: 캠페인 모니터링 페이지

* [ ] `admin/app/campaigns/page.tsx` — 전체 캠페인 목록
  - 필터: 상태, 사용자, 날짜 범위
  - 진행중 캠페인 강조 (프로그레스바)
  - [긴급 중지] 버튼 (확인 모달)
* [ ] `admin/app/campaigns/[id]/page.tsx` — 캠페인 상세
  - 캠페인 정보 (사용자, 메시지, 상태, 통계)
  - 메시지 목록 (수신번호 마스킹, 상태, 발송 시간)
  - [긴급 중지] 버튼

**신규 파일**: 페이지 2개

#### 단계 3-6: 크레딧/재무 페이지

* [ ] `admin/app/credits/page.tsx` — 크레딧 원장
  - 전체 거래 이력 (필터: 사용자, 유형, 날짜)
  - 일일 요약 (총 충전, 총 차감, 총 환불)
* [ ] `admin/app/credits/refunds/page.tsx` — 환불 관리
  - 대기 중 환불 요청 목록
  - 승인/거부 버튼 (사유 입력)

**신규 파일**: 페이지 2개

#### 단계 3-7: 시스템 설정 + 감사 로그 페이지

* [ ] `admin/app/settings/page.tsx` — 시스템 설정
  - 발송 한도 (전역 일일/TPS/캠페인 상한)
  - 승인 임계값
  - 킬스위치 상태 + 토글
  - 알림 설정
* [ ] `admin/app/settings/admins/page.tsx` — 관리자 계정 관리
  - SUPER_ADMIN만 접근
  - 관리자 목록 (역할, 상태, 마지막 로그인)
  - 관리자 추가/수정/잠금/해제
* [ ] `admin/app/audit/page.tsx` — 감사 로그
  - 필터: 날짜, 관리자, 행위 유형, 대상
  - 상세 보기 (before/after JSON diff)

**신규 파일**: 페이지 3개

#### 단계 3-8: 블랙리스트 + 템플릿 페이지

* [ ] `admin/app/blacklist/page.tsx` — 블랙리스트 관리
  - 번호 추가 (단건 + CSV 업로드)
  - 검색 (번호, 유형)
  - 삭제 (사유 입력)
* [ ] `admin/app/templates/page.tsx` — 템플릿 승인
  - 대기 중 템플릿 목록
  - 미리보기 + 승인/반려 (사유)

**신규 파일**: 페이지 2개

---

### Phase 4: 안전 장치 + 모니터링 (HIGH)

> **목표**: 이상 탐지, 알림, Infobip 연동 강화

#### 단계 4-1: 이상 탐지 엔진

* [ ] `admin/lib/anomaly.ts` 구현
  - `checkVolumeAnomaly(userId)` — 7일 평균 대비 300% 초과 감지
  - `checkFailureRate(campaignId)` — 실패율 30% 초과 감지
  - `checkQuietHours(userId)` — 23:00~06:00 대량 발송 감지
  - `checkDuplicateRecipient(phone, minutes)` — 중복 수신 감지
  - `checkCreditDrain(userId)` — 1시간 내 80% 크레딧 소진 감지
* [ ] 사용자 앱 연동: 캠페인 생성/process 시 이상 탐지 호출
  - 이상 감지 → 자동 캠페인 일시정지 + 관리자 알림

**신규 파일**: `admin/lib/anomaly.ts`
**변경 파일**: `app/api/sms/campaign/route.ts`, `app/api/sms/campaign/[id]/process/route.ts`

#### 단계 4-2: 알림 시스템

* [ ] `admin/lib/notifications.ts` 구현
  - `sendTelegramAlert(message, level)` — Telegram Bot API
  - `sendEmailAlert(to, subject, body)` — Nodemailer 또는 외부 SMTP
  - 알림 레벨: INFO, WARNING, CRITICAL
  - 중복 알림 방지 (동일 알림 15분 쿨다운)

**신규 파일**: `admin/lib/notifications.ts`

#### 단계 4-3: Rate Limiting

* [ ] `admin/lib/rate-limit.ts` 구현
  - 인메모리 sliding window (Map + setTimeout)
  - 관리자 API: 60req/min
  - 로그인 API: 10req/min
  - 크레딧 조정 API: 5req/min
* [ ] 사용자 앱 발송 API에도 rate limit 추가
  - 사용자별 + 전역 TPS 제한
  - SystemSetting + RateLimitConfig에서 설정값 조회

**신규 파일**: `admin/lib/rate-limit.ts`
**변경 파일**: `app/api/sms/campaign/[id]/process/route.ts`

#### 단계 4-4: 블랙리스트 발송 차단 연동

* [ ] 사용자 앱 캠페인 생성 시 블랙리스트 자동 필터링
  - 수신자 목록에서 블랙리스트 번호 자동 제외
  - 제외된 건수 응답에 포함
  - 크레딧은 제외 후 건수 기준으로 차감

**변경 파일**: `app/api/sms/campaign/route.ts`

---

### Phase 5: 테스트 + 보안 검증 (HIGH)

> **목표**: 전체 보안 검증, 엣지 케이스 테스트

#### 단계 5-1: 보안 테스트

* [ ] 인증 테스트
  - 잘못된 비밀번호 5회 → 잠금 확인
  - MFA 코드 오류 → 거부 확인
  - 만료된 세션으로 API 호출 → 401 확인
  - 다른 IP에서 세션 사용 → 무효화 확인
  - VIEWER 역할로 ADMIN API 호출 → 403 확인
* [ ] 크레딧 안전 테스트
  - 동시 크레딧 조정 → 정확한 잔액 확인
  - 음수 잔액 시도 → 거부 확인
  - 100만원 이상 조정 → SUPER_ADMIN 외 거부 확인
  - 일일 한도 초과 → 거부 확인
* [ ] Kill Switch 테스트
  - GLOBAL_PAUSE → 발송 API 429 확인
  - GLOBAL_STOP → 진행 중 캠페인 취소 + 환불 확인
  - NORMAL 복귀 → 발송 재개 확인

#### 단계 5-2: 감사 로그 검증

* [ ] 모든 관리자 행위에 대한 감사 로그 생성 확인
* [ ] 감사 로그 DELETE/UPDATE 시도 → 실패 확인 (DB 트리거)
* [ ] before/after 스냅샷 정확성 확인

#### 단계 5-3: 빌드 + 통합 테스트

* [ ] `npx next build` (사용자 앱) — 성공 확인
* [ ] `npx next build` (관리자 앱) — 성공 확인
* [ ] TypeScript 에러 0건 확인
* [ ] 전체 API 수동 테스트 (curl/Postman)

---

### Phase 6: 배포 + Git (MEDIUM)

* [ ] 관리자 앱 `.env.example` 작성
* [ ] 전체 커밋 + 푸시
* [ ] (선택) 관리자 앱 별도 배포 (Vercel 또는 서버)

---

## E. 변경 파일 전체 요약

### 신규 파일 (관리자 앱 — `admin/`)

| 카테고리 | 파일 수 | 파일 목록 |
|---------|---------|----------|
| 프로젝트 설정 | 3 | package.json, tsconfig.json, next.config.ts |
| 라이브러리 | 8 | admin-auth, admin-session, rbac, audit, rate-limit, anomaly, notifications, sudo |
| 컴포넌트 | 7 | sidebar, header, data-table, stat-card, confirm-modal, sudo-modal, kill-switch |
| 페이지 | 15 | login, mfa-setup, mfa-verify, dashboard, users(2), campaigns(2), credits(2), blacklist, templates, settings(2), audit |
| API 라우트 | 20 | auth(6), users(3), campaigns(3), credits(2), blacklist(1), templates(1), settings(3), audit(1), dashboard(1) |
| Proxy | 1 | proxy.ts |
| **합계** | **54** | |

### 변경 파일 (기존 사용자 앱)

| 파일 | 변경 내용 |
|------|----------|
| `prisma/schema.prisma` | 관리자 테이블 7개 + User 모델 필드 추가 |
| `app/api/sms/campaign/route.ts` | 한도 검증 + 블랙리스트 필터 + 사용자 상태 검증 |
| `app/api/sms/campaign/[id]/process/route.ts` | Kill Switch 검증 + 사용자 상태 검증 + Rate Limit |

---

## F. 기술 스택 (관리자 앱)

| 영역 | 기술 | 이유 |
|------|------|------|
| 프레임워크 | Next.js 16 (App Router) | 사용자 앱과 동일 |
| 언어 | TypeScript (strict) | 타입 안전성 |
| DB ORM | Prisma 7.7 | 사용자 앱과 공유 |
| 비밀번호 | argon2 | bcrypt 대비 GPU 공격 저항 우수 |
| MFA | otpauth | TOTP RFC 6238 구현 |
| 검증 | Zod 4 | 입력 스키마 검증 |
| 차트 | Recharts 3 | 사용자 앱에 이미 설치됨 |
| 아이콘 | Lucide React | 사용자 앱에 이미 설치됨 |
| 스타일 | Vanilla CSS (다크 테마) | 사용자 앱과 일관된 디자인 |
| 애니메이션 | Framer Motion | 사용자 앱에 이미 설치됨 |

---

## G. 환경변수 (관리자 앱)

```env
# DB (사용자 앱과 동일)
DATABASE_URL="prisma+postgres://..."

# 관리자 세션
ADMIN_SESSION_SECRET="openssl rand -base64 64"

# 초기 설정
ADMIN_SETUP_SECRET="one-time-setup-secret"

# MFA 암호화 키 (AES-256-GCM)
MFA_ENCRYPTION_KEY="openssl rand -hex 32"

# Telegram 알림
TELEGRAM_BOT_TOKEN="bot-token"
TELEGRAM_CHAT_ID="chat-id"

# Infobip (사용자 앱과 동일)
INFOBIP_API_KEY="..."
INFOBIP_URL="..."
```

---

## H. 실행 순서 요약

```
Phase 1 (기반)           Phase 2 (핵심)           Phase 3 (UI)
├─ 1-1 프로젝트 초기화    ├─ 2-1 사용자 API        ├─ 3-1 레이아웃/컴포넌트
├─ 1-2 DB 스키마          ├─ 2-2 크레딧 API        ├─ 3-2 로그인/MFA
├─ 1-3 인증 시스템        ├─ 2-3 캠페인 API        ├─ 3-3 대시보드
├─ 1-4 RBAC              ├─ 2-4 Kill Switch       ├─ 3-4 사용자 관리
├─ 1-5 감사 로그          └─ 2-5 발송 한도          ├─ 3-5 캠페인
├─ 1-6 Sudo Mode                                   ├─ 3-6 크레딧/재무
└─ 1-7 초기 설정                                    ├─ 3-7 설정/감사
                                                    └─ 3-8 블랙리스트/템플릿

Phase 4 (안전장치)        Phase 5 (검증)           Phase 6 (배포)
├─ 4-1 이상 탐지          ├─ 5-1 보안 테스트       ├─ .env.example
├─ 4-2 알림 시스템        ├─ 5-2 감사 로그 검증    ├─ 커밋 + 푸시
├─ 4-3 Rate Limiting     └─ 5-3 빌드 + 통합       └─ 배포
└─ 4-4 블랙리스트 연동
```

---

## I. 핵심 설계 원칙 (재확인)

1. **크레딧 조정 = 금융 거래**: 이중확인 + 감사로그 + 멱등성 + DB 트랜잭션
2. **감사 로그 불변**: DELETE/UPDATE 트리거로 차단. 5년 보존.
3. **Kill Switch 즉시 작동**: 1클릭으로 전체 발송 중단. 미발송 자동 환불.
4. **MFA 필수**: 비밀번호만으로 관리자 접근 불가.
5. **최소 권한**: VIEWER는 조회만, SUPPORT는 변경 불가, ADMIN은 고액 불가.
6. **완전 분리**: 관리자 앱은 별도 프로세스, 별도 도메인, 별도 인증 체계.
7. **오류 발송 방지**: 한도 체계(3계층) + 이상 탐지 + 블랙리스트 + 승인 워크플로우.
