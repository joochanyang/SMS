# SMPP main 머지 작업계획서

**작성일**: 2026-04-27 13:50 KST
**브랜치**: `claude/kind-hertz-6b2fde` → `main`
**프로덕션**: `5.161.112.248:/opt/sovereign-sms` (자동 배포)
**상태**: SMPP 코드/인프라 검증 완료, TXG err=267 미해결 (별도 트랙)

---

## 0. 새 세션 시작 시 컨텍스트 복원

```
프로젝트:  /Users/mr.joo/Desktop/sms문자사이트
worktree:  /Users/mr.joo/Desktop/sms문자사이트/.claude/worktrees/kind-hertz-6b2fde
브랜치:    claude/kind-hertz-6b2fde (main과 동일 SHA, 변경사항 모두 unstaged)
main SHA:  8dbfcb9 (2026-04-25 기준)
remote:    https://github.com/joochanyang/SMS.git (2026-05-28 이전, 옛 저장소: joocy75-hash/infosms)
DB:        Hetzner PostgreSQL 16 (5.161.112.248:5434/bulksms, smsuser/smspass_prod_2026)
TXG SMPP:  8.222.226.152:20002 — system_id=0278C012, password는 worktree .env 참조
TXG HTTP:  http://8.222.226.152:20003 (잔액 전용, 별도 password)
```

**worktree에 있는 자격증명/환경변수**: `.claude/worktrees/kind-hertz-6b2fde/.env`
**메인 워크트리의 .env**: `/Users/mr.joo/Desktop/sms문자사이트/.env` (옛 키 잔존, 삭제 대상)

---

## 1. 배경 및 결정 근거

기존 HTTP 기반 TXG (`/sendsms` + `/getreport` + push DLR webhook)에서 2026-04-24 *"silent route + push DLR 영구 미작동"* 사고 발생. 이를 근본 해결하기 위해 SMPP 3.4 transceiver로 전면 전환.

| 기존 HTTP 문제 | SMPP 해결 방식 |
|---|---|
| Push DLR webhook이 절대 안 옴 | 동일 TCP에서 `deliver_sm` 즉시 in-band 수신 |
| 폴링 cron이 24h 윈도우 미스 | 폴링 자체 폐기 |
| URL 인코딩(%2C) 버그 가능성 | 바이너리 PDU |
| `submit_sm` 응답 없는 채 retry → 이중과금 | `SUBMIT_AMBIGUOUS`로 종결 후 **재시도 금지** |

### 1.1 본 세션 검증 결과 (2026-04-27 13:35~13:37)

| 검증 항목 | 결과 |
|---|---|
| TCP 연결 (`8.222.226.152:20002`) | ✅ 92ms |
| `bind_transceiver` (0278C012/L.zmm5gf9) | ✅ command_status=0x00, 91ms |
| `submit_sm` 3건 → `message_id` 발급 | ✅ `1776815760278000036/37/38` |
| `deliver_sm` DLR 즉시 수신 + 파싱 | ✅ TLV/body 파싱 모두 정상 |
| SmsLog 종결 + 캠페인 카운터 갱신 | ✅ COMPLETED 자동 전환 |
| graceful shutdown (SIGTERM) | ✅ unbind 정상, 90ms |

테스트 캠페인 ID: `cmogpfs2k0000xhakyk4szugo` (3건 모두 FAILED·UNDELIV로 종결됨, DB 잔존)

### 1.2 미해결 이슈 (별도 트랙)

테스트 발송 3건 모두 `UNDELIV err=267`. SMPP 시스템 자체는 완벽 동작했고 **TXG → 한국 통신사 라우팅 단계 거부**. 본 세션에서 영문 문의 메일 초안 작성 완료(저장 안 함). TXG 답변 수령 후 별도 PR로 destination_addr 형식 등 조정 가능성. 본 plan은 **이 이슈와 독립적으로 SMPP 코드를 머지**하는 데 집중한다.

---

## 2. 변경 범위 (worktree 기준)

| 분류 | 파일 | 변경 |
|---|---|---|
| **신규** | `services/smpp-worker/index.ts` | 메인 entry + graceful shutdown |
| 신규 | `services/smpp-worker/connection.ts` | bind/enquire_link/재접속/윈도잉/timeout |
| 신규 | `services/smpp-worker/poller.ts` | PENDING claim (FOR UPDATE SKIP LOCKED) → SMPP 송신 |
| 신규 | `services/smpp-worker/segmenter.ts` | UCS-2/GSM-7 + UDH concatenation |
| 신규 | `services/smpp-worker/dlr.ts` | deliver_sm 파싱 + DB 적용 (멱등성) |
| 신규 | `services/smpp-worker/config.ts` | 환경변수 fail-fast 검증 |
| 신규 | `services/smpp-worker/smpp-types.d.ts` | smpp 패키지 타입 보강 |
| 신규 | `services/smpp-worker/Dockerfile` | 워커 컨테이너 |
| 수정 | `package.json`, `package-lock.json` | `smpp ^0.5.1` + `tsx ^4.21.0` |
| 수정 | `docker-compose.yml` | `sovereign-sms-smpp-worker` 서비스 (replicas: 1) |
| 수정 | `lib/sms-providers/txg.ts` | sendBatch fail-closed throw, getBalance만 HTTP 유지 |
| 수정 | `lib/campaign-processor.ts` | TXG 활성 시 즉시 return (워커 위임) |
| 수정 | `proxy.ts` | `/api/txg/report` publicPaths/csrfExempt 제거 |
| 수정 | `admin/app/api/sms-providers/send-test/route.ts` | TXG는 send-test 차단 (안내 메시지) |
| 수정 | `.env.example` | TXG_SMPP_* + TXG_HTTP_* 환경변수 풀세트 |
| 수정 | `CLAUDE.md`, `PROGRESS.md`, `scripts/cron-setup.md` | 문서 갱신 |
| **삭제** | `app/api/txg/report/route.ts` | HTTP push DLR 라우트 폐기 |
| 삭제 | `app/api/cron/txg-poll-reports/route.ts` | HTTP 폴링 라우트 폐기 |
| 삭제 | `__tests__/lib/txg-provider.test.ts` | HTTP 발송 가정 테스트 폐기 |
| ⚠️커밋 제외 | `scripts/seed-smpp-test.ts` | 본 세션에서 만든 로컬 테스트 시드 |
| ⚠️커밋 제외 | `admin/tsconfig.tsbuildinfo` | 빌드 산출물 |
| ⚠️커밋 제외 | `test-txg-format.ts`, `test-txg-report.ts`, `test-txg.ts` | 루트 임시 스크립트 (이전 세션 잔존) |

---

## 3. Phase 1 — 머지 준비 (코드 정리)

### 3.1 커밋 분할 전략 (4개 커밋)

리뷰 가독성과 향후 bisect 편의를 위해 단일 커밋이 아닌 4개로 분할.

```
[1/4] feat(smpp-worker): TXG SMPP 3.4 transceiver 워커 신규 구축
       - services/smpp-worker/* 8개 파일
       - package.json: smpp + tsx 의존성
       - .env.example: TXG_SMPP_* 환경변수
       - docker-compose.yml: 워커 서비스 (replicas: 1)
       - services/smpp-worker/Dockerfile

[2/4] refactor(txg): HTTP 발송/DLR 경로 폐기 — SMPP 워커로 위임
       - lib/sms-providers/txg.ts: sendBatch fail-closed throw, getBalance만 유지
       - lib/campaign-processor.ts: TXG 활성 시 즉시 return
       - admin/app/api/sms-providers/send-test/route.ts: TXG send-test 차단
       - app/api/txg/report/route.ts 삭제
       - app/api/cron/txg-poll-reports/route.ts 삭제
       - __tests__/lib/txg-provider.test.ts 삭제

[3/4] fix(proxy): TXG HTTP DLR 라우트 publicPaths/csrfExempt 정리

[4/4] docs: SMPP 전환 반영
       - CLAUDE.md (SMS 발송 라인 설명 갱신)
       - PROGRESS.md (2026-04-27 SMPP 전환 섹션 추가)
       - scripts/cron-setup.md (HTTP 폴링 cron 등록 가이드 제거)
```

### 3.2 머지 전 로컬 검증 체크리스트

```bash
cd /Users/mr.joo/Desktop/sms문자사이트/.claude/worktrees/kind-hertz-6b2fde

# Prisma client 생성
npx prisma generate

# 타입체크 (logger.test.ts 3건 무관 에러는 기존 이슈로 무시)
npx tsc --noEmit

# 유저 앱 빌드
npx next build

# 관리자 앱 빌드
cd admin && npx next build && cd ..

# 워커 컨테이너 빌드 (선택)
docker compose build sovereign-sms-smpp-worker

# 워커 단독 기동 → bind 0x00 재확인 (선택)
npx tsx services/smpp-worker/index.ts
# Ctrl+C로 graceful shutdown 후 종료
```

체크리스트:
- [ ] `npx tsc --noEmit` 통과 (logger.test.ts 3건은 무관)
- [ ] `npx next build` 양쪽 앱 모두 성공
- [ ] worker 컨테이너 단독 기동 → "bind_transceiver 성공" 로그 확인
- [ ] `git status`로 unstaged 파일 17개 + untracked `services/` 확인

---

## 4. Phase 2 — PR 생성

### 4.1 PR 메타데이터

```yaml
title: feat(txg): HTTP → SMPP 3.4 transceiver 전면 전환
base: main
head: claude/kind-hertz-6b2fde
labels: txg, smpp, breaking-change, infra
```

### 4.2 PR 본문 템플릿

```markdown
## 요약
- 2026-04-24 silent route + DLR 미작동 사고 후속으로 TXG를 HTTP에서 SMPP 3.4 transceiver로 전면 전환
- `services/smpp-worker/` 별도 컨테이너에서 PDU 송수신 + DLR 인밴드 처리
- HTTP `/sendsms`·`/getreport`·push DLR webhook·폴링 cron 모두 폐기
- **비용 안전**: submit_sm 응답 미수신 시 SUBMIT_AMBIGUOUS로 종결, 재시도 금지

## ⚠️ 머지 후 운영 작업 (반드시 순서대로)
1. 프로덕션 `.env`에 SMPP 환경변수 주입 (Phase 5.2)
2. `active_sms_provider`를 `infobip`으로 임시 전환 (Phase 5.1) — KR 라우트 미확정 상태
3. main 푸시 → 자동 배포
4. 워커 컨테이너 bind 로그 확인 (Phase 5.5)
5. TXG 측 err=267 답변·KR 라우트 활성 확인 후 active_sms_provider를 `txg`로 복귀 (Phase 6)

## 검증
- 로컬 (2026-04-27 13:35): bind/submit/DLR/shutdown 4단 모두 정상
- 미해결: TXG 측 KR 라우팅 거부 (err=267) — 별도 티켓
```

### 4.3 셀프 리뷰 포인트

- [ ] `services/smpp-worker/connection.ts` ambiguous 처리: timeout/disconnect 양쪽 모두 재시도 안 하는지
- [ ] `services/smpp-worker/poller.ts` `FOR UPDATE SKIP LOCKED` 사용 (다중 인스턴스 race 그물)
- [ ] `services/smpp-worker/dlr.ts` 종결 상태(DELIVERED/FAILED) 재전이 차단 (멱등성)
- [ ] `lib/campaign-processor.ts` TXG 활성 가드가 provider 로드 직후에 위치
- [ ] `lib/sms-providers/txg.ts.sendBatch` fail-closed throw — `grep -r "TxgProvider" .`로 호출 경로 차단 확인

---

## 5. Phase 3 — 머지 및 배포

### 5.1 머지 직전 안전 게이트 (가장 중요)

**TXG 한국 라우트가 미확인이므로, 머지·배포가 끝나는 시점에 `active_sms_provider`를 절대 `txg`로 두지 않는다.**

머지 직전에 프로덕션 DB에서 다음 SQL 실행:
```sql
UPDATE "SystemSetting"
SET value = '{"provider":"infobip"}', "updatedAt" = NOW()
WHERE key = 'active_sms_provider';
```

이렇게 하면 워커는 `isTxgActive() === false`로 폴링만 하고 발송 안 함. 사용자 발송은 Infobip 경로로 진행.

⚠️ **현재 (2026-04-27 13:50 기준) 프로덕션의 active_sms_provider = `txg`**. 머지 직전 반드시 위 SQL 실행 필요.

### 5.2 프로덕션 `.env` 주입 (SSH 작업)

```bash
ssh deploy@5.161.112.248
cd /opt/sovereign-sms

# 백업
cp .env .env.bak-$(date +%s)

# 옛 키 3줄 삭제: TXG_BASE_URL, TXG_ACCOUNT, TXG_PASSWORD
# (편집기로 직접 수정)

# 신규 키 추가
cat >> .env <<'EOF'

# TXG SMPP (2026-04-27 전환)
TXG_SMPP_HOST=8.222.226.152
TXG_SMPP_PORT=20002
TXG_SMPP_SYSTEM_ID=0278C012
TXG_SMPP_PASSWORD=L.zmm5gf9
TXG_SMPP_WINDOW=50
TXG_SMPP_SUBMIT_TIMEOUT_MS=60000
TXG_SMPP_ENQUIRE_LINK_MS=30000
TXG_SMPP_POLL_INTERVAL_MS=2000
TXG_SMPP_BATCH_SIZE=200

TXG_HTTP_BALANCE_URL=http://8.222.226.152:20003
TXG_HTTP_ACCOUNT=0278C012
TXG_HTTP_PASSWORD=BCNgGSPcuP9JgEP2xrL7Z9Gu
EOF

# 로컬 worktree .env에서도 동일한 변경이 적용되어 있음 — 참고용
```

### 5.3 머지 시퀀스

```bash
# 1) worktree에서 임시 파일 git index 제외 확인
cd /Users/mr.joo/Desktop/sms문자사이트/.claude/worktrees/kind-hertz-6b2fde
git status

# 2) 4개 커밋 분할
git add services/smpp-worker package.json package-lock.json .env.example docker-compose.yml
git commit -m "feat(smpp-worker): TXG SMPP 3.4 transceiver 워커 신규 구축"

git add lib/sms-providers/txg.ts lib/campaign-processor.ts \
        admin/app/api/sms-providers/send-test/route.ts
git rm app/api/txg/report/route.ts \
       app/api/cron/txg-poll-reports/route.ts \
       __tests__/lib/txg-provider.test.ts
git commit -m "refactor(txg): HTTP 발송/DLR 경로 폐기 — SMPP 워커로 위임"

git add proxy.ts
git commit -m "fix(proxy): TXG HTTP DLR 라우트 publicPaths/csrfExempt 정리"

git add CLAUDE.md PROGRESS.md scripts/cron-setup.md
git commit -m "docs: SMPP 전환 반영"

# 3) 푸시
git push origin claude/kind-hertz-6b2fde

# 4) PR 생성
gh pr create --base main --head claude/kind-hertz-6b2fde \
  --title "feat(txg): HTTP → SMPP 3.4 transceiver 전면 전환" \
  --body-file <(cat <<'PR'
[Phase 4.2 PR 본문 템플릿 내용]
PR
)

# 5) 셀프 리뷰 후 머지 (squash 비권장 — 4커밋 보존)
gh pr merge --merge
```

### 5.4 자동 배포 동작 (`.github/workflows/deploy.yml`)

main push 즉시 GitHub Actions가:
1. SSH로 `/opt/sovereign-sms`에 `git fetch + reset --hard origin/main`
2. `docker compose up -d --build` — user/admin/**worker 신규 컨테이너 빌드+기동**
3. 60초 헬스체크: `curl http://localhost:3300/api/health` (user 컨테이너)
4. 실패 시 자동 롤백 (이전 SHA로 reset + rollback 이미지 복원)

⚠️ **헬스체크는 user만 보고 worker는 안 본다.** 워커가 bind 실패해도 deploy.yml은 성공으로 인식. 따라서 머지 후 즉시 워커 로그 수동 확인 필수.

### 5.5 머지 후 즉시 검증 (5분 내)

```bash
ssh deploy@5.161.112.248
cd /opt/sovereign-sms

# 1) 컨테이너 3개 모두 Up 확인
docker compose ps
# expect: sovereign-sms-user/admin/smpp-worker 모두 Up

# 2) 워커 로그 — bind 0x00 + idle 폴링
docker compose logs --tail=50 sovereign-sms-smpp-worker
# expect: "bind_transceiver 성공"
#         (active_sms_provider=infobip이므로 폴링은 idle)

# 3) user 헬스체크
curl -s http://localhost:3300/api/health | jq

# 4) 옛 HTTP DLR 라우트 404 확인 (외부에서 호출되던 게 있었다면 정리 신호)
curl -i https://<도메인>/api/txg/report
# expect: 404
```

추가 정리:
- TXG 패널에서 webhook URL(`PUT https://.../api/txg/report`) 등록 해제

---

## 6. Phase 4 — TXG 활성화 (별도 게이트, TXG 답변 후)

### 6.1 전제 조건
- TXG 측 err=267 의미 회신 + KR 라우트 활성화 확인서 수령
- destination_addr 형식·발신번호 요구사항 확정
- (필요 시) `services/smpp-worker/poller.ts`에 TON/NPI 또는 형식 변환 패치 → **별도 PR**

### 6.2 활성화 시퀀스
```bash
# 1) 카나리아 1건 — 관리자 본인 캠페인으로 1번호 발송 (€0.0055)
#    Admin 패널 → 캠페인 → 1건

# 2) DELIVERED 확인
ssh deploy@5.161.112.248
docker compose exec -T sovereign-sms-user sh -c \
  "psql ${DATABASE_URL} -c \"SELECT status, \\\"providerError\\\" FROM \\\"SmsLog\\\" WHERE \\\"campaignId\\\"='<cuid>';\""

# 3) 성공 시 active_sms_provider 전환
psql ... -c "
  UPDATE \"SystemSetting\"
  SET value = '{\"provider\":\"txg\"}', \"updatedAt\" = NOW()
  WHERE key = 'active_sms_provider';
"

# 4) 첫 1시간 모니터링 — 전달률 ≥90% 유지 확인
```

---

## 7. 롤백 전략

### 7.1 코드 롤백 (자동)
deploy.yml이 헬스체크 실패 시 자동 롤백. 수동 트리거가 필요한 경우:
```bash
ssh deploy@5.161.112.248
cd /opt/sovereign-sms
git log --oneline -10  # 머지 전 SHA 확인 (예상: 8dbfcb9)
git reset --hard <PREV_SHA>
docker compose up -d --build
```

### 7.2 운영 롤백 (코드는 유지, 발송만 백업 라인으로) — **권장**
```sql
UPDATE "SystemSetting"
SET value = '{"provider":"infobip"}'
WHERE key = 'active_sms_provider';
```
즉시 워커 idle, Infobip로 발송. 코드 롤백보다 우선 시도.

### 7.3 응급 정지
```sql
UPDATE "SystemSetting"
SET value = '{"level":"GLOBAL_STOP"}'
WHERE key = 'kill_switch';
```
모든 발송 즉시 차단.

---

## 8. 위험 요소 및 완화

| # | 위험 | 가능성 | 영향 | 완화 |
|---|---|---|---|---|
| 1 | 프로덕션 `.env`에 SMPP 키 미주입한 채 머지 | 중 | 워커 fail-fast → restart 루프 | Phase 5.2 SSH 작업을 **머지 전**에 완료 |
| 2 | 머지 후 active_sms_provider=txg인 채로 발송 → 전부 UNDELIV | 높음 | 사용자 캠페인 실패 + 비용 발생 | Phase 5.1 안전 게이트로 infobip 전환 선행 |
| 3 | 다중 인스턴스 SMPP bind → TXG 계정 정지 | 낮 | 메인 발송 라인 정지 | docker-compose `replicas: 1` 강제, 머지 전 로컬 워커 종료 확인 |
| 4 | 옛 HTTP DLR 콜백이 외부에서 호출되어 404 누적 | 낮 | TXG 패널 webhook 잔여물 | 머지 후 TXG 패널에서 webhook URL 제거 |
| 5 | 워커 컨테이너만 죽었는데 user 헬스체크는 통과 → 발송 정지 모르고 지나감 | 중 | TXG 발송 정지를 한참 후 인지 | 머지 후 5분 내 워커 로그 수동 확인 + 후속 모니터링 알람 작업 (별도 티켓) |
| 6 | smpp 라이브러리(0.5.1) Node 22 호환 이슈 | 낮 | 워커 크래시 | 로컬 검증 완료. 프로덕션 첫 기동 후 30분 안정성 확인 |
| 7 | logger.test.ts 3건 컴파일 에러로 CI 실패 | 낮 | 머지 차단 | 기존 이슈, SMPP와 무관. 별도 PR로 분리 수정 검토 |
| 8 | 로컬 worktree의 `.env`가 실수로 커밋됨 | 낮 | 자격증명 유출 | `.gitignore` 등록 확인 + 머지 전 `git status`로 확인 |

---

## 9. 작업 순서 요약 (한눈에 보는 체크리스트)

**머지 전 (로컬)**
- [ ] 1. `cd /Users/mr.joo/Desktop/sms문자사이트/.claude/worktrees/kind-hertz-6b2fde`
- [ ] 2. `npx prisma generate && npx tsc --noEmit && npx next build`
- [ ] 3. `cd admin && npx next build && cd ..`
- [ ] 4. (선택) 워커 단독 기동 → bind 재확인 → SIGTERM 종료
- [ ] 5. `git status` — 임시 파일·`.env` 제외 확인

**머지 전 (프로덕션 사전 작업)**
- [ ] 6. **SSH로 프로덕션 `.env`에 SMPP 키 주입** (Phase 5.2)
- [ ] 7. **`active_sms_provider` SQL로 `infobip` 전환** (Phase 5.1)
- [ ] 8. TXG 패널 webhook URL 등록 해제 메모 (머지 후 즉시 처리)

**머지 실행**
- [ ] 9. 4개 커밋 분할 (Phase 5.3)
- [ ] 10. `git push origin claude/kind-hertz-6b2fde`
- [ ] 11. `gh pr create`
- [ ] 12. 셀프 리뷰 통과 후 `gh pr merge --merge`

**머지 직후 (5분 내)**
- [ ] 13. SSH로 `docker compose ps` — 3개 컨테이너 Up
- [ ] 14. `docker compose logs sovereign-sms-smpp-worker` — bind 0x00
- [ ] 15. user/admin 헬스체크 200 OK
- [ ] 16. 옛 HTTP DLR 라우트 404 확인
- [ ] 17. TXG 패널 webhook URL 제거

**TXG 답변 후 (별도 세션)**
- [ ] 18. err=267 의미 + KR 라우트 활성 확인서 수령
- [ ] 19. 필요 시 destination_addr 형식 패치 PR
- [ ] 20. 카나리아 1건 발송 → DELIVERED 확인
- [ ] 21. `active_sms_provider`를 `txg`로 복귀
- [ ] 22. 첫 1시간 전달률 모니터링

---

## 10. 참고 자료

- **로컬 검증 로그**: `/tmp/smpp-test/worker.log` (현 세션 한정)
- **테스트 캠페인**: `cmogpfs2k0000xhakyk4szugo` (DB에 잔존, 정리 선택사항)
- **테스트 메시지 ID**: `1776815760278000036/37/38` (SmsLog.messageId 컬럼)
- **테스트 시드 스크립트**: `services/smpp-worker/`와 무관, `scripts/seed-smpp-test.ts` (커밋 제외)
- **자동 배포 워크플로**: `.github/workflows/deploy.yml`
- **메모리 노트**:
  - `txg-smpp-architecture.md` — 아키텍처 결정
  - `txg-incident-2026-04-24.md` — 전환 동기 (기존 사고)
  - `txg-business-relationship.md` — TXG 가격 메리트, Infobip 백업
  - `txg-currency-and-pricing.md` — €0.0055/segment, EUR 단위
- **TXG 측 미해결 티켓**: err=267 의미 + KR 라우트 활성 (영문 문의 메일 초안 본 세션 제공, 별도 저장)
