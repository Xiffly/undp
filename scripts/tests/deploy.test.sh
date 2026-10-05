#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
source scripts/load-env.sh
cat > "$work/env" <<'ENV'
# spaced and quoted dotenv values
ADMIN_NAME=Bootstrap Admin
TEST_QUOTED="two words"
TEST_LITERAL=$(touch should-not-exist)
TEST_EQUALS=abc=def
ENV
load_env_file "$work/env"
[[ "$ADMIN_NAME" == 'Bootstrap Admin' && "$TEST_QUOTED" == 'two words' ]]
[[ "$TEST_LITERAL" == '$(touch should-not-exist)' && "$TEST_EQUALS" == 'abc=def' ]]
[[ ! -e should-not-exist ]]
# Import the real deployment functions without executing the deployment entry point.
source <(awk '/^require_root$/{exit} {print}' deploy.sh)
DOMAIN=deployment.test
APP_DIR="$ROOT"
BOOTSTRAP_RENDER_PATH="$work/bootstrap.conf"
PRODUCTION_RENDER_PATH="$work/production.conf"
ACTIVE_NGINX_CONFIG_PATH="$work/active.conf"
compose_with_active_config() { printf '%s\n' "$*" >> "$work/compose.calls"; }
bootstrap_tls
switch_to_tls_frontend
[[ $(cat "$work/compose.calls") == *'run --rm --entrypoint certbot certbot certonly'* ]]
[[ $(cat "$work/compose.calls") == *'up -d --build --force-recreate frontend certbot'* ]]
[[ $(cat "$ACTIVE_NGINX_CONFIG_PATH") == *'server_name deployment.test'* ]]
[[ $(cat "$ACTIVE_NGINX_CONFIG_PATH") != *'${SEO_X_ROBOTS_TAG}'* ]]
curl() { printf '%s\n' "$*" > "$work/curl.calls"; }
health_check
[[ $(cat "$work/curl.calls") == *'https://deployment.test/api/health'* ]]
curl() { return 22; }
if (health_check); then echo 'Deployment accepted failed health check' >&2; exit 1; fi
echo 'Deployment TLS, environment and health regression checks passed'
