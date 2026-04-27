# Cron 설정

외부 cron 서비스(n8n 권장, 또는 서버 crontab)에서 아래 엔드포인트들을 주기적으로 호출합니다.

| 엔드포인트 | 권장 주기 | 목적 |
|---|---|---|
| `POST /api/cron/process-campaigns` | 1분 | QUEUED/SENDING 캠페인 배치 처리 (Infobip/SMS.to 전용 — TXG는 SMPP 워커가 단독 처리) |
| `POST /api/cron/expire-deposits` | 5분 | 만료된 USDT 입금 요청 정리 |

> **TXG는 cron 불필요.** SMPP 워커(`sovereign-sms-smpp-worker` 컨테이너)가 자체 폴링 루프로 PENDING 행을 처리하고, deliver_sm DLR을 같은 SMPP 연결에서 in-band로 받습니다. HTTP push DLR webhook(`/api/txg/report`)와 폴링 cron(`/api/cron/txg-poll-reports`)은 **2026-04-27 SMPP 전환과 함께 폐기**되었습니다.

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

## 2. TXG SMPP 워커 (cron 아님 — daemon 컨테이너)

TXG 발송은 SMPP 3.4 transceiver 단일 연결로 송수신합니다.
`sovereign-sms-smpp-worker` 컨테이너가 다음 환경변수로 동작합니다:

```
TXG_SMPP_HOST=...           # TXG 발급
TXG_SMPP_PORT=20002
TXG_SMPP_SYSTEM_ID=...      # TXG Username
TXG_SMPP_PASSWORD=...       # TXG SMPP Password (평문)
TXG_HTTP_BALANCE_URL=...    # 잔액 조회용 HTTP (포트 20003)
TXG_HTTP_ACCOUNT=...
TXG_HTTP_PASSWORD=...
```

배포:
```bash
docker compose up -d sovereign-sms-smpp-worker
docker compose logs -f sovereign-sms-smpp-worker
```

**⚠️ 단일 인스턴스만 실행.** 다중 바인드는 TXG 계정 정지 사유.
docker-compose.yml의 `deploy.replicas: 1`이 강제하지만 수동 `docker run` 등으로 추가 실행하면 안 됨.

워커는 활성 SMS 프로바이더가 `txg`일 때만 PENDING 행을 처리합니다 (관리자 패널에서 활성 프로바이더 변경 시 워커 재시작 불필요).

---

## 3. 만료된 USDT 입금 정리 (`expire-deposits`)

기존 `POST /api/cron/expire-deposits`는 5분 간격으로 호출해 `expiresAt` 경과 입금을 `EXPIRED` 처리합니다. 세부 설정은 본 장 1절과 동일 패턴입니다.
