# 건수 지급/차감 기능 설계 (관리자)

2026-04-17

## 배경

관리자가 유저에게 크레딧을 원화 금액(예: 1,400원)으로 입력하던 것을, SMS **건수**(예: 100건)로 입력할 수 있게 한다. USDT 결제만 운영하므로 `1 USDT = 1원 = 1건 × costPerMessage`의 등가로 간주한다.

## 스코프

- 관리자 패널 유저 상세(`/users/[id]`) 크레딧 모달에 "금액 / 건수" 토글 추가
- 백엔드 API `/api/users/[id]/credits`에 `unit: KRW | COUNT` 입력 지원
- DB 스키마 변경 없음 (`User.credits`와 `CreditLedger`를 그대로 사용)

## 설계

### 변환 규칙

`amount_krw = count × user.costPerMessage`

- 트랜잭션 내부에서 `costPerMessage` 조회 (TOCTOU 방지)
- `costPerMessage = 0`이면 400 "단가가 설정되지 않은 유저입니다."
- `count` 범위: 1 ~ 1,000,000

### API 변경 (`admin/app/api/users/[id]/credits/route.ts`)

```ts
const creditAdjustSchema = z.object({
  unit: z.enum(['KRW', 'COUNT']).default('KRW'),
  amount: z.number().optional(),   // unit=KRW일 때
  count: z.number().int().min(1).max(1_000_000).optional(), // unit=COUNT일 때
  type: z.enum(['ADMIN_ADD', 'ADMIN_DEDUCT', 'CORRECTION', 'BONUS']),
  reason: z.string().min(10),
  idempotencyKey: z.string().optional(),
}).refine(d => (d.unit === 'KRW' ? d.amount !== undefined && d.amount !== 0 : d.count !== undefined),
  '단위에 맞는 값을 입력하세요.');
```

트랜잭션 내부:
1. `user` 조회 (`credits`, `costPerMessage`)
2. `unit === 'COUNT'`이면 `absAmount = count × costPerMessage`, 아니면 기존 `absAmount = |amount|`
3. 이후 로직(권한·잔액 체크·업데이트·원장 기록) **그대로 재사용**
4. `CreditLedger.description`에 건수 기록: `"건수 100건 지급 (단가 14원, 환산 1,400원) — 사유: xxx"`

Audit log metadata에 `unit`, `count`, `costPerMessage` 추가.

### UI 변경 (`admin/app/users/[id]/page.tsx`, 모달 내부)

- 라디오 토글: `● 금액(원)   ○ 건수(건)`
- 건수 모드일 때:
  - input placeholder `"건수를 입력하세요"`, step/min 정수
  - 미리보기 라인: `"100건 × 14원 = 1,400원이 적립됩니다"` (입력 변경 시 실시간)
- 제출 시 요청 body:
  - 금액 모드: `{ unit: 'KRW', amount, ... }`
  - 건수 모드: `{ unit: 'COUNT', count, ... }`

## 엣지 케이스

| 상황 | 처리 |
|---|---|
| `costPerMessage = 0` | 400 "단가 미설정" |
| 차감 시 환산액 > 현재 잔액 | 기존 INSUFFICIENT_BALANCE 에러 재사용 |
| count=0 또는 소수 | zod 검증 실패 (400) |
| 환산액 100,000원 초과 | 기존 `credit:adjust_large` 권한 요구 |

## 보안·감사

- SUDO 모드 그대로 필요
- 권한 정책 무변경 (금액 기준으로 판정)
- Audit metadata: `{ unit, count, costPerMessage, amount, ledgerId }`

## 호환성

- `unit` 미지정 요청은 `KRW`로 기본 처리 → 기존 클라이언트 코드 무영향
- 기존 원장·환불·발송 흐름 일체 무변경

## 배포 절차

1. 로컬 타입체크·빌드
2. 커밋 + main 푸시
3. 프로덕션 rsync (`5.161.112.248:/opt/sovereign-sms/`)
4. `docker compose build sovereign-sms-admin && docker compose up -d sovereign-sms-admin`
5. Playwright로 로그인 → 유저 상세 → 건수 100건 지급 → 원장 확인
