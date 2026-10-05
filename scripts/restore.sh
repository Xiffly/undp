#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${APP_DIR:-/opt/undp-crisis-platform}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/undp-crisis}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
TIMESTAMP="${1:?Usage: RESTORE_CONFIRM=yes restore.sh backup_timestamp}"
[[ "$TIMESTAMP" =~ ^[0-9]{8}_[0-9]{6}_[0-9]+$ ]] || { echo 'Invalid backup timestamp' >&2; exit 1; }
[[ "${RESTORE_CONFIRM:-}" == yes ]] || { echo 'Restore replaces the database and uploads. Set RESTORE_CONFIRM=yes.' >&2; exit 1; }
trap 'echo "{\"event\":\"restore.failed\",\"timestamp\":\"$TIMESTAMP\",\"line\":$LINENO}" >&2' ERR
[[ -f "$BACKUP_DIR/complete_${TIMESTAMP}.manifest" ]] || { echo 'Completed backup manifest missing' >&2; exit 1; }
DB_FILE="$BACKUP_DIR/crisis_${TIMESTAMP}.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
gzip -t "$DB_FILE"
tar -tzf "$UPLOADS_FILE" | awk '/^\// || /(^|\/)\.\.(\/|$)/ { bad=1 } END { exit bad }'
compose() { docker compose --env-file "${ENV_FILE:-$APP_DIR/.env}" -f "$COMPOSE_FILE" "$@"; }
POSTGRES_CONTAINER=$(compose ps -q postgres)
[[ -n "$POSTGRES_CONTAINER" ]] || { echo 'PostgreSQL container missing' >&2; exit 1; }
compose stop frontend api
gzip -dc "$DB_FILE" | docker exec -i "$POSTGRES_CONTAINER" sh -lc 'psql -v ON_ERROR_STOP=1 --single-transaction -U "${POSTGRES_USER:-crisis_user}" -d "${POSTGRES_DB:-crisis_db}"'
# The API remains stopped until both artifacts are restored successfully.
compose run --rm --no-deps -T --user root --entrypoint sh api -c 'find /repo/uploads -mindepth 1 -delete && tar -xzf - -C /repo/uploads && chown -R node:node /repo/uploads' < "$UPLOADS_FILE"
compose up -d --wait api frontend
echo "{\"event\":\"restore.completed\",\"timestamp\":\"$TIMESTAMP\"}"
