#!/usr/bin/env bash

set -euo pipefail

DOMAIN="${DOMAIN:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
REPO_URL="${REPO_URL:-https://github.com/Xiffly/undp.git}"
APP_DIR="${APP_DIR:-/opt/undp-crisis-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
NGINX_RUNTIME_DIR="${NGINX_RUNTIME_DIR:-nginx/runtime}"
BOOTSTRAP_RENDER_PATH="${BOOTSTRAP_RENDER_PATH:-$NGINX_RUNTIME_DIR/bootstrap.conf}"
PRODUCTION_RENDER_PATH="${PRODUCTION_RENDER_PATH:-$NGINX_RUNTIME_DIR/production.conf}"
ACTIVE_NGINX_CONFIG_PATH="${ACTIVE_NGINX_CONFIG_PATH:-$NGINX_RUNTIME_DIR/active.conf}"
SEO_X_ROBOTS_TAG="${SEO_X_ROBOTS_TAG:-noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()  { echo -e "${GREEN}[ok]${NC} $1"; }
warn(){ echo -e "${YELLOW}[warn]${NC} $1"; }
err() { echo -e "${RED}[error]${NC} $1"; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || err "Please run as root: sudo bash ./deploy.sh"
}

load_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    OS="$ID"
  else
    err "Cannot detect operating system"
  fi
}

install_packages() {
  log "Installing Docker and deployment dependencies if needed..."
  if ! command -v docker >/dev/null 2>&1; then
    case "$OS" in
      ubuntu|debian)
        apt-get update -qq
        apt-get install -y -q curl git ufw gettext-base openssl
        curl -fsSL https://get.docker.com | sh
        ;;
      centos|rhel|rocky|almalinux)
        yum install -y curl git firewalld gettext openssl
        curl -fsSL https://get.docker.com | sh
        ;;
      *)
        err "Unsupported OS: $OS. Install Docker manually and re-run."
        ;;
    esac
  else
    case "$OS" in
      ubuntu|debian) apt-get install -y -q gettext-base >/dev/null 2>&1 || true ;;
      centos|rhel|rocky|almalinux) yum install -y gettext >/dev/null 2>&1 || true ;;
    esac
  fi

  if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
    log "Installing Docker Compose plugin..."
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi

  systemctl enable docker --now
  ok "Docker and Compose are ready"
}

configure_firewall() {
  log "Configuring firewall for SSH, HTTP, and HTTPS..."
  case "$OS" in
    ubuntu|debian)
      ufw --force enable
      ufw allow ssh
      ufw allow 80/tcp
      ufw allow 443/tcp
      ;;
    centos|rhel|rocky|almalinux)
      systemctl enable firewalld --now
      firewall-cmd --permanent --add-service=ssh
      firewall-cmd --permanent --add-service=http
      firewall-cmd --permanent --add-service=https
      firewall-cmd --reload
      ;;
  esac
  ok "Firewall configured"
}

clone_or_update_repo() {
  log "Preparing application directory..."
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" pull --ff-only origin main
    ok "Repository updated"
  else
    git clone "$REPO_URL" "$APP_DIR"
    ok "Repository cloned to $APP_DIR"
  fi
  cd "$APP_DIR"
}

prompt_for_env_setup() {
  if [[ ! -f "$APP_DIR/.env" ]]; then
    log "Creating .env from .env.example..."
    cp .env.example .env
  fi

  if ! grep -q '^JWT_SECRET=' .env; then
    printf 'JWT_SECRET=%s\n' "$(openssl rand -base64 64 | tr -d '\n')" >> .env
  fi

  if grep -q '^JWT_SECRET=change-this-in-production-use-a-64-char-random-string-generated-with-openssl$' .env; then
    sed -i "s|^JWT_SECRET=.*$|JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')|" .env
  fi

  warn "Review and complete $APP_DIR/.env before deployment continues."
  warn "Required values: DOMAIN, APP_BASE_URL, POSTGRES_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, CONTRIBUTOR_KEY_SALT, CONFIRM_IP_SALT, JWT_SECRET."
  read -r -p "Press ENTER once .env is ready for production..."
}

load_env() {
  # shellcheck disable=SC1091
  source "$APP_DIR/scripts/load-env.sh"
  load_env_file "$APP_DIR/.env"

  DOMAIN="${DOMAIN:-}"
  LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-${ADMIN_EMAIL:-}}"

  [[ -n "$DOMAIN" ]] || err "DOMAIN must be set in .env"
  [[ -n "${APP_BASE_URL:-}" ]] || err "APP_BASE_URL must be set in .env"
  [[ "${APP_BASE_URL}" == "https://${DOMAIN}" ]] || warn "APP_BASE_URL is ${APP_BASE_URL}. Recommended production value is https://${DOMAIN}"
  [[ -n "${POSTGRES_PASSWORD:-}" ]] || err "POSTGRES_PASSWORD must be set in .env"
  [[ -n "${ADMIN_EMAIL:-}" ]] || err "ADMIN_EMAIL must be set in .env"
  [[ -n "${ADMIN_PASSWORD:-}" ]] || err "ADMIN_PASSWORD must be set in .env"
  [[ -n "${ADMIN_NAME:-}" ]] || err "ADMIN_NAME must be set in .env"
  [[ -n "${CONTRIBUTOR_KEY_SALT:-}" ]] || err "CONTRIBUTOR_KEY_SALT must be set in .env"
  [[ -n "${CONFIRM_IP_SALT:-}" ]] || err "CONFIRM_IP_SALT must be set in .env"
  [[ -n "$LETSENCRYPT_EMAIL" ]] || err "Set LETSENCRYPT_EMAIL or ADMIN_EMAIL in .env"
}

render_nginx_template() {
  local template_path="$1"
  local output_path="$2"
  local www_domain="www.${DOMAIN}"

  mkdir -p "$(dirname "$output_path")"
  DOMAIN="$DOMAIN" WWW_DOMAIN="$www_domain" SEO_X_ROBOTS_TAG="$SEO_X_ROBOTS_TAG" envsubst '${DOMAIN} ${WWW_DOMAIN} ${SEO_X_ROBOTS_TAG}' < "$template_path" \
    | sed "s|__DOMAIN__|$DOMAIN|g; s|__WWW_DOMAIN__|$www_domain|g" > "$output_path"
}

activate_nginx_config() {
  local source_path="$1"
  cp "$source_path" "$ACTIVE_NGINX_CONFIG_PATH"
}

compose_with_active_config() {
  NGINX_CONFIG_PATH="./${ACTIVE_NGINX_CONFIG_PATH}" docker compose -f "$COMPOSE_FILE" "$@"
}

bootstrap_tls() {
  log "Rendering bootstrap Nginx config for HTTP-01 challenge..."
  render_nginx_template "nginx/bootstrap.conf" "$BOOTSTRAP_RENDER_PATH"
  activate_nginx_config "$BOOTSTRAP_RENDER_PATH"

  compose_with_active_config up -d --build postgres api frontend
  ok "Bootstrap frontend is serving HTTP challenge responses"

  log "Requesting Let's Encrypt certificate for ${DOMAIN}..."
  compose_with_active_config run --rm --entrypoint certbot certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$LETSENCRYPT_EMAIL" \
    --agree-tos \
    -d "$DOMAIN" \
    -d "www.$DOMAIN"
  ok "TLS certificate issued"
}

switch_to_tls_frontend() {
  log "Rendering production Nginx config..."
  render_nginx_template "nginx/production.conf" "$PRODUCTION_RENDER_PATH"
  activate_nginx_config "$PRODUCTION_RENDER_PATH"

  compose_with_active_config up -d --build --force-recreate frontend certbot
  ok "Frontend switched to TLS mode"
}

start_stack() {
  log "Starting production stack..."
  compose_with_active_config up -d --build postgres api frontend certbot
  ok "Production stack started"
}

install_systemd_unit() {
  log "Installing systemd service..."
  cat > /etc/systemd/system/undp-crisis.service <<EOF
[Unit]
Description=UNDP Crisis Assessment Platform
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
Environment=NGINX_CONFIG_PATH=./$ACTIVE_NGINX_CONFIG_PATH
ExecStart=/usr/bin/docker compose -f $COMPOSE_FILE up -d
ExecStop=/usr/bin/docker compose -f $COMPOSE_FILE down
TimeoutStartSec=180

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable undp-crisis
  ok "Systemd service enabled"
}

install_backup_cron() {
  log "Installing nightly PostgreSQL backup job..."
  mkdir -p /opt/backups/undp-crisis
  printf '0 2 * * * root APP_DIR=%q bash %q >> /var/log/undp-crisis-backup.log 2>&1\n' \
    "$APP_DIR" "$APP_DIR/scripts/backup.sh" > /etc/cron.d/undp-crisis-backup
  ok "Nightly backup scheduled at 02:00"
}

health_check() {
  log "Waiting for API health..."
  if curl --retry 12 --retry-delay 5 --retry-all-errors --connect-timeout 5 --max-time 10 -fsS "https://${DOMAIN}/api/health" >/dev/null; then
    ok "API health check passed"
  else
    err "API health check failed. Inspect: docker compose -f $COMPOSE_FILE logs api frontend"
  fi
}

print_summary() {
  cat <<EOF

Deployment completed.

App URL:        https://${DOMAIN}
Admin URL:      https://${DOMAIN}/admin
API health:     https://${DOMAIN}/api/health
App directory:  ${APP_DIR}
Database data:  Docker volume 'postgres_data'
Uploads data:   Docker volume 'crisis_uploads'

Next operations:
1. Sign in once with the seeded bootstrap admin credentials from .env.
2. Create managed admin accounts in the app.
3. Rotate the bootstrap ADMIN_PASSWORD and any temporary secrets.
4. Verify nightly backups are creating crisis_<timestamp>.sql.gz files.
EOF
}

require_root
load_os
install_packages
configure_firewall
clone_or_update_repo
prompt_for_env_setup
load_env
bootstrap_tls
switch_to_tls_frontend
start_stack
install_systemd_unit
install_backup_cron
health_check
print_summary
