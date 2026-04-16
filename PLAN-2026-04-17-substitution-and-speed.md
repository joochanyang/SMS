# 작업계획서: 치환발송 버그 수정 + 발송 속도 개선

작성일: 2026-04-17
대상 브랜치: main (또는 feature/substitution-speed-fix)
예상 소요: 2~3시간 (코딩 1.5h + 검증 1h)
영향 범위: 사용자 발송 화면 / 캠페인 처리 파이프라인 / SMS.to 프로바이더

---

## 0. 배경

현재 `/dashboard/sms-send` 페이지에서 다음 두 가지 문제가 확인됨.

1. **치환모드(`substitutionMode`) ON 상태에서 발송이 동작하지 않거나, `{이름}` 같은 플레이스홀더가 그대로 발송되는 현상**
   - 원인: 프론트엔드 `handleSend()`가 `addressBookMode`만 분기 조건으로 사용하고 `substitutionMode`를 무시함 (`app/dashboard/sms-send/page.tsx:279`)
   - 부수 원인: 치환 후 메시지 길이가 1 SMS 한도 초과 시 캠페인 전체가 `400`으로 거절됨 (`app/api/sms/campaign/route.ts:115-127`)
2. **"발송하기" 버튼 클릭 후 첫 응답까지 1~3초 멈춘 듯 보이고, 전체 발송이 분 단위로 길어짐**
   - 원인 1: SMS.to 프로바이더 throttle (`CONCURRENCY=3`, `BASE_DELAY_MS=800`)로 200건당 90~115초 소요 (`lib/sms-providers/smsto.ts:20-23`)
   - 원인 2: 캠페인 생성 직후 첫 `/process` 응답이 올 때까지 모달 진행률이 비어 있어 "안 움직이는" 것처럼 보임 (`app/dashboard/sms-send/page.tsx:294`까지 `setProgress` 호출 없음)
   - 원인 3: 폴링 라운드마다 `/campaign/:id` GET + `/campaign/:id/process` POST 두 번 호출 (`page.tsx:199, 203, 219`)

---

## 1. 작업 범위 (Scope)

### 1.1 포함

- [A] 치환모드 발송 분기 버그 수정
- [B] 치환모드에서 수동 입력 시 빈 vars 객체 자동 생성
- [C] 치환 후 길이 초과 정책 완화 (전체 거절 → 해당 수신자만 스킵)
- [D] 프로바이더 동시성 / 지연 파라미터 환경변수화 + 기본값 상향
- [E] 캠페인 생성 직후 진행률 모달 즉시 0/N 표시
- [F] 폴링 라운드 트립 절감 (process 응답에 campaign 상태 포함)

### 1.2 제외 (다음 스프린트)

- SSE/WebSocket 기반 실시간 진행률 (현재 폴링 유지)
- Infobip 프로바이더 동일 적용 (smsto만 우선)
- 데이터베이스 인덱스 튜닝
- 블랙리스트 캐싱 (별도 이슈로 분리)

---

## 2. 변경 파일 일람

| # | 경로 | 변경 종류 | 라인 추정 |
|---|---|---|---|
| 1 | `app/dashboard/sms-send/page.tsx` | 수정 | ±40 |
| 2 | `app/api/sms/campaign/route.ts` | 수정 | ±25 |
| 3 | `app/api/sms/campaign/[id]/process/route.ts` | 수정 | ±15 |
| 4 | `lib/sms-providers/smsto.ts` | 수정 | ±15 |
| 5 | `lib/campaign-processor.ts` | 검토 only (필요 시 반환 타입 확장) | ±10 |
| 6 | `.env.example` | 신규 키 3개 추가 | +3 |
| 7 | `__tests__/campaign-substitution.test.ts` | 신규 | +120 |
| 8 | `PROGRESS.md` | 변경 이력 추가 | +20 |

---

## 3. 상세 작업 항목

### [A] 치환모드 발송 분기 버그 수정

**파일**: `app/dashboard/sms-send/page.tsx`
**현재 코드** (line 279-281):

```ts
...(addressBookMode
  ? { recipientsWithVars: recipientsWithVars.filter((r) => validRecipients.includes(r.phone)) }
  : { recipients: validRecipients }),
```

**변경 후**:

```ts
const useVarsPayload = addressBookMode || substitutionMode;
const varsPayload: RecipientWithVars[] = useVarsPayload
  ? validRecipients.map((phone) => {
      const found = recipientsWithVars.find((r) => r.phone === phone);
      return found ?? { phone, name: '', nickname: '' };
    })
  : [];

// fetch body
body: JSON.stringify({
  message,
  senderId,
  ...(useVarsPayload
    ? { recipientsWithVars: varsPayload }
    : { recipients: validRecipients }),
}),
```

**검증 포인트**
- 주소록 로드 (X) + 치환모드 OFF → `recipients` 평문 발송 (기존과 동일)
- 주소록 로드 (X) + 치환모드 ON → `recipientsWithVars`로 보내되 vars 없으면 빈 문자열 → `{이름}` → "" 치환
- 주소록 로드 (O) + 치환모드 ON → 정상 치환
- 주소록 로드 (O) + 치환모드 OFF → 평문 발송

---

### [B] 백엔드 빈 vars 안전 처리

**파일**: `app/api/sms/campaign/route.ts`
**현재** (line 60-67 추정):

```ts
const rawPhones = body.recipientsWithVars!.map((r) => r.phone);
recipients = normalizeRecipients(rawPhones);

for (const recipientWithVars of body.recipientsWithVars!) {
  varsMap.set(normalizePhone(recipientWithVars.phone), {
    name: recipientWithVars.name ?? null,
    nickname: recipientWithVars.nickname ?? null,
  });
}
```

→ name/nickname이 빈 문자열이어도 `substituteVars`가 빈 문자열로 치환하므로 동작 OK. **추가 변경 없음.**

---

### [C] 치환 후 길이 초과 정책 완화

**파일**: `app/api/sms/campaign/route.ts`
**현재** (line 115-127):

```ts
if (hasVars) {
  const substituted = substituteVars(message!, vars);
  const info = getSmsInfo(substituted);
  if (info.charCount > info.maxCharsPerSms) {
    return NextResponse.json(
      { error: `수신자 ${phone}의 치환 메시지가 ${info.charCount}자입니다. 최대 ${info.maxCharsPerSms}자까지 발송 가능합니다.` },
      { status: 400 },
    );
  }
}
```

**변경 후** (선택지 두 개 — 권장은 옵션 1):

**옵션 1 (권장): 정책 분리 — concat 한도(예: GSM7 1530 / UCS-2 670) 초과만 거절, 그 사이는 분할 과금 경고와 함께 통과**

```ts
if (hasVars) {
  const substituted = substituteVars(message!, vars);
  const info = getSmsInfo(substituted);
  if (info.charCount > info.maxConcatChars) {
    skippedRecipients.push({ phone, reason: 'TOO_LONG', length: info.charCount });
    continue; // 해당 수신자만 스킵
  }
  if (info.charCount > info.maxCharsPerSms) {
    overLimitWarnings.push({ phone, parts: info.parts, length: info.charCount });
  }
}
```

응답 JSON에 `skippedRecipients[]` + `overLimitWarnings[]` 배열 포함.

**옵션 2 (간단): 응답 코드만 분리** — 길이 초과 1건 발견 시 `409` + 모든 위반 수신자 목록 반환. 프론트에서 사용자가 "그래도 진행" 클릭하면 `overrideTooLong: true` 플래그로 재요청.

선택: **옵션 1** (사용자 흐름 단순, 부분 발송 허용이 비즈니스 가치 높음)

---

### [D] SMS.to 동시성 / 지연 파라미터 환경변수화

**파일 1**: `lib/sms-providers/smsto.ts`
**현재** (line 20-23):

```ts
const CONCURRENCY = 3;
const BASE_DELAY_MS = 800;
const JITTER_MS = 400;
const NETWORK_RETRY_DELAY_MS = 3000;
```

**변경 후**:

```ts
const CONCURRENCY = Number(process.env.SMSTO_CONCURRENCY ?? 8);
const BASE_DELAY_MS = Number(process.env.SMSTO_BASE_DELAY_MS ?? 400);
const JITTER_MS = Number(process.env.SMSTO_JITTER_MS ?? 200);
const NETWORK_RETRY_DELAY_MS = Number(process.env.SMSTO_NETWORK_RETRY_MS ?? 3000);

// 안전 가드: 잘못된 값 들어오면 fallback
if (!Number.isFinite(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 50) {
  throw new Error(`SMSTO_CONCURRENCY out of range: ${CONCURRENCY}`);
}
```

**파일 2**: `.env.example`

```
# SMS.to 발송 throttle (기본: 8 동시, 400ms 간격)
SMSTO_CONCURRENCY=8
SMSTO_BASE_DELAY_MS=400
SMSTO_JITTER_MS=200
```

**기본값 산정 근거**
- 기존: 200건 → 90~115초
- 변경 후: CONCURRENCY 3→8 (2.7배), DELAY 800→400 (2배) → 200건 ≈ 17~22초 (약 5배 단축)
- SMS.to 기본 rate limit은 100 req/sec (계정별), 우리 8 동시 + 400ms ≈ 20 req/sec → 충분히 안전 마진
- 통신사 버스트 감지 위험: 단일 발신번호로 초당 20건은 KT/LGU+ 정상 범위로 관측됨

---

### [E] 캠페인 생성 직후 진행률 즉시 표시

**파일**: `app/dashboard/sms-send/page.tsx`

**변경 위치 1 — handleSend (line 264-319 사이)**:

`createRes` 응답 직후 `processCampaignLoop` 호출 전에:

```ts
const createData = await createRes.json();
if (!createRes.ok) throw new Error(createData.error || '캠페인 생성 실패');

const campaignId = createData.campaignId;
const totalRecipients = createData.totalRecipients ?? validRecipients.length;

// 첫 응답 오기 전에 모달 진행률을 0/N으로 즉시 세팅
setProgress({
  id: campaignId,
  status: 'PENDING',
  processedCount: 0,
  totalRecipients,
  failedCount: 0,
  deliveredCount: 0,
});

activeCampaignIdRef.current = campaignId;
const finalCampaign = await processCampaignLoop(campaignId);
```

**변경 위치 2 — POST `/api/sms/campaign` 응답 (route.ts)**:

응답 JSON에 `totalRecipients` 필드 추가:

```ts
return NextResponse.json({
  campaignId: campaign.id,
  senderId: campaign.senderId,
  totalRecipients: sendableRecipients.length,
  ...(skippedRecipients.length > 0 && { skipped: skippedRecipients }),
  ...(overLimitWarnings.length > 0 && { warnings: overLimitWarnings }),
});
```

---

### [F] 폴링 라운드 트립 절감

**파일 1**: `app/api/sms/campaign/[id]/process/route.ts`

`/process` 응답에 캠페인 현재 상태 포함하도록 변경. 현재는 `processCampaignBatch()` 결과만 반환.

```ts
const result = await processCampaignBatch(id, session.user.id, batchSize);

// 캠페인 최신 상태도 함께 반환
const campaign = await prisma.smsCampaign.findUnique({
  where: { id },
  select: {
    id: true, status: true,
    processedCount: true, totalRecipients: true,
    failedCount: true, deliveredCount: true,
  },
});

return NextResponse.json({ ...result, campaign });
```

**파일 2**: `app/dashboard/sms-send/page.tsx` `processCampaignLoop`

기존:

```ts
// 매 루프마다 detail GET → process POST → detail GET → sleep 1s
const detailRes = await fetch(`/api/sms/campaign/${campaignId}`);     // ❌ 제거
const processRes = await fetch(`/api/sms/campaign/${campaignId}/process`, ...);
const detailRes2 = await fetch(`/api/sms/campaign/${campaignId}`);    // ❌ 제거
```

변경 후:

```ts
const processRes = await fetch(`/api/sms/campaign/${campaignId}/process`, ...);
const processData = await processRes.json();

if (processRes.status === 429) { ... }
if (!processRes.ok && processRes.status !== 502) { ... }

const campaign = processData.campaign;
setProgress({ ... campaign });
if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(campaign.status)) return campaign;
await sleep(500); // 1000 → 500
```

라운드당 fetch 3개 → 1개, sleep 1000ms → 500ms.
**효과**: 진행률 갱신 빈도 2배, 네트워크 오버헤드 1/3.

---

## 4. 작업 순서 (커밋 단위)

| # | 커밋 메시지 | 포함 파일 | 검증 |
|---|---|---|---|
| 1 | `fix(sms): 치환모드 발송 시 recipientsWithVars 누락 버그 수정` | page.tsx | 수동: 4가지 모드 조합 발송 |
| 2 | `feat(sms): 치환 후 길이 초과 시 부분 발송 허용` | route.ts | 단위 테스트 신규 |
| 3 | `feat(sms): SMS.to throttle 파라미터 환경변수화 + 기본값 상향` | smsto.ts, .env.example | 100건 발송 시간 측정 |
| 4 | `feat(sms): 캠페인 생성 직후 진행률 즉시 표시` | page.tsx, route.ts | 수동: 모달 즉시 0/N 표시 확인 |
| 5 | `perf(sms): 폴링 fetch 3회 → 1회로 통합` | process/route.ts, page.tsx | 네트워크 탭 모니터링 |
| 6 | `docs: 치환/속도 개선 변경 이력 추가` | PROGRESS.md | — |

각 커밋은 독립 빌드/타입체크 통과 + 기존 테스트 통과를 만족.

---

## 5. 테스트 계획

### 5.1 자동 테스트 (`__tests__/campaign-substitution.test.ts` 신규)

```ts
describe('POST /api/sms/campaign — 치환모드', () => {
  it('recipientsWithVars로 보낼 때 vars 없는 수신자는 빈 문자열로 치환된다');
  it('치환 후 maxCharsPerSms 초과 + maxConcatChars 이하면 발송 통과');
  it('치환 후 maxConcatChars 초과 수신자는 skippedRecipients로 분리되고 나머지는 발송');
  it('수신자 전원이 길이 초과 시 400 반환');
  it('addressBookMode 없이 substitutionMode만 ON일 때 빈 vars로 정상 처리');
});
```

### 5.2 수동 검증 시나리오

| 시나리오 | 입력 | 기대 결과 |
|---|---|---|
| S1 | 평문, 번호 3개 직접 입력 | 그대로 발송 |
| S2 | 주소록 로드 + 치환모드 ON, 메시지 `{이름}님 안녕하세요` | 각 수신자 이름 치환 발송 |
| S3 | 주소록 로드 + 치환모드 OFF, 메시지 `{이름}님` | `{이름}님` 그대로 발송 |
| S4 | 수동 입력 + 치환모드 ON, 메시지 `{이름}님` | `님` (이름은 빈 문자열) 으로 발송 |
| S5 | 치환 후 100자 (UCS-2 70 초과 130 미만) | parts=2 경고와 함께 발송 |
| S6 | 치환 후 700자 (UCS-2 670 초과) | 해당 수신자 skip, 나머지 발송 |
| S7 | 100건 발송 → 시간 측정 | 변경 전 ≈45s → 변경 후 ≈9s |
| S8 | "발송하기" 클릭 → 모달 즉시 0/100 표시 | 멈춰 있는 듯한 1~2초 사라짐 |

### 5.3 타입 체크 / 린트

```bash
npm run lint
npx tsc --noEmit
npm test
```

세 가지 모두 0 에러여야 머지 가능.

---

## 6. 롤백 계획

각 커밋이 독립적이므로 단일 `git revert <hash>`로 부분 롤백 가능.

긴급 시 환경변수만으로 발송 속도 원복:

```
SMSTO_CONCURRENCY=3
SMSTO_BASE_DELAY_MS=800
SMSTO_JITTER_MS=400
```

→ `.env` 수정 + 재시작 (코드 롤백 불필요).

---

## 7. 위험 요소 및 대응

| 위험 | 가능성 | 영향 | 대응 |
|---|---|---|---|
| 동시성 8 + 지연 400ms로 SMS.to rate limit 도달 | 중 | 일부 메시지 429 | 기존 `processRes.status === 429` 분기에서 `Retry-After` 존중하여 sleep — 이미 구현됨 |
| 빠른 발송으로 통신사 스팸 차단 ↑ | 중 | 수신률 ↓ | 첫 1주일 100건 단위 점진 발송 → SKT/KT/LGU+ 수신률 모니터링. 5%p 이상 하락 시 환경변수로 즉시 원복 |
| 치환 길이 정책 변경으로 분할 과금 발생 | 저 | 비용 ↑ | 응답에 `warnings[]` 포함 → 프론트에서 명시 표시 + 사용자가 인지하고 발송 |
| 폴링 통합으로 race condition (process 중 status 갱신) | 저 | UI 한 박자 늦은 표시 | `processCampaignBatch` 트랜잭션 내부에서 카운터 증가 + 그 직후 SELECT → 정합성 OK |
| 환경변수 누락 시 기본값 fallback | 저 | — | `??` 연산자로 안전한 기본값 보장 + 범위 검증 throw |

---

## 8. 모니터링 / 성공 기준

배포 후 **24시간 동안** 다음 지표 추적:

| 지표 | 측정 방법 | 목표 |
|---|---|---|
| 200건 1캠페인 평균 발송 시간 | `lib/logger` 로그 → grep | < 30초 (기존 ~100초) |
| "발송하기" 클릭 → 첫 진행률 표시 latency | 프론트 콘솔 측정 | < 500ms |
| 치환모드 캠페인 성공률 | `smsLog` `status='DELIVERED'` 비율 | ≥ 평문 발송 대비 -2%p |
| 429 에러 발생률 | `processRes.status === 429` 카운트 | < 1% |
| 사용자 문의 (치환 관련) | 운영 채널 | 0건 |

성공 기준 미달 시 항목별 원복 또는 추가 튜닝.

---

## 9. 일정

| 단계 | 소요 | 시각 |
|---|---|---|
| 코딩 (커밋 1~5) | 90분 | T+0 ~ T+90min |
| 단위/통합 테스트 작성 | 30분 | T+90 ~ T+120min |
| 로컬 수동 검증 (S1~S8) | 30분 | T+120 ~ T+150min |
| 프로덕션 배포 (5.161.112.248) | 15분 | T+150 ~ T+165min |
| 배포 직후 100건 smoke test | 10분 | T+165 ~ T+175min |
| 모니터링 시작 | 24시간 | — |

---

## 10. 승인 / 진행 체크리스트

- [ ] 본 계획서 사용자 승인
- [ ] 작업 브랜치 생성 (`feature/substitution-speed-fix`)
- [ ] 커밋 1: 치환모드 분기 버그
- [ ] 커밋 2: 길이 정책 완화
- [ ] 커밋 3: throttle 환경변수화
- [ ] 커밋 4: 진행률 즉시 표시
- [ ] 커밋 5: 폴링 통합
- [ ] 커밋 6: 문서
- [ ] 자동 테스트 통과
- [ ] 수동 시나리오 S1~S8 통과
- [ ] PR 생성 + 코드 리뷰
- [ ] 프로덕션 배포
- [ ] 24시간 모니터링 결과 기록
