#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export COMPOSE_PROJECT_NAME="crisis-smoke-${CI_JOB_ID:-$$}"
export ENV_FILE="$ROOT/.tmp-production-smoke/test.env"
export NGINX_CONFIG_PATH="$ROOT/.tmp-production-smoke/nginx.conf"
export APP_DIR="$ROOT"
export BACKUP_DIR="$ROOT/.tmp-production-smoke/$COMPOSE_PROJECT_NAME/backups"
export COMPOSE_FILE="$ROOT/.tmp-production-smoke/compose.yml"
mkdir -p "$BACKUP_DIR" "$ROOT/.tmp-production-smoke/certs/live/localhost"
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
cleanup() {
  local status=$?
  compose logs --no-color > "$ROOT/.tmp-production-smoke/stack.log" 2>&1 || :
  compose down -v --remove-orphans || :
  exit "$status"
}
trap cleanup EXIT
cat > "$ENV_FILE" <<'EOF'
DOMAIN=localhost
APP_BASE_URL=https://localhost
POSTGRES_PASSWORD=isolated-smoke-database-only
JWT_SECRET=isolated-smoke-jwt-secret-at-least-32-characters
ADMIN_EMAIL=admin@smoke.test
ADMIN_PASSWORD=Isolated-Smoke-Password-2026
ADMIN_NAME=Smoke Admin
CONTRIBUTOR_KEY_SALT=isolated-smoke-contributor-salt-at-least-32-characters
CONFIRM_IP_SALT=isolated-smoke-confirm-salt-at-least-32-characters
AI_ENABLED=false
AUTH_RATE_LIMIT_MAX=200
RATE_LIMIT_MAX=200
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost' \
  -keyout .tmp-production-smoke/certs/live/localhost/privkey.pem \
  -out .tmp-production-smoke/certs/live/localhost/fullchain.pem 2>/dev/null
sed -e 's/__DOMAIN__/localhost/g' -e 's/__WWW_DOMAIN__/localhost/g' -e 's/${SEO_X_ROBOTS_TAG}/noindex/g' -e 's/rate=30r\/m/rate=3000r\/m/g' \
  nginx/production.conf > "$NGINX_CONFIG_PATH"
# Use the production definitions and fresh project-scoped volumes; no host data is mounted.
cat > "$COMPOSE_FILE" <<EOF
services:
  postgres:
    extends:
      file: $ROOT/docker-compose.prod.yml
      service: postgres
  api:
    extends:
      file: $ROOT/docker-compose.prod.yml
      service: api
  frontend:
    extends:
      file: $ROOT/docker-compose.prod.yml
      service: frontend
    volumes:
      - $ROOT/.tmp-production-smoke/certs:/etc/letsencrypt:ro
  whatsapp:
    build:
      context: $ROOT/apps/whatsapp
    environment:
      WHATSAPP_USE_STUB: 'true'
      API_BASE_URL: http://api:3001
      WHATSAPP_SERVICE_TOKEN: smoke-whatsapp-token
    networks: [internal]
volumes:
  postgres_data:
  crisis_data:
  crisis_uploads:
  certbot_www:
  certbot_certs:
networks:
  internal:
EOF
compose config --quiet
if [[ "${PRODUCTION_SMOKE_VALIDATE_ONLY:-}" == true ]]; then
  trap - EXIT
  echo 'Production smoke Compose configuration is valid'
  exit 0
fi
compose up -d --build --wait postgres api frontend whatsapp
compose exec -T whatsapp node -e "fetch('http://localhost:3010/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"
curl --insecure --fail --retry 10 --retry-all-errors --retry-delay 2 https://localhost/api/health
export E2E_BASE_URL=https://localhost
export E2E_EXTERNAL_SERVER=true
export ADMIN_EMAIL=admin@smoke.test ADMIN_PASSWORD=Isolated-Smoke-Password-2026
(cd apps/frontend && npm run test:e2e)
# Verify migration history and a reversible migration on the isolated DB.
compose stop api
compose run --rm --no-deps api node dist/scripts/migrate.js down
compose run --rm --no-deps api node dist/scripts/migrate.js up
compose up -d --wait api
postgres=$(compose ps -q postgres)
api=$(compose ps -q api)
reports_before=$(docker exec "$postgres" psql -At -U crisis_user -d crisis_db -c 'SELECT count(*) FROM reports')
uploads_before=$(docker exec "$api" sh -c 'find /repo/uploads -type f -exec sha256sum {} \; | sort')
[[ "$reports_before" -gt 0 && -n "$uploads_before" ]]
bash scripts/backup.sh
stamp=$(cat "$BACKUP_DIR"/complete_*.manifest)
docker exec "$postgres" psql -U crisis_user -d crisis_db -c "INSERT INTO crisis_events (id, name) VALUES ('restore_probe', 'After backup');"
docker exec "$api" sh -c 'echo after-backup > /repo/uploads/restore-probe.txt'
RESTORE_CONFIRM=yes bash scripts/restore.sh "$stamp"
[[ $(docker exec "$postgres" psql -At -U crisis_user -d crisis_db -c "SELECT count(*) FROM crisis_events WHERE id = 'restore_probe'") == 0 ]]
docker exec "$(compose ps -q api)" test ! -f /repo/uploads/restore-probe.txt
[[ $(docker exec "$postgres" psql -At -U crisis_user -d crisis_db -c 'SELECT count(*) FROM reports') == "$reports_before" ]]
uploads_after=$(docker exec "$(compose ps -q api)" sh -c 'find /repo/uploads -type f -exec sha256sum {} \; | sort')
[[ "$uploads_before" == "$uploads_after" ]]
curl --insecure --fail https://localhost/api/health
echo 'Production Docker smoke and backup/restore passed'
