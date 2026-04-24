# Deploy 유저 + 롤백 서버 초기 세팅

배포 서버(Hetzner 등)에서 **1회만** 실행. GitHub Actions가 root 대신 이 `deploy` 유저로 SSH 접속한다.

## 1. deploy 유저 생성 및 Docker 권한 부여

```bash
# 서버에 root로 접속 후
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# 프로젝트 디렉토리 소유권 이전
chown -R deploy:deploy /opt/sovereign-sms
```

## 2. SSH 키 등록

```bash
# 로컬에서 deploy 전용 키 생성 (이미 있다면 재사용)
ssh-keygen -t ed25519 -f ~/.ssh/sovereign_deploy -N ""

# 공개키를 서버 deploy 유저에 등록
ssh-copy-id -i ~/.ssh/sovereign_deploy.pub deploy@<서버IP>

# 서버에서 권한 정리
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

## 3. sudo 없이 배포할 수 있도록 추가 설정

```bash
# systemd 재시작이 필요한 경우에만 아래 설정
# /etc/sudoers.d/deploy
deploy ALL=(root) NOPASSWD: /bin/systemctl restart sovereign-sms
```

(현재 구성은 docker compose만 사용하므로 sudo 불필요)

## 4. GitHub Secrets 등록

Repository → Settings → Secrets and variables → Actions

| 이름 | 값 |
|------|-----|
| `DEPLOY_HOST` | 서버 IP |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | `cat ~/.ssh/sovereign_deploy` 내용 전체 |
| `DB_HOST` | `5.161.112.248` |
| `DB_PORT` | `5434` |
| `DB_NAME` | `bulksms` |
| `DB_USER` | `smsuser` |
| `DB_PASSWORD` | `.env`의 PGPASSWORD |
| `TELEGRAM_BOT_TOKEN` | (선택) 백업 실패 알림용 |
| `TELEGRAM_CHAT_ID` | (선택) 알림 수신 채팅 ID |

## 5. root SSH 비활성화 (권장)

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no

sudo systemctl restart sshd
```

## 6. 롤백 테스트

```bash
# 정상 배포가 1회 이상 실행된 이후
ssh deploy@<서버IP> /opt/sovereign-sms/scripts/rollback.sh

# 특정 커밋으로 롤백
ssh deploy@<서버IP> /opt/sovereign-sms/scripts/rollback.sh abc1234
```

## 7. 자동 롤백 동작

`.github/workflows/deploy.yml`은 다음 순서로 보호한다:

1. 배포 전: 현재 이미지를 `:rollback` 태그로 저장 + `PREV_SHA` 기록
2. `docker compose up -d --build` 실패 시: 코드 롤백(`git reset --hard PREV_SHA`) + 이전 이미지로 재기동
3. `/api/health` 60초 내 응답 없을 시: 동일하게 자동 롤백

수동 롤백은 `scripts/rollback.sh`를 사용한다.
