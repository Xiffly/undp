#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/undp-crisis-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ACTIVE_NGINX_CONFIG_PATH="${ACTIVE_NGINX_CONFIG_PATH:-nginx/runtime/active.conf}"
BOOTSTRAP_RENDER_PATH="${BOOTSTRAP_RENDER_PATH:-nginx/runtime/bootstrap.conf}"
PRODUCTION_RENDER_PATH="${PRODUCTION_RENDER_PATH:-nginx/runtime/production.conf}"

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $APP_DIR/.env"
  exit 1
fi

# shellcheck disable=SC1091
source "$APP_DIR/scripts/load-env.sh"
load_env_file .env

DOMAIN="${1:-${DOMAIN:-}}"
LETSENCRYPT_EMAIL="${2:-${LETSENCRYPT_EMAIL:-${ADMIN_EMAIL:-}}}"
WWW_DOMAIN="www.${DOMAIN}"

if [[ -z "$DOMAIN" || -z "$LETSENCRYPT_EMAIL" ]]; then
  echo "Usage: ./scripts/ssl-setup.sh [domain] [email]"
  echo "Or set DOMAIN plus LETSENCRYPT_EMAIL/ADMIN_EMAIL in .env"
  exit 1
fi

mkdir -p nginx/runtime
sed "s|__DOMAIN__|$DOMAIN|g; s|__WWW_DOMAIN__|$WWW_DOMAIN|g" nginx/bootstrap.conf > "$BOOTSTRAP_RENDER_PATH"
cp "$BOOTSTRAP_RENDER_PATH" "$ACTIVE_NGINX_CONFIG_PATH"

echo "Starting bootstrap frontend for ACME challenge..."
NGINX_CONFIG_PATH="./$ACTIVE_NGINX_CONFIG_PATH" docker compose -f "$COMPOSE_FILE" up -d frontend

echo "Requesting SSL for $DOMAIN (email: $LETSENCRYPT_EMAIL)..."
NGINX_CONFIG_PATH="./$ACTIVE_NGINX_CONFIG_PATH" docker compose -f "$COMPOSE_FILE" run --rm --entrypoint certbot certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos \
  -d "$DOMAIN" \
  -d "$WWW_DOMAIN"

SEO_X_ROBOTS_TAG="${SEO_X_ROBOTS_TAG:-noindex, nofollow}" envsubst '${SEO_X_ROBOTS_TAG}' < nginx/production.conf | sed "s|__DOMAIN__|$DOMAIN|g; s|__WWW_DOMAIN__|$WWW_DOMAIN|g" > "$PRODUCTION_RENDER_PATH"
cp "$PRODUCTION_RENDER_PATH" "$ACTIVE_NGINX_CONFIG_PATH"

echo "SSL obtained. Switching frontend to TLS config..."
NGINX_CONFIG_PATH="./$ACTIVE_NGINX_CONFIG_PATH" docker compose -f "$COMPOSE_FILE" up -d --force-recreate frontend certbot
echo "Done. Visit https://$DOMAIN"
