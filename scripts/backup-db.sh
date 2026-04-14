#!/bin/bash
# SovereignSMS PostgreSQL 일일 백업 스크립트
# Cron 설정: 0 3 * * * /path/to/scripts/backup-db.sh
#
# 환경변수 (또는 .env에서 로드):
#   DB_HOST, DB_PORT, DB_NAME, DB_USER, PGPASSWORD
#   BACKUP_DIR (기본: /var/backups/sovereign-sms)
#   BACKUP_RETENTION_DAYS (기본: 7)

set -euo pipefail

# .env 파일에서 환경변수 로드 (존재하면)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# 기본값 설정
DB_HOST="${DB_HOST:-5.161.112.248}"
DB_PORT="${DB_PORT:-5434}"
DB_NAME="${DB_NAME:-bulksms}"
DB_USER="${DB_USER:-smsuser}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sovereign-sms}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

# 백업 디렉토리 생성
mkdir -p "$BACKUP_DIR"

# 타임스탬프
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "[$(date)] 백업 시작: ${DB_NAME}@${DB_HOST}:${DB_PORT}"

# pg_dump 실행 (gzip 압축)
if pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --compress=6 \
  --verbose \
  -f "$BACKUP_FILE" 2>&1; then

  FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date)] 백업 완료: ${BACKUP_FILE} (${FILE_SIZE})"
else
  echo "[$(date)] 백업 실패!" >&2
  exit 1
fi

# 오래된 백업 정리
DELETED=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +"$BACKUP_RETENTION_DAYS" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] ${DELETED}개 오래된 백업 삭제 (${BACKUP_RETENTION_DAYS}일 초과)"
fi

# 현재 백업 목록
echo "[$(date)] 현재 백업 목록:"
ls -lh "$BACKUP_DIR"/${DB_NAME}_*.sql.gz 2>/dev/null || echo "  (없음)"

echo "[$(date)] 백업 완료"
