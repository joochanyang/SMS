# CRITICAL 보안 수정 구현 계획서

> 대상: research.md 섹션 9에서 식별된 CRITICAL 3건 + HIGH 보안 관련 3건
> 작성일: 2026-04-09
> 상태: 계획 완료, 구현 대기

---

## A. 에이전트 팀 구성

| 에이전트 | 담당 | 실행 방식 | 필요 MCP |
|---------|------|----------|---------|
| **security-auditor** | 보안 취약점 감사 + 수정 검증 | 구현 완료 후 최종 검증 | - |
| **typescript-pro** | TS 타입 안전성 + Prisma 트랜잭션 패턴 | 단계 2, 3 코드 리뷰 | context7 (Prisma docs) |
| **test-automator** | sms-policy.ts 단위 테스트 작성 | 단계 6 병렬 실행 | - |
| **debugger** | 레이스 컨디션 재현 및 수정 검증 | 단계 3 후 검증 | - |

**실행 순서**: 단계 1→2→3→4→5 (순차) + 단계 6 (병렬)

---

## B. 구현 전략

### 선택한 접근: 점진적 파일별 수정 (Incremental Fix)

**근거**: 6개 보안 이슈가 서로 다른 파일에 분산. 각 수정이 독립적이므로 파일별 수정→검증→커밋 사이클이 가장 안전.

### 대안 1: 인증 레이어 전면 재설계 (NextAuth v5 마이그레이션 포함)

| 장점 | 단점 |
|------|------|
| NextAuth v5 (Auth.js)로 최신화 가능 | 대규모 변경으로 리그레션 위험 높음 |
| 미들웨어 통합이 더 자연스러움 | NextAuth v4→v5 마이그레이션 복잡도 높음 |
| | 현재 보안 이슈 해결과 무관한 범위 확장 |

**불채택 이유**: 보안 수정이 급선무. NextAuth v5는 별도 작업으로 분리.

### 대안 2: API Gateway 패턴 (단일 진입점)

| 장점 | 단점 |
|------|------|
| 모든 인증/인가를 한 곳에서 처리 | Next.js App Router와 패턴 불일치 |
| 로깅/레이트리밋 중앙화 용이 | 과도한 아키텍처 변경 |
| | 기존 서버 컴포넌트 직접 DB 접근 패턴과 충돌 |

**불채택 이유**: Next.js의 파일 기반 라우팅에 역행. middleware.ts로 충분히 해결 가능.

---

## C. 변경 명세

### C-1. Setup API 보안 강화 (CRITICAL #1)

**파일**: `app/api/setup/route.ts`
**유형**: 수정
**이유**: 인증 없이 admin 계정 생성 + 하드코딩 비밀번호 + 응답에 평문 비밀번호 노출
**영향 범위**: 이 파일만 (의존하는 코드 없음)

**변경 전** (현재 코드):
```typescript
export async function GET() {
  // ... 인증 체크 없음
  const hashedPassword = await bcrypt.hash('admin123', 10);
  // ...
  return NextResponse.json({ 
    message: 'Admin user created successfully.',
    user: { email: newUser.email, password: 'admin123' }  // 평문 비밀번호 노출
  }, { status: 201 });
}
```

**변경 후**:
```typescript
export async function POST(req: NextRequest) {
  // 환경변수 기반 시크릿 검증
  const setupSecret = process.env.SETUP_SECRET;
  if (!setupSecret) {
    return NextResponse.json({ error: "Setup disabled" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body?.secret !== setupSecret) {
    return NextResponse.json({ error: "Invalid setup secret" }, { status: 403 });
  }

  // 비밀번호도 body에서 받거나 환경변수 사용
  const adminEmail = process.env.ADMIN_EMAIL || "admin@sovereign.com";
  const adminPassword = body?.password;
  if (!adminPassword || adminPassword.length < 8) {
    return NextResponse.json({ error: "Password required (min 8 chars)" }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingUser) {
    return NextResponse.json({ message: "Admin already exists" }, { status: 200 });
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 12);
  await prisma.user.create({
    data: { email: adminEmail, passwordHash: hashedPassword, name: "Admin", credits: 1000.0 }
  });

  // 비밀번호 절대 응답에 포함하지 않음
  return NextResponse.json({ message: "Admin created", email: adminEmail }, { status: 201 });
}
```

**핵심 변경점**:
- GET → POST (부수효과가 있는 작업은 POST)
- `SETUP_SECRET` 환경변수로 접근 제한
- 비밀번호 하드코딩 제거 → 요청 body에서 수신
- 응답에서 비밀번호 제거
- bcrypt 라운드 10 → 12

---

### C-2. 캠페인 취소 시 크레딧 환불 (CRITICAL #2)

**파일**: `app/api/sms/campaign/[id]/route.ts`
**유형**: 수정
**이유**: 캠페인 CANCELLED 시 미발송 건 크레딧 미환불 → 사용자 자산 손실
**영향 범위**: 이 파일 + User.credits, Transaction 테이블

**변경 전** (route.ts POST, 줄 80-88):
```typescript
const updated = await prisma.smsCampaign.update({
  where: { id },
  data: { status: "CANCELLED" },
  // ... 환불 로직 없음
});
```

**변경 후**:
```typescript
const updated = await prisma.$transaction(async (tx) => {
  // 미처리 건수 계산
  const unprocessedCount = await tx.smsLog.count({
    where: { campaignId: id, status: { in: ["PENDING", "RETRY_PENDING"] } },
  });

  // 미처리 로그 상태 일괄 변경
  await tx.smsLog.updateMany({
    where: { campaignId: id, status: { in: ["PENDING", "RETRY_PENDING"] } },
    data: { status: "CANCELLED" },
  });

  // 환불 금액 계산
  const refundAmount = unprocessedCount * campaign.costPerMessage;

  if (refundAmount > 0) {
    // 크레딧 환불 (atomic increment)
    await tx.user.update({
      where: { id: campaign.userId },
      data: { credits: { increment: refundAmount } },
    });

    // 환불 트랜잭션 기록
    await tx.transaction.create({
      data: {
        userId: campaign.userId,
        amount: refundAmount,
        type: "DEPOSIT",
        description: `Campaign cancelled refund (${unprocessedCount} unprocessed)`,
      },
    });
  }

  // 캠페인 상태 업데이트
  return tx.smsCampaign.update({
    where: { id },
    data: { status: "CANCELLED" },
    select: { id: true, status: true, totalRecipients: true, processedCount: true, deliveredCount: true, failedCount: true, updatedAt: true },
  });
});

return NextResponse.json({ campaign: updated, refunded: true }, { status: 200 });
```

---

### C-3. 크레딧 차감 레이스 컨디션 수정 (HIGH #5)

**파일**: `app/api/sms/campaign/route.ts`
**유형**: 수정
**이유**: `user.credits` 읽기 → 트랜잭션 내 차감 사이 동시 요청으로 과차감 가능
**영향 범위**: 캠페인 생성 API

**변경 전** (줄 65-74):
```typescript
const user = await prisma.user.findUnique({ where: { id: session.user.id } });
if (user.credits < estimatedCost) { ... }

const campaign = await prisma.$transaction(async (tx) => {
  // ... 
  await tx.user.update({
    where: { id: user.id },
    data: { credits: user.credits - estimatedCost },  // 읽은 시점의 값 기반 → 레이스 컨디션
  });
});
```

**변경 후**:
```typescript
const campaign = await prisma.$transaction(async (tx) => {
  // 트랜잭션 내에서 읽기 → 일관성 보장
  const user = await tx.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.credits < estimatedCost) throw new Error("INSUFFICIENT_CREDITS");

  const created = await tx.smsCampaign.create({ ... });

  await tx.smsLog.createMany({ ... });

  await tx.transaction.create({ ... });

  // atomic decrement — DB 레벨에서 현재 값 기준 차감
  await tx.user.update({
    where: { id: user.id },
    data: { credits: { decrement: estimatedCost } },
  });

  return created;
});
```

**핵심 변경점**:
- `user.findUnique`를 트랜잭션 내부로 이동
- `credits: user.credits - estimatedCost` → `credits: { decrement: estimatedCost }` (Prisma atomic operation)
- 잔액 부족 시 `throw Error`로 트랜잭션 자동 롤백
- 외부 try-catch에서 에러 코드별 응답 분기

---

### C-4. Next.js Middleware 인증 보호 (HIGH #4)

**파일**: `middleware.ts` (신규)
**유형**: 신규
**이유**: API 라우트마다 개별 `getServerSession()` 호출 → 누락 위험. 중앙 인증 레이어 필요.
**영향 범위**: 전체 `/dashboard/*` 및 `/api/sms/*` 라우트

**참고**: Next.js 16 docs에서는 `proxy`라는 이름으로 사용하나 `middleware.ts`도 호환. NextAuth의 JWT 토큰이 쿠키에 저장되므로 middleware에서 검증 가능.

**신규 파일**:
```typescript
// middleware.ts (프로젝트 루트)
import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const protectedPaths = ["/dashboard", "/api/sms"];
const publicApiPaths = ["/api/auth", "/api/infobip/dlr"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 공개 경로는 통과
  if (publicApiPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 보호 대상 경로 확인
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // JWT 토큰 검증
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    // API 요청은 401, 페이지 요청은 로그인 리다이렉트
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/sms/:path*"],
};
```

**기존 API 라우트 변경**: 각 API 라우트의 `getServerSession()` 호출은 **제거하지 않음** (방어적 이중 검증). middleware가 1차 방어선, 라우트 내부가 2차 방어선.

---

### C-5. DLR 웹훅 보안 강화 (HIGH #4 관련)

**파일**: `app/api/infobip/dlr/route.ts` + `.env`
**유형**: 수정
**이유**: `INFOBIP_DLR_SECRET` 미설정 시 인증 없이 외부에서 DLR 데이터 주입 가능
**영향 범위**: DLR 웹훅 엔드포인트

**변경 전** (줄 9-16):
```typescript
const secret = process.env.INFOBIP_DLR_SECRET;
if (secret) {  // 미설정이면 검증 건너뜀
  // ...
}
```

**변경 후**:
```typescript
const secret = process.env.INFOBIP_DLR_SECRET;
if (!secret) {
  console.error("INFOBIP_DLR_SECRET not configured — rejecting all DLR requests");
  return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
}

const url = new URL(req.url);
const token = url.searchParams.get("token") || req.headers.get("x-infobip-token");
if (!token || token !== secret) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

**.env 추가**:
```
INFOBIP_DLR_SECRET="생성할_랜덤_시크릿_32자"
```

---

### C-6. Setup API 비활성화 환경변수 + .env.example 생성

**파일**: `.env.example` (신규)
**유형**: 신규
**이유**: `.env`는 gitignore 대상. 필요한 환경변수 목록을 문서화.
**영향 범위**: 개발자 온보딩

```env
# Database
DATABASE_URL="prisma+postgres://localhost:51213/?api_key=..."

# Infobip SMS
INFOBIP_API_KEY="your-infobip-api-key"
INFOBIP_URL="https://xxxxx.api-id.infobip.com"
INFOBIP_DLR_SECRET="random-32-char-secret-for-dlr-webhook"

# Authentication
NEXTAUTH_SECRET="openssl rand -base64 32"
NEXTAUTH_URL="http://localhost:3000"

# Admin Setup (제거하면 setup API 비활성화)
# SETUP_SECRET="one-time-setup-secret"
# ADMIN_EMAIL="admin@sovereign.com"
```

---

## D. 구현 순서 (체크박스 TODO)

* [ ] **단계 1**: Setup API 보안 강화 (~15분)
    * `app/api/setup/route.ts` — GET→POST, 시크릿 검증, 비밀번호 하드코딩 제거
    * `.env`에 `SETUP_SECRET` 추가
    * 검증: `curl -X GET /api/setup` → 405 (Method Not Allowed) 또는 제거된 GET
    * 검증: `curl -X POST /api/setup -d '{"secret":"wrong"}' ` → 403
    * 검증: 올바른 시크릿 + 비밀번호로 POST → 201 (응답에 비밀번호 없음)

* [ ] **단계 2**: 크레딧 레이스 컨디션 수정 (~20분)
    * `app/api/sms/campaign/route.ts` — findUnique를 트랜잭션 내부로 이동, `{ decrement }` 적용
    * 검증: 동시 캠페인 생성 시 크레딧이 정확히 차감되는지 확인
    * 검증: 잔액 부족 시 402 응답 + DB 변경 없음
    * 의존: 없음

* [ ] **단계 3**: 캠페인 취소 환불 로직 (~20분)
    * `app/api/sms/campaign/[id]/route.ts` — 취소 시 미처리 건 환불 + Transaction 기록
    * 검증: 캠페인 취소 후 User.credits 증가 확인
    * 검증: Transaction 테이블에 DEPOSIT 환불 기록 존재
    * 검증: 이미 COMPLETED/CANCELLED 캠페인 재취소 시 중복 환불 없음
    * 의존: 단계 2 (같은 크레딧 로직 패턴)

* [ ] **단계 4**: Next.js Middleware 생성 (~15분)
    * `middleware.ts` 신규 생성 — `/dashboard/*`, `/api/sms/*` 보호
    * 검증: 비로그인 상태에서 `/dashboard/sms-send` → `/login` 리다이렉트
    * 검증: 비로그인 상태에서 `POST /api/sms/campaign` → 401
    * 검증: 로그인 상태에서 정상 접근
    * 검증: `/api/auth/*`, `/api/infobip/dlr` 는 middleware 미적용
    * 의존: 없음

* [ ] **단계 5**: DLR 웹훅 보안 + .env.example (~10분)
    * `app/api/infobip/dlr/route.ts` — 시크릿 필수화
    * `.env`에 `INFOBIP_DLR_SECRET` 추가
    * `.env.example` 신규 생성
    * 검증: `INFOBIP_DLR_SECRET` 미설정 시 503
    * 검증: 잘못된 토큰 → 401
    * 검증: 올바른 토큰 → 정상 처리
    * 의존: 없음

* [ ] **단계 6**: 빌드 검증 + Git 커밋 (~10분)
    * `npx next build` 성공 확인
    * TypeScript 에러 없음 확인
    * 전체 변경사항 커밋
    * 검증: 빌드 성공 + 0 TS 에러

---

## E. 엣지 케이스 & 에러 처리

| # | 시나리오 | 발생 조건 | 처리 방법 | 롤백 전략 |
|---|---------|----------|----------|----------|
| 1 | 동시 캠페인 생성 (레이스) | 같은 유저가 동시에 2개 캠페인 생성 | `{ decrement }` atomic 연산으로 DB 레벨 보호. 두 번째 요청이 잔액 부족 시 트랜잭션 롤백 | Prisma 트랜잭션 자동 롤백 |
| 2 | 취소 중 동시 process 요청 | 캠페인 취소 트랜잭션 진행 중 process 호출 | process에서 status 체크 (`CANCELLED` 포함 시 리턴). 트랜잭션 isolation으로 보호 | 이미 발송된 건은 환불 대상 아님 |
| 3 | SETUP_SECRET 미설정 | 프로덕션에서 실수로 설정 안 함 | `!setupSecret` → 403 "Setup disabled" 반환. 기능 완전 비활성화 | 해당 없음 (의도된 동작) |
| 4 | DLR 시크릿 미설정 | .env에서 누락 | 503 반환 + console.error 경고 | 시크릿 설정 후 즉시 복구 |
| 5 | 환불 금액 0 | 모든 건이 이미 처리된 상태에서 취소 | `unprocessedCount === 0` → 환불 트랜잭션 미생성, 상태만 CANCELLED | 해당 없음 |
| 6 | credits가 음수 | decrement로 인해 (이론적) | Prisma `{ decrement }` 는 DB 레벨 연산이므로 트랜잭션 내 잔액 체크로 방지. 추가 방어로 DB CHECK 제약 고려 | 해당 없음 |
| 7 | middleware에서 NextAuth 토큰 만료 | JWT 만료 후 API 호출 | `getToken()` 이 null 반환 → 401/리다이렉트. 기존 라우트 내부 `getServerSession()`도 이중 방어 | 재로그인 유도 |

---

## F. 테스트 계획

### 단위 테스트 (자동)
| 대상 | 케이스 |
|------|--------|
| `lib/sms-policy.ts` | `normalizeKrPhone`: 010, +82, 82 형식, 잘못된 번호, 빈 값 |
| `lib/sms-policy.ts` | `validateAdMessageRules`: (광고) 있/없, 무료 수신거부 있/없 |
| `lib/sms-policy.ts` | `isTemporaryProviderError`: PENDING, QUEUE, TIMEOUT, 정상 상태 |
| `lib/sms-policy.ts` | `getRetryDelayMs`: retryCount 0,1,2,3+ |

### 통합 테스트 (수동 API 호출)
| 플로우 | 검증 |
|--------|------|
| Setup → Login → Create Campaign → Cancel → 잔액 확인 | 환불 금액 = 미처리건 × $0.05 |
| 동시 캠페인 생성 (2개 탭) | 크레딧 정확 차감, 중복 차감 없음 |
| 비로그인 → /dashboard 접근 | middleware가 /login으로 리다이렉트 |
| 비로그인 → POST /api/sms/campaign | middleware가 401 반환 |
| DLR 웹훅 — 유효 토큰 vs 무효 토큰 | 401 vs 정상 처리 |

### 수동 검증 시나리오
1. `curl -X GET /api/setup` → 405 또는 404
2. `curl -X POST /api/setup -H 'Content-Type: application/json' -d '{"secret":"wrong"}'` → 403
3. 로그인 후 캠페인 생성 → 크레딧 확인 → 취소 → 크레딧 복구 확인
4. 브라우저 시크릿 모드에서 `/dashboard/sms-send` 직접 접근 → 로그인 리다이렉트

### 기존 테스트 영향
- 기존 테스트 0건이므로 영향 없음.

---

## G. 영향 범위 체크리스트

- [x] **기존 테스트 유지?** — 기존 테스트 없음. 영향 없음.
- [x] **타입 안전성 유지?** — 모든 변경이 기존 타입 유지. Setup API의 body 타입만 추가.
- [x] **하위 호환성?** — Setup API가 GET→POST로 변경. 기존 브라우저 접근 불가 (의도된 파괴적 변경).
- [x] **성능 영향?** — middleware 추가로 모든 보호 라우트에 JWT 검증 오버헤드 (~1ms). 무시 가능.
- [x] **보안 취약점?** — 본 계획의 목적. 6개 취약점 해결.
- [x] **API 계약 유지?** — Setup API: 파괴적 변경 (의도). 캠페인 취소: 응답에 `refunded` 필드 추가 (하위호환). 나머지 유지.
- [x] **환경 변수 변경?** — `SETUP_SECRET`, `ADMIN_EMAIL`, `INFOBIP_DLR_SECRET` 추가. `.env.example`로 문서화.
- [ ] **마이그레이션 필요?** — DB 스키마 변경 없음. SmsLog에 "CANCELLED" status 값 추가 (enum 아닌 String이므로 마이그레이션 불필요).

---

## H. 롤백 계획

### Git 복구
```bash
# 커밋 전이라면
git checkout -- app/api/setup/route.ts app/api/sms/campaign/route.ts \
  app/api/sms/campaign/\[id\]/route.ts app/api/infobip/dlr/route.ts
rm middleware.ts .env.example

# 커밋 후라면
git revert HEAD  # 보안 수정 커밋 되돌리기
```

### 데이터 롤백
- **스키마 변경 없음** → DB 롤백 불필요
- **환불 트랜잭션**: Transaction 테이블에 기록되므로 추적 가능. 잘못된 환불 발생 시 해당 Transaction 레코드의 amount를 역으로 처리
- **CANCELLED 상태 SmsLog**: 필요 시 `UPDATE sms_log SET status = 'PENDING' WHERE status = 'CANCELLED' AND campaign_id = ?`로 복구 가능

### 긴급 비활성화
- middleware 문제 시: `middleware.ts` 삭제만으로 즉시 비활성화 (기존 라우트 내부 인증이 2차 방어선)
- DLR 시크릿 문제 시: `.env`에서 `INFOBIP_DLR_SECRET` 제거하면 503 반환 (DLR 수신 일시 중단)

---

## 변경 파일 요약

| 파일 | 유형 | 단계 |
|------|------|------|
| `app/api/setup/route.ts` | 수정 | 1 |
| `app/api/sms/campaign/route.ts` | 수정 | 2 |
| `app/api/sms/campaign/[id]/route.ts` | 수정 | 3 |
| `middleware.ts` | **신규** | 4 |
| `app/api/infobip/dlr/route.ts` | 수정 | 5 |
| `.env` | 수정 (변수 추가) | 1, 5 |
| `.env.example` | **신규** | 5 |
