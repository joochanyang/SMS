#!/bin/bash
# SovereignSMS 수동 롤백 스크립트
# 사용법:
#   ./rollback.sh              → 직전 rollback 태그 이미지로 복구
#   ./rollback.sh <commit-sha> → 특정 커밋으로 복구 후 rebuild

set -euo pipefail

cd /opt/sovereign-sms

TARGET_SHA="${1:-}"

if [ -n "$TARGET_SHA" ]; then
  echo "[$(date)] 특정 커밋으로 롤백: $TARGET_SHA"
  git fetch origin
  git reset --hard "$TARGET_SHA"
  docker compose up -d --build
else
  echo "[$(date)] rollback 태그 이미지로 즉시 복구"
  if ! docker image inspect sovereign-sms-user:rollback >/dev/null 2>&1; then
    echo "오류: sovereign-sms-user:rollback 이미지가 없습니다." >&2
    echo "특정 커밋 SHA를 인자로 전달하세요: $0 <commit-sha>" >&2
    exit 1
  fi
  docker tag sovereign-sms-user:rollback sovereign-sms-user:latest
  docker tag sovereign-sms-admin:rollback sovereign-sms-admin:latest || true
  docker compose up -d
fi

# 헬스체크
echo "[$(date)] 헬스체크..."
for i in $(seq 1 12); do
  sleep 5
  if curl -fsS http://localhost:3300/api/health >/dev/null 2>&1; then
    echo "[$(date)] 롤백 성공"
    exit 0
  fi
done

echo "[$(date)] 경고: 헬스체크 실패. 수동 점검 필요" >&2
exit 1
