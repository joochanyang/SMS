# HLR Lookup 통합 설계 — 발송 후 통신사 정확도 보강

> 작성일: 2026-05-14
> 프로젝트: SovereignSMS (`/Users/mr.joo/Desktop/sms문자사이트`)
> 상태: 설계 확정 — 구현 대기

## 1. 배경 & 목적

### 문제
SMS 발송 API가 DLR로 반환하는 `mccMnc`는 **라우팅 통신사(routing carrier)**이며, 한국 번호이동(MNP)으로
가입 통신사를 바꾼 가입자의 경우 **실제 가입 통신사와 다르다**.

실증: `01028855838`은 실제 SKT 가입자이나 Infobip DLR은 `mccMnc=45008`(KT)로 보고 — 4회 발송 모두 동일.
3개 테스트 번호 중 1개(33%)가 불일치.

### 목적
발송 **후**에 Infobip Number Lookup(HLR) API로 각 번호의 **실제 가입 통신사**를 조회하여
`SmsLog`의 통신사 정보를 정확한 값으로 보강한다. 발송 전 필터링이 아니라 사후 정확도 보강이 목적.

### 범위 밖 (YAGNI)
- 발송 전 HLR 조회 / 죽은 번호 사전 필터링 — 사용자가 명시적으로 제외
- 죽은 번호 자동 블랙리스트 등록 — 데이터만 저장, 자동 조치 없음
- 예약 발송 / Inbound SMS / OTP API — 별개 기능, 본 스펙 범위 아님

## 2. 핵심 제약 (반드시 인지)

**Infobip 계정에서 Number Lookup 서비스가 현재 비활성 상태다.**
`POST /number/1/query` 테스트 시 3개 번호 전부 다음 응답:
```
"status": { "groupName": "REJECTED", "name": "REJECTED_ROUTE_NOT_AVAILABLE",
            "description": "Route not available", "action": "Contact account manager" }
```
→ 활성화는 **코드로 불가능**. Infobip 계정 매니저에게 서비스 활성화 + 건당 과금 등록을 요청해야 한다.

**본 구현의 목표**: 계정이 활성화되는 즉시 `INFOBIP_HLR_ENABLED=true` 토글만으로 동작하도록
**완전한 통합 코드를 미리 완성**해 둔다. 활성화 전에는 cron이 안전하게 no-op return.

## 3. 비용 모델

- HLR Lookup은 **건당 과금** (SMS 발송과 별개). 한국 기준 통상 건당 ~$0.003–0.01, 정확한 단가는 계정 매니저가 활성화 시 확정.
- 비용 억제 핵심 = **30일 캐시**. 한 번 조회한 번호는 `HlrLookup` 테이블에 저장 → 30일 내 재발송 시 재조회 없음(비용 0).
- 비용 하드 캡 = `HLR_MAX_LOOKUPS_PER_RUN` (기본 500). 1회 cron 실행당 신규 조회 수 상한.

## 4. 아키텍처 & 데이터 흐름

발송 파이프라인(`lib/campaign-processor.ts`)은 **전혀 수정하지 않는다.** 발송 후 보강 전용.

```
[발송 완료 SmsLog]  status IN (SENT, DELIVERED), providerName=infobip
        │  (RETRY_PENDING=발송 중간상태 / FAILED=미수신 → 제외, 조회비 낭비 방지)
        ▼
[hlr-enrich cron]  app/api/cron/hlr-enrich/route.ts
        │  · 10분 주기 (외부 cron이 호출)
        │  · CRON_SECRET Bearer 인증 (timing-safe)
        │  · INFOBIP_HLR_ENABLED='true' 아니면 즉시 { skipped: true } return
        │
        ├─ 1. 최근 WINDOW_DAYS(기본 7일) 내 SmsLog 중 status IN (SENT,DELIVERED)
        │     AND providerName='infobip' AND hlrCheckedAt IS NULL 인 행에서
        │     고유 targetNumber 수집 (정규화된 E.164)
        ├─ 2. HlrLookup 캐시 조회 → lookedUpAt >= now-30d 인 번호는 캐시 HIT (조회 안 함, 비용 0)
        ├─ 3. 캐시 MISS/만료 번호만 CHUNK_SIZE(50) 청크로 POST /number/1/query 호출
        │     · HLR_MAX_LOOKUPS_PER_RUN 초과분은 다음 실행으로 미룸
        │     · 응답 전체가 REJECTED_ROUTE_NOT_AVAILABLE → 계정 미활성: 경고 로그 1회 + 실행 중단
        ├─ 4. 응답 파싱 → HlrLookup upsert (phone 유니크 키)
        └─ 5. 캐시 HIT + 신규 조회 결과를 합쳐, 해당 번호의 SmsLog 행을
              networkName/networkCode = HLR 정확값으로 덮어쓰기 + hlrCheckedAt = now 기록
```

**권위 규칙**: HLR 값이 DLR routing mccMnc보다 권위 있다. HLR로 보강된 행은 `hlrCheckedAt`으로
표시되어 재조회 대상에서 제외된다. (캐시 자체의 30일 TTL과는 별개 — SmsLog 행은 발송 시점 스냅샷)

## 5. 컴포넌트

| 컴포넌트 | 파일 | 책임 | 신규/수정 |
|---|---|---|---|
| HLR 캐시 모델 | `prisma/schema.prisma` | `HlrLookup` 모델 + `SmsLog.hlrCheckedAt` 필드 | 수정 |
| HLR 클라이언트 | `lib/sms-providers/infobip-hlr.ts` | `lookupNumbers()`, `isHlrEnabled()`, 응답 방어적 파싱 | 신규 |
| MCCMNC 매핑 | `lib/sms-providers/mccmnc.ts` | HLR mccMnc → 통신사명 (기존 헬퍼 재사용) | 변경 없음 |
| enrich cron | `app/api/cron/hlr-enrich/route.ts` | §4 데이터 흐름 1~5단계 오케스트레이션 | 신규 |
| 유저 통신사 제거 | `app/dashboard/campaign/[id]/_components/log-table.tsx`<br>`app/dashboard/campaign/[id]/page.tsx`<br>`app/dashboard/history/page.tsx` | 통신사 컬럼·`networkName` 필드·select 완전 제거 | 수정 |
| 관리자 HLR 표시 | `admin/app/campaigns/[id]/page.tsx` | 통신사(라우팅) + HLR 정확 통신사 + ported 여부 컬럼 | 수정 |

### 5.1 HlrLookup 모델

```prisma
model HlrLookup {
  id           String   @id @default(cuid())
  phone        String   @unique          // E.164 정규화 번호 (캐시 키)
  mccMnc       String?                   // HLR 보고 실제 통신사 MCCMNC
  carrierName  String?                   // mccMnc → 매핑 통신사명 (SKT/KT/LG U+)
  countryCode  String?                   // ISO 3166-1 alpha-2
  ported       Boolean  @default(false)  // 번호이동 여부
  reachable    String?                   // ACTIVE / ABSENT / DEAD / UNKNOWN
  rawResponse  Json?                     // Infobip 원응답 (감사/디버깅)
  lookedUpAt   DateTime @default(now())  // 30일 TTL 기준
  updatedAt    DateTime @updatedAt

  @@index([lookedUpAt])
}
```

`SmsLog`에 추가: `hlrCheckedAt DateTime?` — 보강 완료 표시 + 재조회 방지.
기존 `networkName` / `networkCode`는 스키마 변경 없이 HLR 값으로 덮어씀.

### 5.2 HLR 클라이언트 인터페이스

```typescript
// lib/sms-providers/infobip-hlr.ts
export interface HlrResult {
  phone: string;           // 입력 번호 (정규화)
  mccMnc: string | null;
  carrierName: string | null;
  countryCode: string | null;
  ported: boolean;
  reachable: 'ACTIVE' | 'ABSENT' | 'DEAD' | 'UNKNOWN';
  raw: unknown;
}

/** INFOBIP_HLR_ENABLED === 'true' 이고 INFOBIP_URL/API_KEY 존재 시 true */
export function isHlrEnabled(): boolean;

/**
 * 번호 배열을 HLR 조회. 최대 CHUNK_SIZE개씩 POST /number/1/query.
 * 응답 전체가 REJECTED_ROUTE_NOT_AVAILABLE 이면 HlrAccountInactiveError throw.
 */
export async function lookupNumbers(phones: string[]): Promise<HlrResult[]>;
```

**Infobip `/number/1/query` 응답 파싱 (방어적)** — DLR 핸들러와 동일 원칙으로 필드 위치 변형 허용:
- `mccMnc`: top-level
- `ported`: top-level boolean. ported=true면 `portedNetwork.mccMnc` 우선, 아니면 `originalNetwork`
- `originalNetwork` / `portedNetwork`: `{ networkName, networkPrefix, countryName, countryPrefix }`
- `status.groupName`: `DELIVERED`→ACTIVE, `UNDELIVERABLE`/`ABSENT`→ABSENT, `REJECTED`→(REJECTED_ROUTE_NOT_AVAILABLE 감지), 그 외→UNKNOWN
- `carrierName`: HLR이 `networkName`을 주면 그대로, 없으면 `mccMncToCarrier(mccMnc)` fallback

## 6. 에러 처리 & 비용 가드

- **토글 가드**: `isHlrEnabled()` false → cron 즉시 `{ skipped: true, reason: 'INFOBIP_HLR_ENABLED 비활성' }` return
- **비용 하드 캡**: `HLR_MAX_LOOKUPS_PER_RUN`(기본 500) — 신규 조회 수 상한. 초과분은 다음 실행
- **계정 미활성 감지**: 한 청크 응답이 전부 `REJECTED_ROUTE_NOT_AVAILABLE` → `HlrAccountInactiveError`. cron은 경고 로그 1회 남기고 해당 실행 중단 (무한 과금 시도 방지)
- **부분 실패**: 청크 단위 try/catch — 한 청크 네트워크 실패해도 다음 청크 진행 (`infobip-reconcile` cron과 동일 패턴)
- **멱등성**: `HlrLookup` upsert(phone 유니크) + `SmsLog.hlrCheckedAt` 조건부 update(`hlrCheckedAt IS NULL`). 재실행해도 중복 조회·중복 쓰기 없음
- **캐시 TTL**: `lookedUpAt < now - 30d` 면 stale → 재조회 대상
- **인증**: `CRON_SECRET` Bearer, `crypto.timingSafeEqual` (기존 cron 라우트와 동일)
- **Rate limit**: `withRateLimit` 분당 6회 / 시간당 240회 (기존 패턴)

## 7. 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `INFOBIP_HLR_ENABLED` | (미설정=false) | `'true'`일 때만 HLR cron 동작. 계정 활성화 후 켠다 |
| `HLR_MAX_LOOKUPS_PER_RUN` | `500` | 1회 cron 실행당 신규 HLR 조회 수 상한 |
| `INFOBIP_URL` / `INFOBIP_API_KEY` | (기존) | 기존 Infobip 자격증명 재사용 |

`.env.example`에 위 2개 신규 변수 추가.

## 8. 테스트 전략

| 대상 | 방식 |
|---|---|
| `infobip-hlr.ts` 응답 파서 | vitest 단위 — 정상/ported=true/ABSENT/REJECTED_ROUTE_NOT_AVAILABLE/필드변형 픽스처 |
| `isHlrEnabled()` 토글 | vitest 단위 — env 조합별 |
| 캐시 TTL 판정 | vitest 단위 — 29일/30일/31일 경계 |
| `mccmnc.ts` | 기존 14건 유지 (HLR도 동일 헬퍼 사용) |
| cron 통합 | dev 서버 + 실제 호출. 계정 미활성이라 `REJECTED` 경로 + `skipped` 경로까지 실검증. 정상 경로는 계정 활성화 후 재검증 |

전체 vitest 스위트(현재 146건) 통과 + `tsc --noEmit` 클린 필수.

## 9. 구현 팀 구성 (모두 Opus 4.7)

| Agent | 범위 | 의존성 |
|---|---|---|
| Agent 1 — DB/스키마 | `HlrLookup` 모델 + `SmsLog.hlrCheckedAt` + 마이그레이션 파일 | 없음 |
| Agent 2 — HLR 클라이언트 | `infobip-hlr.ts` + 단위 테스트 (파서·토글·TTL) | 없음 |
| Agent 3 — enrich cron | `app/api/cron/hlr-enrich/route.ts` + `.env.example` | Agent 1·2 산출물 (순차) |
| Agent 4 — UI 분리 | 유저 페이지 통신사 제거 + 관리자 HLR 표시 | 없음 (병렬) |

Agent 1·2·4는 병렬, Agent 3은 1·2 완료 후. 최종 통합·빌드(`tsc`/`vitest`/`next build`)·dev 검증은 메인 세션에서 직접 수행.

## 10. 마이그레이션 적용 절차 (사용자 액션)

```bash
cd ~/Desktop/sms문자사이트
npx prisma migrate dev --name hlr_lookup_cache   # 또는 배포 환경에서 migrate deploy
```
`DATABASE_URL`은 Hetzner 공유 DB(`5.161.112.248:5434/bulksms`) — 로컬·운영 동일 DB라 1회 적용으로 양쪽 반영.

## 11. 배포 후 활성화 체크리스트

1. Infobip 계정 매니저에 Number Lookup 서비스 활성화 + 단가 협상 요청
2. 활성화 확인되면 운영 환경에 `INFOBIP_HLR_ENABLED=true` 설정
3. 외부 cron에 `POST /api/cron/hlr-enrich` (Authorization: Bearer $CRON_SECRET) 10분 주기 등록
4. 첫 실행 후 `HlrLookup` 테이블 + `SmsLog.hlrCheckedAt` 채워지는지 확인
5. `01028855838`이 HLR에서 SKT로 정확히 보고되는지 실증 재검증
