# 캠페인 자동 처리 Cron 설정

## 개요

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
