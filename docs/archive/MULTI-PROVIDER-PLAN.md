# SovereignSMS 멀티 프로바이더 통합 계획서

> 작성일: 2026-04-14
> 프로젝트: `~/Desktop/sms문자사이트`
> 목적: Infobip 단일 의존 탈피 → SMS.to 추가 (2개 라인 체제)
> 상태: ✅ 구현 완료

---

## 1. 현재 상태

### SovereignSMS (메인 서비스)
- **스택**: Next.js 16 + Prisma 7.7 + PostgreSQL
- **SMS 프로바이더**: Infobip + SMS.to (2개 라인)
- **발송 로직**: `lib/campaign-processor.ts` → `SmsProviderRouter` → 활성 프로바이더
- **발신번호**: `senderId` 필드 추가 완료 (Alphanumeric, 매 캠페인 랜덤 생성)

---

## 2. 목표 아키텍처

```
유저 (발송 요청)
  ↓ 프로바이더 모름
캠페인 API (app/api/sms/campaign/route.ts)
  ↓
campaign-processor.ts
  ↓
SmsProviderRouter ← 관리자 설정에서 활성 프로바이더 결정
  ├── InfobipProvider   (기존)
  └── SmsToProvider     (신규)
```

### 핵심 원칙
1. **유저는 프로바이더 존재를 모름** — UI에 프로바이더 노출 없음
2. **관리자만 라인 전환** — 관리자 패널 설정에서 활성 프로바이더 선택
3. **즉시 전환** — 장애 시 관리자가 다른 라인으로 즉시 전환
4. **통일된 인터페이스** — 모든 프로바이더가 동일한 SmsProvider interface 구현

---

## 3. 프로바이더별 API 스펙 비교

| 항목 | Infobip | SMS.to |
|------|---------|--------|
| 인증 | API Key 헤더 | Bearer Token |
| 발송 엔드포인트 | `/sms/2/text/advanced` | `/v1/sms/send` |
| 최대 수신자/요청 | 200 (배치) | 500 |
| 응답 형식 | JSON (messages[]) | JSON (message_id) |
| DLR | Webhook | Webhook + API 폴링 |
| 발신번호 | Alphanumeric/Numeric | Alphanumeric/Numeric |
| 잔액 API | `/account/1/balance` | `/v1/balance` |
| 한국 건당 단가 | ~$0.03 (Trial 무료) | ~$0.009 |

---

## 4. 구현 완료 내역

### 4-1. Provider Interface (`lib/sms-providers/types.ts`) ✅
- `SmsProvider` interface: `sendBatch()`, `getBalance()`, `isConfigured()`
- `SmsProviderName`: `'infobip' | 'smsto'`
- 공통 타입: `SmsSendRequest`, `SmsSendResult`, `SmsProviderBalance`

### 4-2. Infobip Provider (`lib/sms-providers/infobip.ts`) ✅
- 기존 `lib/infobip.ts` 로직을 SmsProvider interface로 래핑
- maxBatchSize: 200

### 4-3. SMS.to Provider (`lib/sms-providers/smsto.ts`) ✅
- `~/Desktop/sms.to/src/services/smstoClient.ts` 참조하여 구현
- Bearer Token 인증, 개별 메시지 발송, 500건 청크
- maxBatchSize: 500

### 4-4. Provider Router (`lib/sms-providers/router.ts`) ✅
- `getActiveProvider()`: SystemSetting에서 활성 프로바이더 조회
- `getProviderByName()`: 이름으로 인스턴스 생성
- `getAllProviders()`: 전체 목록 반환
- 미설정 시 infobip 폴백

### 4-5. campaign-processor.ts 수정 ✅
- `infobipClient` 직접 호출 → `getActiveProvider().sendBatch()` 추상화
- 통일된 `SmsSendResult` 기반 응답 파싱

### 4-6. 관리자 API (`admin/app/api/sms-providers/`) ✅
- `GET /api/sms-providers`: 프로바이더 목록 + 활성 상태 조회
- `PUT /api/sms-providers`: 활성 프로바이더 변경 (감사 로그 기록)
- `POST /api/sms-providers/test`: 연결 테스트 (잔액 조회)
- `POST /api/sms-providers/send-test`: 테스트 발송 (1건)

### 4-7. 관리자 UI (`admin/app/sms-providers/page.tsx`) ✅
- 프로바이더 카드 (활성/비활성 표시)
- 연결 테스트 버튼 (잔액 조회)
- 테스트 발송 모달
- 활성 라인 변경 모달 (사유 입력 필수)
- 사이드바에 "SMS 라인 관리" 메뉴 추가

### 4-8. .env 추가 ✅
- `SMSTO_API_KEY=""` 추가

### 4-9. DB 설정 (SystemSetting)
```json
{
  "key": "active_sms_provider",
  "value": { "provider": "infobip" },
  "category": "sms"
}
```

---

## 5. 파일 구조

```
lib/sms-providers/
├── types.ts           # SmsProvider interface, 공통 타입
├── router.ts          # 활성 프로바이더 결정 로직
├── infobip.ts         # Infobip 구현
└── smsto.ts           # SMS.to 구현

admin/app/sms-providers/
└── page.tsx           # 관리자 SMS 라인 관리 UI

admin/app/api/sms-providers/
├── route.ts           # GET: 목록 조회, PUT: 활성 라인 변경
├── test/route.ts      # POST: 연결 테스트 (잔액 조회)
└── send-test/route.ts # POST: 테스트 발송
```

---

## 6. 빌드 검증

- [x] 유저 앱 (`next build`) — 성공
- [x] 관리자 앱 (`next build`) — 성공

---

## 7. 향후 확장 (필요 시)

- **MessageBird 추가**: `lib/sms-providers/messagebird.ts` 구현 + `SmsProviderName`에 추가
- **EasySendSMS 추가**: `lib/sms-providers/easysendsms.ts` 구현 + `SmsProviderName`에 추가
- **자동 failover**: 활성 프로바이더 실패 시 자동으로 fallback 프로바이더로 전환
- **프로바이더별 통계**: 각 프로바이더의 전달률/비용 비교 대시보드
