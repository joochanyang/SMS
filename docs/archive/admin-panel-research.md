# SovereignSMS 관리자 패널 — 종합 기능·보안 설계서

> 작성일: 2026-04-09
> 핵심 원칙: **SMS 크레딧 = 현금** — 보안 침해 = 금전 손실, 오류 발송 = 비가역적 손해

---

## 1. 필수 관리자 기능 (Must-Have)

### 1.1 사용자 관리

| 기능 | 상세 | 우선순위 |
|------|------|----------|
| **사용자 CRUD** | 생성·조회·수정·삭제 (soft-delete 필수, 하드삭제 금지) | CRITICAL |
| **계정 상태 관리** | ACTIVE / SUSPENDED / BANNED / PENDING_VERIFICATION 4단계 | CRITICAL |
| **계정 일시정지** | 사유 입력 필수 + 자동해제 타이머 옵션 (예: 24시간 후 자동해제) | HIGH |
| **크레딧 수동 조정** | 충전·차감·보정 — 반드시 사유 입력 + 이중확인 | CRITICAL |
| **크레딧 조정 이력** | 누가, 언제, 얼마, 왜 조정했는지 불변 로그 | CRITICAL |
| **사용자 검색·필터** | 이름, 이메일, 전화번호, 가입일, 잔액 범위, 상태별 | HIGH |
| **사용자 상세 뷰** | 프로필 + 크레딧 이력 + 발송 이력 + 로그인 이력 한 화면 | HIGH |
| **API 키 관리** | 사용자별 API 키 발급/폐기/재발급, 사용량 모니터링 | HIGH |
| **대량 작업** | 다수 사용자 일괄 정지/해제/공지 발송 | MEDIUM |

### 1.2 캠페인 모니터링

| 기능 | 상세 |
|------|------|
| **실시간 현황판** | 진행중 캠페인 목록 — 발송률, 성공/실패/대기 수, 경과시간 |
| **캠페인 상세** | 개별 메시지 단위 상태 추적 (Infobip delivery report 연동) |
| **긴급 중지 (Kill Switch)** | 한 클릭으로 특정 캠페인 또는 전체 발송 즉시 중단. 대기열 큐 비우기 포함 |
| **재발송 관리** | 실패 건 선별 재발송, 중복발송 방지 체크 |
| **캠페인 승인 워크플로우** | 일정 건수(예: 1,000건) 초과 캠페인은 관리자 사전 승인 필요 |
| **발송 일시정지/재개** | 진행 중 캠페인을 일시정지하고 재개하는 기능 |
| **캠페인 예약 관리** | 예약된 캠페인 조회, 수정, 취소 |

### 1.3 크레딧/재무 관리

| 기능 | 상세 |
|------|------|
| **수동 충전** | 관리자가 사용자에게 크레딧 직접 부여 (입금 확인 후) |
| **거래 감사 추적** | 모든 크레딧 변동: 충전, 발송차감, 환불, 수동조정, 보정 — 전부 불변 로그 |
| **일일 정산 리포트** | 총 발송량, 총 크레딧 소비량, Infobip 실제 과금액과 비교 |
| **Infobip 비용 대조** | 내부 크레딧 소비 vs Infobip 실제 과금 자동 대조 (불일치 시 알림) |
| **환불 워크플로우** | 환불 요청 → 1차 승인 → 2차 승인(고액) → 실행 → 기록 |
| **수익 대시보드** | 기간별 매출, 마진, 사용자별 소비 순위 |

### 1.4 시스템 건강 모니터링

| 항목 | 메트릭 |
|------|--------|
| **Infobip API 상태** | 응답시간(p50/p95/p99), 오류율, 잔여 크레딧 |
| **발송 큐 상태** | 대기 메시지 수, 큐 지연시간, 처리 TPS |
| **DB 상태** | 커넥션 풀 사용률, 슬로 쿼리 수, 디스크 사용량 |
| **애플리케이션** | 메모리, CPU, 요청 처리량, 에러율 |
| **인증 시스템** | 로그인 실패율, MFA 사용률, 활성 세션 수 |

### 1.5 SMS 발송 제어

| 제어 항목 | 상세 |
|-----------|------|
| **사용자별 일일 한도** | 기본 10,000건/일, 관리자가 사용자별 조정 가능 |
| **전역 일일 한도** | 시스템 전체 일일 최대 발송량 설정 |
| **분당 발송률 제한** | 사용자별 + 전역 TPS 제한 |
| **캠페인 건수 상한** | 단일 캠페인 최대 수신자 수 제한 |
| **승인 워크플로우** | 설정 임계값 초과 시 자동으로 승인 대기 상태 |
| **글로벌 Kill Switch** | 모든 발송 즉시 중단 + 큐 동결 |
| **발송 시간 제한** | 광고성 SMS: 08:00~20:50 자동 강제 (야간 발송 차단) |

---

## 2. 보안 아키텍처 (CRITICAL)

### 2.1 관리자 인증

```
┌─────────────────────────────────────────────────────┐
│                  인증 흐름 (3단계)                      │
├─────────────────────────────────────────────────────┤
│  1. ID/PW 입력 → argon2id 검증                       │
│  2. TOTP MFA 입력 (Google Authenticator 등)           │
│  3. IP 화이트리스트 검증                                │
│  ──→ 세션 발급 (HttpOnly + Secure + SameSite=Strict)  │
└─────────────────────────────────────────────────────┘
```

| 항목 | 사양 |
|------|------|
| **비밀번호 해싱** | argon2id (memory=65536, iterations=3, parallelism=4) |
| **MFA 필수** | TOTP(RFC 6238) 필수. 백업 코드 10개 발급 (일회용) |
| **IP 화이트리스트** | 관리자별 허용 IP 목록. 미등록 IP 접속 시 차단+알림 |
| **세션 관리** | 유효시간 30분 (비활성 기준), 절대 최대 8시간. 동시 세션 1개 제한 |
| **세션 토큰** | HttpOnly, Secure, SameSite=Strict 쿠키. 로컬스토리지 저장 절대 금지 |
| **로그인 실패 대응** | 5회 실패 → 15분 잠금, 10회 → 영구 잠금 (슈퍼관리자 해제 필요) |
| **비밀번호 정책** | 최소 16자, 대소문자+숫자+특수 필수, 이전 10개 재사용 금지, 90일 변경 강제 |
| **세션 무효화** | 비밀번호 변경 시 모든 세션 즉시 무효화 |

### 2.2 역할 기반 접근 제어 (RBAC)

```
SUPER_ADMIN (1~2명)
├── 모든 권한
├── 다른 관리자 계정 관리
├── 시스템 설정 변경
├── 글로벌 Kill Switch
├── 크레딧 대량 조정 (100만원 이상)
└── 감사 로그 열람/다운로드

ADMIN (운영자)
├── 사용자 관리 (CRUD, 정지/해제)
├── 크레딧 소액 조정 (100만원 미만)
├── 캠페인 모니터링/중지
├── 환불 1차 승인
├── 블랙리스트 관리
└── 대시보드 열람

SUPPORT (고객지원)
├── 사용자 조회 (수정 불가)
├── 크레딧 이력 조회
├── 캠페인 조회 (중지 불가)
└── 블랙리스트 조회

VIEWER (모니터링 전용)
├── 대시보드 열람만 가능
└── 어떤 변경 작업도 불가
```

**권한 매트릭스:**

| 권한 | SUPER_ADMIN | ADMIN | SUPPORT | VIEWER |
|------|:-----------:|:-----:|:-------:|:------:|
| 사용자 생성/수정 | O | O | X | X |
| 사용자 조회 | O | O | O | X |
| 사용자 삭제(soft) | O | X | X | X |
| 크레딧 조정 (소액) | O | O | X | X |
| 크레딧 조정 (고액) | O | X | X | X |
| 캠페인 중지 | O | O | X | X |
| 글로벌 Kill Switch | O | X | X | X |
| 시스템 설정 변경 | O | X | X | X |
| 감사 로그 열람 | O | O(자기것) | X | X |
| 관리자 계정 관리 | O | X | X | X |
| 환불 승인 | O(2차) | O(1차) | X | X |
| 대시보드 열람 | O | O | O | O |

### 2.3 감사 로깅 (Audit Trail)

**모든 관리자 행위를 불변 로그로 기록. 삭제/수정 불가.**

```typescript
interface AuditLog {
  id: string;                    // ULID
  timestamp: DateTime;           // UTC
  adminId: string;
  adminEmail: string;            // 비정규화 (계정 삭제 대비)
  action: AuditAction;           // USER_SUSPEND, CREDIT_ADJUST, CAMPAIGN_STOP 등
  targetType: 'USER' | 'CAMPAIGN' | 'SYSTEM' | 'CREDIT' | 'ADMIN';
  targetId: string;
  previousValue: JSON;           // 변경 전 스냅샷
  newValue: JSON;                // 변경 후 스냅샷
  reason: string;                // 사유 (필수)
  ipAddress: string;
  userAgent: string;
  result: 'SUCCESS' | 'FAILURE';
}
```

**필수 기록 대상:**
- 로그인/로그아웃 (성공+실패)
- 사용자 상태 변경
- 크레딧 조정 (금액, 사유, 변경 전/후)
- 캠페인 중지/승인/거부
- 시스템 설정 변경
- 블랙리스트 추가/제거
- 관리자 계정 관리
- Kill Switch 활성화/비활성화
- **감사 로그 조회 자체도 기록**

**보존 정책:** 최소 5년 보존. 월별 파티셔닝. S3 백업.

### 2.4 API 보안

| 항목 | 구현 |
|------|------|
| **CSRF 방어** | Double Submit Cookie + SameSite=Strict |
| **Rate Limiting** | 60req/min (일반), 10req/min (인증) |
| **Request Signing** | 크레딧 조정 등 민감 API는 HMAC-SHA256 서명 |
| **입력 검증** | Zod 스키마. SQL Injection, XSS 방지 |
| **응답 보안** | 전화번호 마스킹 (010-****-1234), 스택트레이스 비노출 |
| **CORS** | 관리자 도메인만 허용 |
| **CSP** | strict CSP, inline script 금지 |
| **HSTS** | max-age=63072000; includeSubDomains; preload |

### 2.5 인프라 분리

```
[사용자 앱]              [관리자 앱]
app.sovereignsms.kr      admin.sovereignsms.kr
     │                        │
     │                        ├─ IP 화이트리스트
     │                        ├─ VPN 접속만 허용
     │                        └─ WAF 규칙 별도
     │                        │
     ▼                        ▼
[User API Server]        [Admin API Server]
(별도 프로세스)            (별도 프로세스)
     │                        │
     ▼                        ▼
┌──────────────────────────────┐
│     PostgreSQL (공유 DB)      │
│  - User API: 읽기+쓰기(제한)  │
│  - Admin API: 전체 접근       │
│  - DB 유저 계정 분리          │
└──────────────────────────────┘
```

### 2.6 브루트포스 방어

| 방어 계층 | 구현 |
|-----------|------|
| **1차** | IP당 로그인 시도 5회/15분 |
| **2차** | 계정당 실패 5회 → 15분 잠금 |
| **3차** | 동일 IP 다수 계정 시도 → IP 블록 |
| **4차** | 실패 3회 시 Telegram 알림 |
| **5차** | 실패 2회 후 CAPTCHA 활성화 |

### 2.7 세션 하이재킹 방어

- 세션 토큰에 IP + User-Agent 바인딩 (변경 시 즉시 무효화)
- HttpOnly + Secure + SameSite=Strict 필수
- 비활성 30분 경과 시 자동 로그아웃
- 민감 작업 시 비밀번호 재입력 요구 (sudo mode, 5분 유효)

---

## 3. 재무 안전 제어

### 3.1 크레딧 조정 이중 확인

```
1. 관리자가 조정 요청 입력 (대상, 유형, 금액, 사유 필수 10자 이상)
2. 확인 화면 — 현재 잔액, 조정 후 예상 잔액, 사유 재확인
3. 보안 검증:
   - 10만원 미만: 바로 실행
   - 10만~100만원: 비밀번호 재입력
   - 100만원 이상: SUPER_ADMIN 2차 승인 필요
4. DB 트랜잭션 + 감사 로그 (before/after 스냅샷)
```

- 관리자당 일일 수동 조정 한도: 최대 500만원
- 동일 사용자 1시간 내 중복 조정 경고
- 음수 잔액 절대 불가 (DB CHECK 제약)

### 3.2 발송 한도 체계 (3계층)

```
레벨 1: 사용자별 한도
├── 일일 발송 한도 (기본 10,000건)
├── 단일 캠페인 한도 (기본 5,000건)
├── 분당 한도 (기본 100건/분)

레벨 2: 시스템 전역 한도
├── 전역 일일 한도 (1,000,000건)
├── 전역 TPS (500)

레벨 3: 비용 기반 한도
├── 사용자별 일일 비용 한도
├── Infobip 잔여 크레딧 → 임계값 시 자동 중단
```

### 3.3 긴급 킬 스위치

```
NORMAL → USER_PAUSE → CAMPAIGN_STOP → GLOBAL_PAUSE → GLOBAL_STOP
```

1. 즉시 신규 메시지 큐 차단
2. 현재 Infobip 전송 중 배치는 완료 허용
3. 대기열 미전송 → CANCELLED
4. 미전송 건 크레딧 자동 환불
5. Telegram + 이메일 즉시 알림

### 3.4 이상 탐지

| 패턴 | 임계값 | 대응 |
|------|--------|------|
| 급격한 발송량 증가 | 7일 평균 대비 300% | 자동 정지 + 알림 |
| 비정상 시간 발송 | 23:00~06:00 대량 | 차단 + 알림 |
| 높은 실패율 | 30% 초과 | 사용자 자동 정지 |
| 빠른 크레딧 소진 | 1시간 내 80% 소진 | 알림 + 확인 |
| 동일 번호 반복 | 10분 내 5건 | 중복 차단 |
| 스팸 키워드 | 금지어 포함 | 승인 대기 전환 |

### 3.5 크레딧 정산 대조 (매일 자정)

1. 내부 발송 기록 합산 (DELIVERED + SENT)
2. Infobip Delivery Report API로 실제 과금 건수 조회
3. 비교: 일치 → 정상 / 내부 > Infobip → 과다차감 보정 / 내부 < Infobip → 조사
4. 불일치 시 자동 알림 + 상세 보고서
5. 주간 수동 확인 승인

### 3.6 환불 워크플로우

```
요청 접수 → SUPPORT 검토 → ADMIN 1차 승인 → (50만 이상) SUPER_ADMIN 2차 승인 → 실행 → 감사 로그
```

---

## 4. SMS 특화 안전 장치

### 4.1 메시지 발송 전 검증 파이프라인

```
1. 컴플라이언스 자동 검증
   ├── 광고성 → (광고) 접두사 확인
   ├── 080 수신거부 번호 포함 확인
   ├── 발송 시간 (08:00~20:50)
   └── 금지어/스팸 키워드 필터

2. 수신자 검증
   ├── 블랙리스트/DNC 자동 제외
   ├── 유효하지 않은 번호 제거
   ├── 중복 번호 제거
   └── 수신 거부 이력 확인

3. 대량 발송 승인 (임계값 초과 시)
   ├── 관리자 승인 요청 (미리보기 + 통계)
   ├── 샘플 발송 (100건) → 결과 확인 후 나머지
   └── 승인/거부/수정요청
```

### 4.2 블랙리스트/DNC 관리

| 기능 | 상세 |
|------|------|
| **유형** | SYSTEM / USER_OPTOUT / ADMIN / CARRIER / COMPLAINT |
| **080 자동 수집** | 수신거부 콜백 수신 시 자동 등록 |
| **CSV 가져오기/내보내기** | 대량 관리 |
| **블랙리스트 번호 발송 시도** | 자동 차단 + 크레딧 미차감 |

### 4.3 한국 통신 규정 (KISA)

- 정보통신망법 제50조: 사전 동의 + (광고) 표시 + 발신자 명칭 + 080 수신거부
- 야간 광고 금지: 20:51~07:59 자동 차단
- 발신번호 사전등록제: 미등록 번호 발송 원천 차단
- 위반 시 과태료 최대 3,000만원

### 4.4 발신번호 관리

- 사업자등록증 기반 본인 확인 후 등록
- 사용자는 등록·승인된 본인 번호만 사용 가능
- 미등록 번호 시스템 레벨 차단

### 4.5 템플릿 관리

```
사용자 등록 → 관리자 검토 (광고 여부, 규정 준수, 스팸 검사) → 승인/반려
수정 시 재승인 필요
```

---

## 5. 모니터링 및 알림

### 5.1 알림 임계값

| 메트릭 | WARNING | CRITICAL | 채널 |
|--------|---------|----------|------|
| 발송 성공률 | <95% | <90% | Telegram + 이메일 |
| Infobip 응답시간 | >500ms | >2s | Telegram |
| Infobip 에러율 | >5% | >15% | 모든 채널 |
| 큐 대기 | >10,000 | >50,000 | Telegram |
| DB 커넥션 풀 | >70% | >90% | Telegram |
| Infobip 잔액 | <100만원 | <10만원 | 모든 채널 |
| 시간당 비용 | 전일 대비 200% | 전일 대비 500% | Telegram + 자동 정지 |

---

## 6. 데이터베이스 스키마 추가

### 6.1 관리자 사용자

```sql
CREATE TABLE admin_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,                     -- argon2id
    name            VARCHAR(100) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'VIEWER'
                    CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'VIEWER')),
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'LOCKED', 'DISABLED')),
    mfa_secret      TEXT,                              -- TOTP (암호화 저장)
    mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_backup_codes TEXT[],
    allowed_ips     INET[] DEFAULT '{}',
    failed_login_count  INT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    previous_passwords  TEXT[] DEFAULT '{}',
    daily_credit_adjustment_limit  DECIMAL(15,2) DEFAULT 5000000,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ,
    created_by      UUID REFERENCES admin_users(id)
);
```

### 6.2 감사 로그 (불변, 파티셔닝)

```sql
CREATE TABLE audit_logs (
    id              UUID DEFAULT gen_random_uuid(),
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    admin_id        UUID NOT NULL,
    admin_email     VARCHAR(255) NOT NULL,
    action          VARCHAR(50) NOT NULL,
    target_type     VARCHAR(20) NOT NULL,
    target_id       VARCHAR(255),
    previous_value  JSONB,
    new_value       JSONB,
    reason          TEXT NOT NULL,
    ip_address      INET NOT NULL,
    user_agent      TEXT,
    result          VARCHAR(10) NOT NULL DEFAULT 'SUCCESS',
    metadata        JSONB DEFAULT '{}',
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- DELETE/UPDATE 방지 트리거 필수
```

### 6.3 시스템 설정

```sql
CREATE TABLE system_settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           JSONB NOT NULL,
    category        VARCHAR(50) NOT NULL,
    is_sensitive    BOOLEAN DEFAULT FALSE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID REFERENCES admin_users(id)
);
```

### 6.4 블랙리스트

```sql
CREATE TABLE blacklist (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number    VARCHAR(20) NOT NULL,
    phone_hash      VARCHAR(64) NOT NULL,              -- SHA-256
    type            VARCHAR(20) NOT NULL,
    reason          TEXT,
    user_id         UUID,
    is_global       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES admin_users(id),
    expires_at      TIMESTAMPTZ,
    UNIQUE(phone_hash, user_id)
);
```

### 6.5 크레딧 원장 (복식부기)

```sql
CREATE TABLE credit_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    type            VARCHAR(20) NOT NULL,              -- CHARGE, DEDUCT, REFUND, ADJUST
    amount          DECIMAL(15,2) NOT NULL,
    balance_after   DECIMAL(15,2) NOT NULL,
    reference_type  VARCHAR(30),
    reference_id    VARCHAR(255),
    description     TEXT NOT NULL,
    admin_id        UUID REFERENCES admin_users(id),
    idempotency_key VARCHAR(255) UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.6 기타

```sql
-- 발송 제한 설정
CREATE TABLE rate_limit_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type     VARCHAR(20) NOT NULL,              -- GLOBAL, USER, SENDER_ID
    target_id       VARCHAR(255),
    max_per_second  INT,
    max_per_minute  INT,
    max_per_hour    INT,
    max_per_day     INT,
    max_per_campaign INT,
    max_cost_per_day    DECIMAL(15,2),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by      UUID REFERENCES admin_users(id)
);

-- 발신번호 등록
CREATE TABLE sender_ids (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    phone_number    VARCHAR(20) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    approved_by     UUID REFERENCES admin_users(id),
    approved_at     TIMESTAMPTZ,
    reject_reason   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 메시지 템플릿
CREATE TABLE message_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    name            VARCHAR(100) NOT NULL,
    content         TEXT NOT NULL,
    type            VARCHAR(20) NOT NULL,               -- INFORMATIONAL, ADVERTISING, AUTHENTICATION
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    reviewed_by     UUID REFERENCES admin_users(id),
    reviewed_at     TIMESTAMPTZ,
    reject_reason   TEXT,
    variables       TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 환불 요청
CREATE TABLE refund_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    amount          DECIMAL(15,2) NOT NULL,
    reason          TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    l1_approved_by  UUID REFERENCES admin_users(id),
    l1_approved_at  TIMESTAMPTZ,
    l2_approved_by  UUID REFERENCES admin_users(id),
    l2_approved_at  TIMESTAMPTZ,
    executed_at     TIMESTAMPTZ,
    reject_reason   TEXT,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 7. 엣지 케이스 및 재난 시나리오

### 7.1 Infobip API 다운 (캠페인 중간)

- Circuit Breaker: 연속 5회 실패 → OPEN (15분 대기) → HALF-OPEN (1건 테스트)
- 미발송 건 크레딧 유보 (차감도 환불도 안 함)
- 복구 후 idempotency key로 중복 방지하며 재발송

### 7.2 중복 발송 방지

- Infobip에 messageId 파라미터 전달 (동일 ID 재전송 거부)
- DB: idempotency_key UNIQUE 제약
- 상태 머신: SENDING 상태 메시지 재큐잉 차단

### 7.3 관리자 계정 침해

- MFA + IP 화이트리스트로 예방
- 비정상 IP/시간대 활동 실시간 알림
- 침해 시: 전 세션 무효화 → 계정 잠금 → 감사 로그 전수 조사 → 피해 복구
- 고액 크레딧 조정은 반드시 2인 승인 (단독 탈취 방지)

### 7.4 DB 커넥션 유실 (크레딧 트랜잭션 중)

- 핵심 원칙: **차감 먼저, 발송 나중** (Outbox 패턴)
- 트랜잭션 미커밋 → 자동 ROLLBACK → 안전
- Advisory Lock으로 사용자별 크레딧 작업 직렬화

---

## 8. 핵심 설계 원칙 요약

1. **SMS 크레딧 = 현금**: 모든 크레딧 변동은 금융 거래 수준 (트랜잭션, 멱등성, 감사, 동시성 보호)
2. **차감 먼저, 발송 나중**: Outbox 패턴. 발송 실패 시 환불.
3. **불변 로그**: 감사 로그 삭제/수정 불가. 5년 보존.
4. **최소 권한**: 각 역할은 필요한 최소 권한만 보유.
5. **다계층 방어**: 인증(3단계) + 인가(RBAC) + 감사(로그) + 탐지(이상행위) + 대응(Kill Switch)
6. **중복 발송 = 돈 낭비**: 멱등성 키로 절대 방지.
7. **법규 준수 자동화**: 광고 표기, 발송 시간, 수신거부 시스템이 강제.

---

## 9. 구현 우선순위 로드맵

### Phase 1: 기반 (CRITICAL)
- [ ] 관리자 인증 (argon2id + TOTP MFA + IP 화이트리스트)
- [ ] RBAC 미들웨어
- [ ] 감사 로그 시스템
- [ ] DB 스키마 전체
- [ ] 글로벌 Kill Switch

### Phase 2: 핵심 기능 (HIGH)
- [ ] 사용자 관리 CRUD + 크레딧 조정
- [ ] 캠페인 모니터링 대시보드
- [ ] 발송 한도 설정 (3계층)
- [ ] 블랙리스트/DNC 관리

### Phase 3: 안전 장치 (HIGH)
- [ ] 이상 탐지
- [ ] 크레딧 정산 대조
- [ ] 환불 워크플로우
- [ ] 템플릿 승인
- [ ] 컴플라이언스 자동 검증

### Phase 4: 모니터링 (MEDIUM)
- [ ] 실시간 대시보드 (WebSocket)
- [ ] 알림 (Telegram + 이메일)
- [ ] Infobip 상태·잔액 모니터링
- [ ] 비용 이상 알림
