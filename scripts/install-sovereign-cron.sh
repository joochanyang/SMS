#!/usr/bin/env bash
# /etc/cron.d/sovereign-sms 에 캠페인/USDT 만료 cron을 설치한다.
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
* * * * * root curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" $BASE_URL/api/cron/process-campaigns -m 50 >> /var/log/sovereign-cron.log 2>&1; echo >> /var/log/sovereign-cron.log

# USDT 입금 만료 정리 — 매 5분
*/5 * * * * root curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" $BASE_URL/api/cron/expire-deposits -m 30 >> /var/log/sovereign-cron.log 2>&1; echo >> /var/log/sovereign-cron.log
EOF

chmod 644 "$FILE"
touch /var/log/sovereign-cron.log
chmod 640 /var/log/sovereign-cron.log
systemctl reload cron || service cron reload || true
echo "설치 완료: $FILE"
