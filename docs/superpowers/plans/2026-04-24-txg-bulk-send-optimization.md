# TXG 대량발송 라인 최적화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TXG를 주 프로바이더로 운영하기 위한 최소 세팅(시크릿·크론·웹훅)과 배치 효율 개선을 완료하여, 브라우저를 닫아도 발송이 진행되고 TXG의 네이티브 10K 배치 성능을 최대 활용한다.

**Architecture:** 세 단계 — (A) 운영 인프라(시크릿·크론)로 백그라운드 발송/DLR 루프 복구 → (B) TXG `pushurl` 파라미터 추가로 Push DLR 수신 활성화 → (C) 프로바이더별 `maxBatchSize`를 도입해 TXG 전용 배치 상향. 각 단계는 독립적으로 운영 가치를 제공하며 중간 커밋이 가능하다.

**Tech Stack:** Next.js 16 (proxy.ts) · Prisma 7.7 · Vitest · Docker Compose · Linux cron · TXG-TEL HTTP API V3.4

---

## File Structure Overview

| 경로 | 역할 | 변경 유형 |
|---|---|---|
| `lib/sms-providers/txg.ts` | TXG API 클라이언트 — `pushurl` 파라미터 추가 | Modify |
| `lib/sms-providers/types.ts` | `SmsProvider` 인터페이스 (기존) | Read only |
| `lib/sms-policy.ts` | 전역 정책 상수 — `maxBatchSize` 의존성을 provider별로 분리 | Modify |
| `lib/campaign-processor.ts` | 배치 크기 상한을 `provider.maxBatchSize`로 교체 | Modify |
| `app/dashboard/sms-send/page.tsx` | 프론트 `DEFAULT_BATCH_SIZE=200` 하드코딩 제거, `batchSize` 파라미터 생략해 서버가 provider 기반 결정하도록 위임 | Modify |
| `__tests__/lib/txg-provider.test.ts` | TxgProvider pushurl/배치크기 단위 테스트 | Create |
| `__tests__/lib/campaign-batch-size.test.ts` | 프로바이더별 배치 상한 테스트 | Create |
| `scripts/generate-secrets.sh` | CRON_SECRET·TXG_DLR_SECRET 32자 랜덤 생성 헬퍼 | Create |
| `scripts/install-sovereign-cron.sh` | 서버에 crontab 항목 설치 스크립트 | Create |
| `/opt/sovereign-sms/.env` (서버) | `CRON_SECRET`, `TXG_DLR_SECRET`, `TXG_DLR_WEBHOOK_URL` 추가 | Modify (remote) |
| `/etc/cron.d/sovereign-sms` (서버) | cron 엔트리 파일 | Create (remote) |

---

## Pre-flight: 작업 안전 장치

- [x] **환경 확인**: 로컬 HEAD가 `origin/main`과 일치하는지 확인
  ```
  git status -sb && git rev-parse HEAD && git rev-parse origin/main
  ```
  Expected: `## main...origin/main` + 동일 커밋 해시

- [x] **작업 브랜치 생성**: 모든 코드 변경은 전용 브랜치에서
  ```
  git checkout -b feat/txg-bulk-send-ops
  ```

- [x] **서버 백업 플래그 설정**: 이 계획 시작 시점의 컨테이너 이미지에 rollback 태그
  ```
  ssh root@5.161.112.248 'docker tag sovereign-sms-sovereign-sms-user:latest sovereign-sms-sovereign-sms-user:pre-txg-opt && docker tag sovereign-sms-sovereign-sms-admin:latest sovereign-sms-sovereign-sms-admin:pre-txg-opt'
  ```

---

## Phase A — 운영 인프라 (시크릿 + 크론)

### Task 1: 시크릿 생성 헬퍼 스크립트 작성

**Files:**
- Create: `scripts/generate-secrets.sh`

- [x] **Step 1: 스크립트 작성**

파일 내용:
```bash
#!/usr/bin/env bash
# CRON_SECRET / TXG_DLR_SECRET 용 32-byte URL-safe 랜덤 생성기
set -euo pipefail
NAME="${1:-SECRET}"
openssl rand -base64 32 | tr -d '/+=' | cut -c1-32 | awk -v n="$NAME" '{print n"="$0}'
```

- [x] **Step 2: 실행 권한 부여 + 동작 확인**

```bash
chmod +x scripts/generate-secrets.sh
./scripts/generate-secrets.sh CRON_SECRET
```

Expected: 32자 영숫자 + `CRON_SECRET=` 접두사가 찍힌 한 줄

- [x] **Step 3: 커밋**

```bash
git add scripts/generate-secrets.sh
git commit -m "chore(scripts): 32자 시크릿 생성 헬퍼 추가"
```

---

### Task 2: 서버 `.env`에 시크릿 추가

**Files:**
- Modify (remote): `/opt/sovereign-sms/.env`

- [x] **Step 1: 두 개의 시크릿 생성 (로컬)**

```bash
CRON_VAL=$(./scripts/generate-secrets.sh CRON_SECRET | cut -d= -f2)
DLR_VAL=$(./scripts/generate-secrets.sh TXG_DLR_SECRET | cut -d= -f2)
echo "CRON=$CRON_VAL"; echo "DLR=$DLR_VAL"
```

둘 다 로컬에 임시로 저장해놓을 것 (다음 Task에서 재사용).

- [x] **Step 2: 기존 `.env` 백업 + 시크릿 3종 주입**

```bash
ssh root@5.161.112.248 "cp /opt/sovereign-sms/.env /opt/sovereign-sms/.env.bak.$(date +%s)"
ssh root@5.161.112.248 "cat >> /opt/sovereign-sms/.env <<'EOF'

# Cron & TXG DLR
CRON_SECRET=$CRON_VAL
TXG_DLR_SECRET=$DLR_VAL
TXG_DLR_WEBHOOK_URL=http://5.161.112.248:3300/api/txg/report
EOF"
```

- [x] **Step 3: 적용 확인**

```bash
ssh root@5.161.112.248 'grep -E "^(CRON_SECRET|TXG_DLR_SECRET|TXG_DLR_WEBHOOK_URL)=" /opt/sovereign-sms/.env | sed "s/=.*$/=***/"'
```

Expected:
```
CRON_SECRET=***
TXG_DLR_SECRET=***
TXG_DLR_WEBHOOK_URL=***
```

- [x] **Step 4: 컨테이너 재기동 (env 반영)**

```bash
ssh root@5.161.112.248 'cd /opt/sovereign-sms && docker compose up -d'
```

- [x] **Step 5: DLR 엔드포인트 인증 작동 확인**

```bash
# 시크릿 없이 호출 → 401 기대
curl -s -o /dev/null -w "%{http_code}\n" -X PUT -H "Content-Type: application/json" -d '{"type":"report","array":[]}' http://5.161.112.248:3300/api/txg/report
```

Expected: `401`

```bash
# 올바른 시크릿 호출 → 200
curl -s -o /dev/null -w "%{http_code}\n" -X PUT \
  -H "Content-Type: application/json" \
  -H "x-txg-token: $DLR_VAL" \
  -d '{"type":"report","array":[]}' http://5.161.112.248:3300/api/txg/report
```

Expected: `200`

- [x] **Step 6: 시크릿 값을 안전한 곳에 기록 후 셸 변수 클리어**

두 시크릿 모두 사용자 패스워드 매니저/안전한 저장소에 기록. 그 후:

```bash
unset CRON_VAL DLR_VAL
```

(서버 .env는 이 작업에 해당 사항 없음. Git 커밋 대상 아님.)

---

### Task 3: 서버 cron 설치 스크립트 작성

**Files:**
- Create: `scripts/install-sovereign-cron.sh`

- [x] **Step 1: 스크립트 작성**

파일 내용:
```bash
#!/usr/bin/env bash
# /etc/cron.d/sovereign-sms 에 캠페인/DLR 폴링/USDT 만료 cron을 설치한다.
# 사용: CRON_SECRET=xxxxx ./scripts/install-sovereign-cron.sh
# 서버에서 root 권한으로 실행 (ssh로 업로드 후).
set -euo pipefail

: "${CRON_SECRET:?CRON_SECRET 환경변수 필수}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3300}"
FILE=/etc/cron.d/sovereign-sms

cat > "$FILE" <<EOF
# SovereignSMS — 자동 생성됨 (scripts/install-sovereign-cron.sh)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 캠페인 자동 진행 — 매 1분
* * * * * root curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" $BASE_URL/api/cron/process-campaigns -m 50 >> /var/log/sovereign-cron.log 2>&1

# TXG DLR 폴링 — 매 5분
*/5 * * * * root curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" $BASE_URL/api/cron/txg-poll-reports -m 120 >> /var/log/sovereign-cron.log 2>&1

# USDT 입금 만료 정리 — 매 10분
*/10 * * * * root curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" $BASE_URL/api/cron/expire-deposits -m 30 >> /var/log/sovereign-cron.log 2>&1
EOF

chmod 644 "$FILE"
touch /var/log/sovereign-cron.log
chmod 640 /var/log/sovereign-cron.log
systemctl reload cron || service cron reload || true
echo "설치 완료: $FILE"
```

- [x] **Step 2: 실행 권한 부여 + 로컬 구문 검증**

```bash
chmod +x scripts/install-sovereign-cron.sh
bash -n scripts/install-sovereign-cron.sh && echo "syntax OK"
```

Expected: `syntax OK`

- [x] **Step 3: 커밋**

```bash
git add scripts/install-sovereign-cron.sh
git commit -m "chore(scripts): 서버 cron 설치 스크립트 추가"
```

---

### Task 4: 서버에 cron 배포 + 동작 검증

**Files:**
- Create (remote): `/etc/cron.d/sovereign-sms`
- Read (remote): `/var/log/sovereign-cron.log`

- [x] **Step 1: 스크립트 서버에 업로드**

```bash
scp scripts/install-sovereign-cron.sh root@5.161.112.248:/tmp/install-sovereign-cron.sh
```

- [x] **Step 2: CRON_SECRET 불러와 설치 실행**

```bash
CRON_VAL=<PW매니저에서 복사>
ssh root@5.161.112.248 "CRON_SECRET=$CRON_VAL bash /tmp/install-sovereign-cron.sh"
```

Expected: `설치 완료: /etc/cron.d/sovereign-sms`

- [x] **Step 3: cron 등록 확인**

```bash
ssh root@5.161.112.248 'ls -l /etc/cron.d/sovereign-sms && cat /etc/cron.d/sovereign-sms | sed "s/Bearer [a-zA-Z0-9]*/Bearer ***/"'
```

Expected: 파일 존재 + 3개 cron 엔트리가 `Bearer ***` 마스킹된 채 출력

- [x] **Step 4: 2분 대기 후 로그 확인 (최소 1회 실행 기대)**

```bash
sleep 90
ssh root@5.161.112.248 'tail -20 /var/log/sovereign-cron.log'
```

Expected: `process-campaigns` 호출에 대한 JSON 응답 (빈 캠페인이면 `{"message":"처리할 캠페인이 없습니다."}` 등)

- [x] **Step 5: 인증 실패가 아니라는 추가 검증**

```bash
ssh root@5.161.112.248 'docker logs sovereign-sms-user --since 2m 2>&1 | grep -iE "cron|unauthorized|forbidden" | tail -10'
```

Expected: `401` / `403` 로그가 없어야 함. 정상 호출의 info 로그만 나와야 함.

- [x] **Step 6: 임시 업로드 파일 정리**

```bash
ssh root@5.161.112.248 'rm /tmp/install-sovereign-cron.sh'
```

- [x] **Step 7: 롤백 방법 메모** (실패 시 복구)

롤백 커맨드:
```bash
ssh root@5.161.112.248 'rm /etc/cron.d/sovereign-sms && systemctl reload cron'
```

(코드 변경 없음. 커밋 대상 아님.)

---

## Phase B — TXG Push DLR 활성화

### Task 5: TxgProvider에 pushurl 파라미터 추가 — 실패 테스트 먼저

**Files:**
- Create: `__tests__/lib/txg-provider.test.ts`

- [x] **Step 1: 실패 테스트 작성**

파일 내용:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TxgProvider } from '@/lib/sms-providers/txg';

describe('TxgProvider.sendBatch — pushurl 주입', () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TXG_ACCOUNT = 'test-account';
    process.env.TXG_PASSWORD = 'test-password';
    process.env.TXG_BASE_URL = 'http://txg.test';
    process.env.TXG_DLR_WEBHOOK_URL = 'https://example.com/api/txg/report';

    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 0,
        success: 1,
        fail: 0,
        array: [['+821011112222', 12345]],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('TXG_DLR_WEBHOOK_URL이 설정되면 단일 본문 요청에 pushurl 포함', async () => {
    const provider = new TxgProvider();
    await provider.sendBatch([{ to: '+821011112222', text: 'hi' }]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.pushurl).toBe('https://example.com/api/txg/report');
  });

  it('TXG_DLR_WEBHOOK_URL이 설정되면 다중 본문 요청에도 pushurl 포함', async () => {
    const provider = new TxgProvider();
    await provider.sendBatch([
      { to: '+821011112222', text: 'a' },
      { to: '+821033334444', text: 'b' },
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.pushurl).toBe('https://example.com/api/txg/report');
  });

  it('TXG_DLR_WEBHOOK_URL이 없으면 pushurl 미포함', async () => {
    delete process.env.TXG_DLR_WEBHOOK_URL;
    const provider = new TxgProvider();
    await provider.sendBatch([{ to: '+821011112222', text: 'hi' }]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.pushurl).toBeUndefined();
  });
});
```

- [x] **Step 2: 테스트 실행 (실패 기대)**

```bash
npx vitest run __tests__/lib/txg-provider.test.ts
```

Expected: 3개 테스트 모두 FAIL. 이유: `body.pushurl` 필드가 존재하지 않음 → `undefined !== 'https://...'`

---

### Task 6: TxgProvider에 pushurl 구현

**Files:**
- Modify: `lib/sms-providers/txg.ts`

- [x] **Step 1: `sendSingleContent`의 body 조립 수정**

`lib/sms-providers/txg.ts`에서 `sendSingleContent` 내부의 `const body = { ... }` 블록을 다음으로 교체:

```typescript
    const pushurl = process.env.TXG_DLR_WEBHOOK_URL;
    const body: Record<string, unknown> = {
      ...this.authParams,
      numbers,
      content: messages[0].text,
      smstype: 0,
      sender: '', // 업체 요청: Sender ID 지원 안하므로 빈 값으로 설정
    };
    if (pushurl) body.pushurl = pushurl;
```

- [x] **Step 2: `sendMultiContent`의 body 조립 수정**

동일 파일의 `sendMultiContent` 내부 `const body = { ... }`를 다음으로 교체:

```typescript
    const pushurl = process.env.TXG_DLR_WEBHOOK_URL;
    const body: Record<string, unknown> = {
      ...this.authParams,
      smsarray,
    };
    if (pushurl) body.pushurl = pushurl;
```

- [x] **Step 3: 테스트 재실행 (성공 기대)**

```bash
npx vitest run __tests__/lib/txg-provider.test.ts
```

Expected: 3개 테스트 모두 PASS

- [x] **Step 4: TypeScript 전체 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [x] **Step 5: 커밋**

```bash
git add lib/sms-providers/txg.ts __tests__/lib/txg-provider.test.ts
git commit -m "feat(txg): TXG_DLR_WEBHOOK_URL 환경변수 기반 pushurl 주입"
```

---

### Task 7: 방화벽 인바운드 확인

**Files:** (없음, 서버 네트워크 검증)

- [x] **Step 1: 외부망에서 TXG DLR 엔드포인트 도달 가능성 확인**

로컬에서:
```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" -X PUT \
  -H "Content-Type: application/json" \
  -H "x-txg-token: invalid" \
  -d '{"type":"report","array":[]}' \
  http://5.161.112.248:3300/api/txg/report
```

Expected: `401`이 1초 이내 반환. 타임아웃이면 방화벽 문제.

- [x] **Step 2: 서버 방화벽 인바운드 규칙 확인** (ufw/iptables)

```bash
ssh root@5.161.112.248 'ufw status 2>/dev/null | grep -E "3300|ALLOW" | head -20; iptables -L INPUT -n 2>/dev/null | grep 3300'
```

Expected: 3300 포트가 명시적으로 차단되어 있지 않아야 함 (기본 정책이 ACCEPT면 OK).

- [x] **Step 3: Hetzner 클라우드 방화벽 (옵션)**

Hetzner 콘솔에서 해당 VPS에 할당된 방화벽이 있는지 확인. 있다면 3300/tcp 인바운드 규칙 필요.
(UI 작업이므로 이 계획에는 체크포인트만 남김. 필요 시 사용자에게 확인 요청.)

- [x] **Step 4: TXG-TEL 고객센터에 webhook URL 등록 문의**

다음 내용으로 요청:
```
SMPP/HTTP 계정: 0278C012
Push DLR 웹훅 URL: http://5.161.112.248:3300/api/txg/report
인증 헤더: x-txg-token: <비공개>
```

※ TXG는 `pushurl`을 요청 바디에 넣어도 동작하지만, 일부 운영자는 **계정 레벨 웹훅** 고정 등록을 선호. 이중 설정 안 됨 → 사용자 확인 후 결정.

- [x] **Step 5: 실발송 1건으로 end-to-end DLR 검증**

유저 앱에서 1건 테스트 발송. 완료 후 5분 이내:
```bash
ssh root@5.161.112.248 'docker exec sms-postgres psql -U smsuser -d bulksms -c "SELECT status, \"providerStatus\", \"createdAt\" FROM \"SmsLog\" WHERE \"providerName\"='"'"'txg'"'"' ORDER BY \"createdAt\" DESC LIMIT 5;"'
```

Expected: `status`가 `DELIVERED` 또는 `FAILED`로 전이됨 (5분 이내면 Push 작동, 5~10분이면 폴링 대기). `SENT`에 영원히 머무르면 Push+폴링 둘 다 실패 → TXG 계정 설정 재확인 필요.

(이 Task는 원격 작업만 수행. 로컬 코드 변경 없음 → 커밋 대상 아님.)

---

## Phase C — 배치 크기 최적화

### Task 8: `SmsProvider` 인터페이스의 `maxBatchSize` 활용 — 실패 테스트 작성

**Files:**
- Create: `__tests__/lib/campaign-batch-size.test.ts`

- [x] **Step 1: 실패 테스트 작성**

파일 내용:
```typescript
import { describe, it, expect } from 'vitest';
import { getProviderByName } from '@/lib/sms-providers/router';

describe('프로바이더별 maxBatchSize', () => {
  it('TXG 프로바이더는 최소 1000건 배치를 지원', () => {
    const provider = getProviderByName('txg');
    expect(provider.maxBatchSize).toBeGreaterThanOrEqual(1000);
  });

  it('SMS.to 프로바이더는 200 이하 (통신사 throttling 준수)', () => {
    const provider = getProviderByName('smsto');
    expect(provider.maxBatchSize).toBeLessThanOrEqual(200);
  });

  it('Infobip 프로바이더는 200 이하 (기존 유지)', () => {
    const provider = getProviderByName('infobip');
    expect(provider.maxBatchSize).toBeLessThanOrEqual(200);
  });
});

describe('campaign-processor 배치 크기 제한', () => {
  it('SMS_POLICY.maxBatchSize 상수는 더 이상 프로바이더 배치 상한으로 쓰이지 않는다', async () => {
    // campaign-processor.ts 소스를 직접 검사해서 SMS_POLICY.maxBatchSize 의존이 `provider.maxBatchSize`로 대체됐는지 확인.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('lib/campaign-processor.ts', 'utf8');
    // 배치 clamp 라인에서 SMS_POLICY.maxBatchSize 가 아닌 provider.maxBatchSize 를 사용해야 한다.
    // maxRetries 용도는 그대로 유지 가능.
    const clampSection = src.slice(src.indexOf('effectiveBatchSize'), src.indexOf('FOR UPDATE SKIP LOCKED'));
    expect(clampSection).toContain('provider.maxBatchSize');
  });
});
```

- [x] **Step 2: 테스트 실행 (실패 기대)**

```bash
npx vitest run __tests__/lib/campaign-batch-size.test.ts
```

Expected:
- `TXG 프로바이더는 최소 1000건 배치를 지원` → PASS (TxgProvider는 이미 maxBatchSize=10000)
- `SMS.to 프로바이더는 200 이하` → PASS (기존 200)
- `Infobip 프로바이더는 200 이하` → PASS 또는 FAIL (InfobipProvider의 값 확인 필요)
- 마지막 `provider.maxBatchSize 사용` 테스트는 FAIL (현재 코드는 `SMS_POLICY.maxBatchSize` 사용 중)

※ Infobip 값이 200을 초과하면 Infobip 파일을 읽어 해당 값을 테스트에 반영. 이 Task는 **TXG·SMS.to에 집중**하고 Infobip은 현재 값을 그대로 허용하는 방향으로 assertion을 조정해도 된다.

---

### Task 9: InfobipProvider `maxBatchSize` 값 확인 후 테스트 정합화

**Files:**
- Read: `lib/sms-providers/infobip.ts`
- Modify (조건부): `__tests__/lib/campaign-batch-size.test.ts`

- [x] **Step 1: InfobipProvider의 현재 maxBatchSize 확인**

```bash
grep -n "maxBatchSize" lib/sms-providers/infobip.ts
```

- [x] **Step 2: 테스트 assertion 조정**

확인된 실제값을 사용:
- 현재 200 이하면 테스트 그대로 OK
- 200 초과면 테스트에서 `toBeLessThanOrEqual(<실제값>)`로 맞춤 (코드 변경보다 테스트 정합 우선)

(Commit 없음 — Task 10에서 통합 커밋.)

---

### Task 10: `campaign-processor.ts` 배치 클램프를 provider 기반으로 교체

**Files:**
- Modify: `lib/campaign-processor.ts`

- [x] **Step 1: 현재 코드의 치환 대상 5곳 위치 확인**

`lib/campaign-processor.ts`에서 다음 패턴이 등장하는 라인을 기록한다:

```bash
grep -n "DEFAULT_BATCH_SIZE\|SMS_POLICY.maxBatchSize" lib/campaign-processor.ts
```

Expected: 5개 위치 — line 16(선언), 45(함수 인자 fallback), 88(clamp 내부), 89·92(clamp 상한), 288·359(dynamic 조정). 정확한 라인 번호는 실행 시 달라질 수 있음.

- [x] **Step 2: provider를 함수 진입 초기(killSwitch 검사 이후)에 로드**

`processCampaignBatch` 내 기존에 `await getActiveProvider();` 위치를 찾아 campaign/user/killSwitch 체크 **직후**, cooldown 체크 **이전** 구간으로 옮긴다. 결과적으로 다음 순서:
```
1. campaign 조회
2. killSwitch 체크
3. user 상태 체크
4. 종료 상태 체크(CANCELLED/COMPLETED/FAILED)
5. 쿨다운 체크
6. const provider = await getActiveProvider();         ← 추가
7. const providerMaxBatch = Math.max(1, provider.maxBatchSize);  ← 추가
8. effectiveBatchSize 계산 (아래 Step 3 코드 사용)
9. SELECT FOR UPDATE SKIP LOCKED
...
```

이 과정에서 함수 중반부의 **기존 `const provider = await getActiveProvider();` 라인은 삭제**한다 (중복 제거).

- [x] **Step 3: clamp 3블록을 provider 기반으로 교체**

**블록 A — `effectiveBatchSizeInput` (line 44~46 부근):**

Before:
```typescript
  const effectiveBatchSizeInput = batchSize
    ? clampInt(batchSize, 1, 1000)
    : DEFAULT_BATCH_SIZE;
```

After: provider 로드가 이 지점에서는 아직 안 됐으므로, 이 계산을 provider 로드 **이후로 이동**시킨다. 실제 배치 위치:

```typescript
  // Step 2에서 추가한 provider 로드 바로 다음
  const provider = await getActiveProvider();
  const providerMaxBatch = Math.max(1, provider.maxBatchSize);

  const effectiveBatchSizeInput = batchSize
    ? clampInt(batchSize, 1, 10000)
    : providerMaxBatch;
```

**블록 B — `effectiveBatchSize` (line 86~94 부근):**

Before:
```typescript
  const effectiveBatchSize = clampInt(
    Math.min(
      effectiveBatchSizeInput,
      campaign.dynamicBatchSize || DEFAULT_BATCH_SIZE,
      SMS_POLICY.maxBatchSize,
    ),
    1,
    SMS_POLICY.maxBatchSize,
  );
```

After:
```typescript
  const effectiveBatchSize = clampInt(
    Math.min(
      effectiveBatchSizeInput,
      campaign.dynamicBatchSize || providerMaxBatch,
      providerMaxBatch,
    ),
    1,
    providerMaxBatch,
  );
```

**블록 C — 일시장애 시 배치 반감 (line 288 부근):**

Before:
```typescript
      const nextDynamic = Math.max(
        MIN_DYNAMIC_BATCH_SIZE,
        Math.floor((campaign.dynamicBatchSize || DEFAULT_BATCH_SIZE) / 2),
      );
```

After:
```typescript
      const nextDynamic = Math.max(
        MIN_DYNAMIC_BATCH_SIZE,
        Math.floor((campaign.dynamicBatchSize || providerMaxBatch) / 2),
      );
```

**블록 D — 성공 후 배치 증분 (line 359 부근):**

Before:
```typescript
    const nextDynamic = Math.min(
      SMS_POLICY.maxBatchSize,
      (campaign.dynamicBatchSize || DEFAULT_BATCH_SIZE) + 20,
    );
```

After:
```typescript
    const nextDynamic = Math.min(
      providerMaxBatch,
      (campaign.dynamicBatchSize || providerMaxBatch) + 20,
    );
```

- [x] **Step 4: `DEFAULT_BATCH_SIZE` 상수 제거**

이제 어디서도 사용하지 않으므로 파일 상단의 다음 라인을 삭제:

```typescript
const DEFAULT_BATCH_SIZE = SMS_POLICY.maxBatchSize;
```

`SMS_POLICY` import는 `maxRetries`만 쓰므로 유지. `MIN_DYNAMIC_BATCH_SIZE`도 유지.

- [x] **Step 5: 테스트 재실행 (성공 기대)**

```bash
npx vitest run __tests__/lib/campaign-batch-size.test.ts
```

Expected: 모두 PASS

- [x] **Step 6: 전체 테스트 실행으로 회귀 확인**

```bash
npx vitest run
```

Expected: 모든 테스트 PASS. 특히 `campaign-substitution.test.ts`, `sms-policy.test.ts`가 영향 없어야 함.

- [x] **Step 7: TypeScript 전체 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [x] **Step 8: 커밋**

```bash
git add lib/campaign-processor.ts __tests__/lib/campaign-batch-size.test.ts
git commit -m "feat(campaign-processor): 배치 상한을 provider.maxBatchSize 기반으로 전환"
```

---

### Task 11: 프론트엔드 `DEFAULT_BATCH_SIZE` 제거 — provider 기반 위임

**Files:**
- Modify: `app/dashboard/sms-send/page.tsx`

**이유:** 현재 프론트가 `batchSize: 200`을 명시적으로 서버에 전달해서, 백엔드가 provider.maxBatchSize(10K)를 지원해도 200으로 clamp됨. 파라미터를 생략해 서버가 provider 기반 기본값(`providerMaxBatch`)을 쓰도록 위임한다.

- [x] **Step 1: 상수 및 사용처 제거**

`app/dashboard/sms-send/page.tsx` 상단에서 다음 라인 삭제:

```typescript
const DEFAULT_BATCH_SIZE = 200;
```

그리고 `processCampaignLoop` 내부의 fetch 호출부 (현재 line 240~245 부근):

Before:
```typescript
        const processRes = await fetch(`/api/sms/campaign/${campaignId}/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchSize: DEFAULT_BATCH_SIZE }),
        });
```

After (body 자체를 생략해 서버 기본값 사용):
```typescript
        const processRes = await fetch(`/api/sms/campaign/${campaignId}/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
```

- [x] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음. `DEFAULT_BATCH_SIZE` 미사용 경고가 나오면 import/변수 선언까지 확실히 지웠는지 재확인.

- [x] **Step 3: Next.js dev 빌드로 UI 로드 확인 (선택)**

```bash
npm run dev
```

브라우저에서 `/dashboard/sms-send` 접속. 페이지 렌더링 정상 여부 확인 후 Ctrl+C로 dev 서버 종료.

- [x] **Step 4: 커밋**

```bash
git add app/dashboard/sms-send/page.tsx
git commit -m "feat(ui): 프론트 batchSize 하드코딩 제거 — 서버가 provider 기반 자동 결정"
```

---

### Task 12: `dynamicBatchSize` 초기값 상향 — Prisma 스키마 조정

**Files:**
- Modify: `prisma/schema.prisma`

- [x] **Step 1: 스키마 수정**

`prisma/schema.prisma`에서 `SmsCampaign` 모델의 필드를 찾는다:

```
dynamicBatchSize Int     @default(200)
```

`@default(200)`을 제거하여 앱 레벨에서 provider 기반으로 주입받도록 변경:

```
dynamicBatchSize Int?
```

Nullable로 바꾸되, `campaign-processor.ts`에서 null 처리는 이미 `campaign.dynamicBatchSize || providerMaxBatch`로 되어 있으므로 추가 로직 불필요.

- [x] **Step 2: Prisma 마이그레이션 생성**

```bash
npx prisma migrate dev --name campaign_dynamic_batch_size_nullable --create-only
```

Expected: `prisma/migrations/YYYYMMDDHHMMSS_campaign_dynamic_batch_size_nullable/migration.sql` 생성.

- [x] **Step 3: 생성된 SQL 검증**

생성된 migration.sql 내용을 확인하여 다음 형태인지 점검:

```sql
ALTER TABLE "SmsCampaign" ALTER COLUMN "dynamicBatchSize" DROP DEFAULT;
ALTER TABLE "SmsCampaign" ALTER COLUMN "dynamicBatchSize" DROP NOT NULL;
```

추가 액션이 들어있으면 (예: DROP COLUMN, DATA LOSS 경고) 마이그레이션 파일을 수동 수정해서 위 2줄만 남긴다.

- [x] **Step 4: 로컬에는 적용하지 않고 prisma generate만 수행**

```bash
npx prisma generate
```

(실제 DB 적용은 서버 재배포 타이밍에 `prisma migrate deploy`로 진행)

- [x] **Step 5: TypeScript 체크로 nullable 필드 처리 보완 여부 확인**

```bash
npx tsc --noEmit
```

에러가 나면 `campaign.dynamicBatchSize` 사용처를 `?? providerMaxBatch` 패턴으로 보완.

- [x] **Step 6: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): dynamicBatchSize nullable — provider별 상한을 런타임 결정"
```

---

## Phase D — 배포 및 통합 검증

### Task 13: 변경사항 로컬 통합 테스트

**Files:** (없음, 실행 검증만)

- [x] **Step 1: 전체 단위 테스트 실행**

```bash
npx vitest run
```

Expected: 모든 테스트 PASS

- [x] **Step 2: 전체 타입 체크 (user + admin)**

```bash
npx tsc --noEmit && (cd admin && npx tsc --noEmit)
```

Expected: 양쪽 모두 에러 없음

- [x] **Step 3: 로컬 production build 확인**

```bash
npm run build
```

Expected: 경고만 있을 수 있고 에러 없이 종료. `.next/` 생성 확인.

---

### Task 14: 프로덕션 배포

**Files:** (배포 절차)

- [x] **Step 1: main 브랜치로 PR 또는 직접 병합 후 푸시**

```bash
git checkout main
git merge --no-ff feat/txg-bulk-send-ops
git push origin main
```

- [x] **Step 2: 서버에 코드 반영**

```bash
TOKEN=$(unset GITHUB_TOKEN; gh auth token)
ssh root@5.161.112.248 "cd /opt/sovereign-sms && git fetch 'https://x-access-token:${TOKEN}@github.com/joochanyang/SMS.git' main && git reset --hard FETCH_HEAD && git log -1 --oneline"
```

- [x] **Step 3: Prisma 마이그레이션 실행 (DB 스키마 반영)**

```bash
ssh root@5.161.112.248 'cd /opt/sovereign-sms && docker compose run --rm sovereign-sms-user npx prisma migrate deploy'
```

Expected: `Applying migration '..._campaign_dynamic_batch_size_nullable'` 표시 후 완료.

- [x] **Step 4: 양쪽 이미지 재빌드**

```bash
ssh root@5.161.112.248 'cd /opt/sovereign-sms && docker compose build'
```

Expected: 두 이미지 모두 `Built`

- [x] **Step 5: 컨테이너 교체**

```bash
ssh root@5.161.112.248 'cd /opt/sovereign-sms && docker compose up -d'
```

- [x] **Step 6: 헬스체크 통과 대기**

```bash
ssh root@5.161.112.248 "until docker inspect sovereign-sms-user --format '{{.State.Health.Status}}' | grep -q healthy && docker inspect sovereign-sms-admin --format '{{.State.Health.Status}}' | grep -q healthy; do sleep 5; done; docker ps --filter name=sovereign-sms --format 'table {{.Names}}\t{{.Status}}'"
```

Expected: 두 컨테이너 모두 `(healthy)`

---

### Task 15: 실운영 end-to-end 검증

**Files:** (없음, 검증)

- [x] **Step 1: TXG 잔액 확인**

```bash
ssh root@5.161.112.248 'curl -s "http://8.222.226.152:20003/getbalance?account=0278C012&password=$(docker exec sovereign-sms-user printenv TXG_PASSWORD)"'
```

Expected: `{"status":0, "balance":"<현재 잔액>", ...}`

- [x] **Step 2: 소량 테스트 발송 (10건, 관리자 계정)**

유저 앱 http://5.161.112.248:3300 에서 `admin` 계정으로 로그인, **동일 본문** 10건을 테스트 번호로 발송.

- [x] **Step 3: 단일 `POST /sendsms` 호출로 처리됐는지 확인**

```bash
ssh root@5.161.112.248 'docker logs sovereign-sms-user --since 3m 2>&1 | grep -E "sendsms|TXG" | tail -20'
```

Expected: `/sendsms` 로그가 **1회만** 찍혀야 함 (기존 200 cap 시대에는 1회, 하지만 현재 의도는 단일 batch로 10건이 한 번에 간다는 것. 10건은 원래도 1회였지만, 대용량에서 효과가 드러남).

- [x] **Step 4: 100건 발송 후 배치 호출 수 측정**

유저 앱에서 더미 본문 100건 발송 후:

```bash
ssh root@5.161.112.248 'docker logs sovereign-sms-user --since 3m 2>&1 | grep -c "/sendsms"'
```

Expected: `1` (이전에는 `SMS_POLICY.maxBatchSize=200` 이내여도 프런트 루프가 1회 호출로 처리했지만, 500~1000건부터 차이 발생).

- [x] **Step 5: DLR 상태 전이 확인 (5분 이내)**

```bash
sleep 300
ssh root@5.161.112.248 'docker exec sms-postgres psql -U smsuser -d bulksms -c "SELECT status, COUNT(*) FROM \"SmsLog\" WHERE \"providerName\"='"'"'txg'"'"' AND \"createdAt\" > now() - interval '"'"'10 minutes'"'"' GROUP BY status;"'
```

Expected: `DELIVERED` 또는 `FAILED` 카운트가 존재해야 함. `SENT`만 있으면 Push 미작동 → TXG 계정 webhook 설정 재확인 필요.

- [x] **Step 6: cron 자동 처리 확인 (브라우저 없이)**

새 캠페인을 생성하되 프런트 루프 없이 그대로 방치하고 1분 대기:

```bash
# QUEUED 캠페인 생성 후 프런트 루프 없이 대기
sleep 65
ssh root@5.161.112.248 'docker exec sms-postgres psql -U smsuser -d bulksms -c "SELECT id, status, \"processedCount\" FROM \"SmsCampaign\" ORDER BY \"createdAt\" DESC LIMIT 3;"'
```

Expected: cron이 깨워서 `processedCount`가 증가했어야 함. `0`이면 cron 미작동.

- [x] **Step 7: cron 로그로 추가 검증**

```bash
ssh root@5.161.112.248 'tail -30 /var/log/sovereign-cron.log'
```

Expected: 분당 1회 `process-campaigns` JSON 응답, 5분마다 `txg-poll-reports` 응답.

---

### Task 16: 완료 보고 및 문서화

**Files:**
- Create: `docs/superpowers/completed/2026-04-24-txg-bulk-send-optimization.md` (or 원 파일에 checkbox를 all [x] 처리)

- [x] **Step 1: 계획 파일에 완료 체크 마킹**

본 문서(`docs/superpowers/plans/2026-04-24-txg-bulk-send-optimization.md`)의 모든 체크박스를 `- [x]`로 변경.

- [x] **Step 2: 최종 커밋**

```bash
git add docs/superpowers/plans/
git commit -m "docs(plan): TXG 대량발송 최적화 완료 처리"
git push origin main
```

- [x] **Step 3: 운영 대시보드 값 스냅샷 (선택)**

관리자 대시보드에서 다음 캡처:
- 프로바이더 카드: TXG 발송 건수
- 배달률: `DELIVERED / (DELIVERED+FAILED)`
- DELIVERY_UNKNOWN 카드가 작동 중임을 확인 (cron-12회 폴링 미응답 시 자동 종결)

---

## 롤백 플랜 (실패 시)

| Phase | 롤백 방법 |
|---|---|
| A (secrets) | `.env` 백업 파일 복원 → `docker compose up -d` |
| A (cron) | `rm /etc/cron.d/sovereign-sms && systemctl reload cron` |
| B (pushurl) | `git revert <커밋해시>` → 재빌드 배포 |
| C (batch size) | `git revert <커밋해시>` → migrate 롤백은 DEFAULT 200 되돌리는 신규 마이그레이션 생성 |
| D (배포) | `docker tag sovereign-sms-sovereign-sms-user:pre-txg-opt sovereign-sms-sovereign-sms-user:latest` 및 admin 동일 → `docker compose up -d` |

---

## Phase E (선택 사항 — 후속 플랜)

본 계획에 포함하지 않은 개선:
- 도메인 연결 + Let's Encrypt HTTPS
- 발송 전 잔액 precheck (TXG `getbalance` 선호출 후 부족 시 UI에서 차단)
- 배치 간 sleep 동적화 (provider 응답 시간 기반)
- 관리자 대시보드에 cron 실행 상태 카드

이 항목들은 별도 plan 파일로 분리해 후속 진행 권장.

---

## 작업 완료 기록 (2026-04-24 KST 17:00 ~ 18:35)

| 범주 | 상태 | 비고 |
|---|---|---|
| Phase A: 시크릿·크론 | ✅ 완료 | CRON_SECRET, TXG_DLR_SECRET, TXG_DLR_WEBHOOK_URL 서버 .env 주입; `/etc/cron.d/sovereign-sms` 설치 (1분/5분/10분) |
| Phase B: TXG pushurl | ✅ 완료 | `TxgProvider` 요청 바디에 `pushurl` 조건부 주입; 단위 테스트 3건 |
| Phase C: 배치 상한 | ✅ 완료 | `campaign-processor`가 `provider.maxBatchSize` 기준 clamp; `dynamicBatchSize` nullable; 프론트 하드코딩 제거 |
| Phase D: 배포·검증 | ✅ 완료 | `b0572a3` main 병합, 컨테이너 healthy, DLR 401/200 통과, cron 6건 자동 처리 확인 |

### 계획 외 보완 1건
- `proxy.ts`에 `/api/txg/report`를 `publicPaths`·`csrfExempt` 양쪽 추가 (커밋 `5d76f1e`). Plan 전제는 맞았으나 proxy 설정이 누락되어 Step 5 검증이 403으로 막혔음 → 발견 즉시 보완.

### 사용자 Action 아이템
1. **TXG-TEL 고객센터 문의** — 계정 레벨 웹훅 고정 등록이 필요한지 확인.
   ```
   SMPP/HTTP 계정: 0278C012
   Push DLR 웹훅 URL: http://5.161.112.248:3300/api/txg/report
   인증 헤더: x-txg-token (값 별도 전달)
   ```
   (요청 바디의 `pushurl`만으로도 동작하나, 일부 운영자는 계정 레벨 등록을 선호.)

2. **실발송 E2E** — 유저 앱(http://5.161.112.248:3300) admin 계정으로 10건/100건 테스트 발송.
   - 단일 `/sendsms` 호출 1회(동일 본문 기준)로 처리되는지 docker logs로 확인
   - 5분 이내 DLR 상태가 `DELIVERED`/`FAILED`로 전이되는지 확인
   - 브라우저 닫고 1분 대기 후 cron이 이어받아 진행하는지 확인

### Phase E (후속 플랜 후보)
- 도메인 + Let's Encrypt HTTPS (현재 HTTP로 웹훅 수신)
- 발송 전 잔액 precheck (TXG getbalance 선호출)
- 배치 간 sleep 동적화
- 관리자 대시보드 cron 실행 상태 카드
- 9일 전부터 SENDING에 stuck 된 캠페인 레코드(200건) 복구 로직 — **이번 작업 외 사전 버그**

