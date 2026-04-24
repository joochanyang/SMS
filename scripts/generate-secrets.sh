#!/usr/bin/env bash
# CRON_SECRET / TXG_DLR_SECRET 용 32-byte URL-safe 랜덤 생성기
set -euo pipefail
NAME="${1:-SECRET}"
openssl rand -base64 32 | tr -d '/+=' | cut -c1-32 | awk -v n="$NAME" '{print n"="$0}'
