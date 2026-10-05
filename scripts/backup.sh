#!/usr/bin/env bash
set -euo pipefail
umask 077
APP_DIR="${APP_DIR:-/opt/undp-crisis-platform}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/undp-crisis}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)_$$
trap 'echo "{\"event\":\"backup.failed\",\"timestamp\":\"$TIMESTAMP\",\"line\":$LINENO}" >&2' ERR
set -E
mkdir -p "$BACKUP_DIR"
API_CONTAINER=$(docker compose --env-file "${ENV_FILE:-$APP_DIR/.env}" -f "$COMPOSE_FILE" ps -q api)
POSTGRES_CONTAINER=$(docker compose --env-file "${ENV_FILE:-$APP_DIR/.env}" -f "$COMPOSE_FILE" ps -q postgres)
[ -z "$API_CONTAINER" ] && { echo "ERROR: API container not running"; exit 1; }
[ -z "$POSTGRES_CONTAINER" ] && { echo "ERROR: PostgreSQL container not running"; exit 1; }

DB_DUMP_FILE="$BACKUP_DIR/crisis_${TIMESTAMP}.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
docker exec "$POSTGRES_CONTAINER" sh -lc 'pg_dump --clean --if-exists -U "${POSTGRES_USER:-crisis_user}" -d "${POSTGRES_DB:-crisis_db}"' | gzip > "$DB_DUMP_FILE.partial"

docker exec "$API_CONTAINER" tar -czf - -C /repo/uploads . > "$UPLOADS_FILE.partial"
gzip -t "$DB_DUMP_FILE.partial"
tar -tzf "$UPLOADS_FILE.partial" >/dev/null
mv "$DB_DUMP_FILE.partial" "$DB_DUMP_FILE"
mv "$UPLOADS_FILE.partial" "$UPLOADS_FILE"
# A completed pair is discoverable only after both artifacts pass validation.
printf '%s\n' "$TIMESTAMP" > "$BACKUP_DIR/complete_${TIMESTAMP}.manifest"

find "$BACKUP_DIR" -name "crisis_*.sql.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "complete_*.manifest" -mtime +30 -delete
echo "{\"event\":\"backup.completed\",\"timestamp\":\"$TIMESTAMP\"}"
