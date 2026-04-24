# Cron 설정

외부 cron 서비스(n8n 권장, 또는 서버 crontab)에서 아래 엔드포인트들을 주기적으로 호출합니다.

| 엔드포인트 | 권장 주기 | 목적 |
|---|---|---|
| `POST /api/cron/process-campaigns` | 1분 | QUEUED/SENDING 캠페인 배치 처리 |
| `POST /api/cron/expire-deposits` | 5분 | 만료된 USDT 입금 요청 정리 |
| `POST /api/cron/txg-poll-reports` | 5분 | TXG 전달 결과 폴링 (Push DLR 누락 대비) |

모든 cron 엔드포인트는 `Authorization: Bearer ${CRON_SECRET}` 헤더로 인증합니다.

---

## 1. 캠페인 자동 처리 (`process-campaigns`)

QUEUED/SENDING 상태의 캠페인을 자동으로 배치 처리합니다.
외부 cron 서비스에서 `POST /api/cron/process-campaigns`를 주기적으로 호출하는 방식입니다.

## 방법 1: n8n 워크플로우 (권장)

1. [ai-n8n.shop](https://ai-n8n.shop)에서 새 워크플로우 생성
2. **Schedule Trigger** 노드 추가: 매 1분 실행
3. **HTTP Request** 노드 추가:
   - Method: `POST`
   - URL: `https://{도메인}/api/cron/process-campaigns`
   - Headers:
     - `Authorization` = `Bearer {CRON_SECRET}`
4. 워크플로우 활성화

### n8n 참고사항

- HTTP Request 노드에서 응답 JSON의 `campaigns` 배열로 처리 결과를 확인할 수 있습니다.
- 처리할 캠페인이 없으면 `{ "message": "처리할 캠페인이 없습니다.", "processed": 0 }`을 반환합니다.
- 필요 시 Telegram 알림 노드를 추가하여 오류 발생 시 알림을 받을 수 있습니다.

## 방법 2: 서버 crontab

```bash
# 매 1분마다 캠페인 처리
* * * * * curl -s -X POST https://{도메인}/api/cron/process-campaigns \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  >> /var/log/sms-cron.log 2>&1
```

### 로그 관리

```bash
# logrotate 설정 (/etc/logrotate.d/sms-cron)
/var/log/sms-cron.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

## 환경변수

| 변수명 | 설명 | 생성 방법 |
|--------|------|----------|
| `CRON_SECRET` | cron API 인증 시크릿 | `openssl rand -base64 32` |

`.env` 파일에 설정:
```
CRON_SECRET=생성된-시크릿-값
```

## Rate Limit

cron API에는 IP 기반 rate limit이 적용되어 있습니다:
- **분당 5회** 제한
- **시간당 120회** 제한
- 초과 시 429 응답 반환

1분 간격 호출 시 분당 1회이므로 정상 운영에는 영향이 없습니다.

## 헬스체크

```bash
# DB 연결 및 대기 캠페인 수 확인 (인증 불필요)
curl -s https://{도메인}/api/health
```

응답 예시:
```json
{
  "status": "ok",
  "timestamp": "2026-04-10T12:00:00.000Z",
  "pendingCampaigns": 3
}
```

오류 시:
```json
{
  "status": "error",
  "message": "서비스 점검 중입니다."
}
```

---

## 2. TXG 전달 결과 폴링 (`txg-poll-reports`)

TXG Push DLR(`PUT /api/txg/report`)이 누락·지연되는 경우를 대비한 이중화 폴링입니다.
최근 24시간 내 `providerName=txg`이면서 `status=SENT`인 로그를 모아 `getreport` API로 결과를 조회해 `DELIVERED/FAILED`를 확정합니다.

### n8n 설정
```
Schedule Trigger: 매 5분
HTTP Request:
  Method: POST
  URL: https://{도메인}/api/cron/txg-poll-reports
  Header: Authorization = Bearer {CRON_SECRET}
```

### 서버 crontab
```bash
# 매 5분마다 TXG 폴링
*/5 * * * * curl -s -X POST https://{도메인}/api/cron/txg-poll-reports \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  >> /var/log/txg-poll.log 2>&1
```

### 응답 예시
```json
{
  "message": "120건 폴링, 34건 상태 업데이트",
  "polled": 120,
  "updated": 34,
  "skippedChunks": 0
}
```

TXG 프로바이더가 미설정이면 즉시 200 + `{ polled: 0, updated: 0, skipped: "provider_not_configured" }` 를 반환합니다 (cron 실패로 처리되지 않음).

---

## 3. TXG Push DLR 웹훅 등록 (cron 아님, 참고용)

TXG 관리 패널에서 콜백 URL을 다음과 같이 등록합니다.

```
URL:    https://{도메인}/api/txg/report
Method: PUT
Header: x-txg-token: {TXG_DLR_SECRET}
```

`TXG_DLR_SECRET`은 `openssl rand -base64 32` 로 생성한 값을 `.env`와 TXG 관리 패널 양쪽에 동일하게 입력해야 합니다.
미설정 시 DLR 요청을 전면 거부합니다 (503).

---

## 4. 만료된 USDT 입금 정리 (`expire-deposits`)

기존 `POST /api/cron/expire-deposits`는 5분 간격으로 호출해 `expiresAt` 경과 입금을 `EXPIRED` 처리합니다. 세부 설정은 본 장 1절과 동일 패턴입니다.
