# Crisis Platform V1.0.0

Community crisis intake and review platform with three applications:

- `apps/frontend`: public reporting site and admin dashboard
- `apps/api`: Express API backed by PostgreSQL
- `apps/whatsapp`: WhatsApp webhook and conversational intake service

## What This Repo Runs

- Public users can submit geolocated damage reports with optional photos.
- Public users can browse the map and confirm existing reports.
- Admin users can review reports, manage users, manage contributors, edit form definitions, manage footprints, export data, and run AI-assisted workflows.
- The WhatsApp service can guide users through conversational intake and submit completed reports to the API.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind, Leaflet, i18next
- API: Node.js, Express, TypeScript, PostgreSQL
- WhatsApp service: Node.js, Express, TypeScript
- Deployment: Docker Compose, Nginx, Certbot

## Repository Docs

- [Backend and frontend overview](docs/backend-frontend-overview.md)

## Prerequisites

For local development or local release validation:

- Node.js 22.12+ (Docker builds use Node 22)
- npm
- Docker Desktop or Docker Engine with Compose

For single-server production deployment:

- Linux server with Docker support
- DNS for your domain pointed at the server
- Ports `80` and `443` open

## Quick Start

For a less experienced user, use this order:

1. Copy and fill `.env`
2. Install npm packages
3. Build the three apps once
4. Start with Docker Compose or run each app locally

Use the section for your operating system:

- [Windows local setup](#windows-local-setup)
- [linux-and-macos-local-setup](#linux-and-macos-local-setup)

## Shared Local Environment

Copy `.env.example` to `.env` in the repo root and set at least:

```env
POSTGRES_PASSWORD=change-me
JWT_SECRET=dev-secret-change-me
ADMIN_EMAIL=bootstrap-admin@local
ADMIN_PASSWORD=change-me-to-a-strong-password
ADMIN_NAME=Bootstrap Admin
CONTRIBUTOR_KEY_SALT=change-me
CONFIRM_IP_SALT=change-me
WHATSAPP_SERVICE_TOKEN=local-whatsapp-integration-token
WHATSAPP_APP_SECRET=
```

Recommended local values:

- keep `VITE_API_URL=` empty
- keep WhatsApp in stub mode for localhost
- use strong values even for local admin and JWT secrets if multiple people use the machine

## Windows Local Setup

### Install npm packages

```powershell
cd e:\crisis-platform\apps\frontend
npm ci

cd e:\crisis-platform\apps\api
npm ci

cd e:\crisis-platform\apps\whatsapp
npm ci
```

### Build all three apps

```powershell
cd e:\crisis-platform\apps\frontend
npm run build

cd e:\crisis-platform\apps\api
npm run build

cd e:\crisis-platform\apps\whatsapp
npm run build
```

### Start with Docker Compose

This is the easiest path for most users.

```powershell
cd e:\crisis-platform
docker compose up -d --build
```

Local services:

- Frontend: `http://localhost:8080`
- API: `http://localhost:3003`
- API health: `http://localhost:3003/api/health`
- WhatsApp service: `http://localhost:3010`
- WhatsApp health: `http://localhost:3010/health`

The local Compose stack includes:

- `frontend`
- `api`
- `postgres`
- `whatsapp`

Local WhatsApp uses stub transport by default through `WHATSAPP_USE_STUB=true`, so no Meta token is required for localhost testing.

To stop:

```powershell
cd e:\crisis-platform
docker compose down
```

To remove containers and volumes:

```powershell
cd e:\crisis-platform
docker compose down -v
```

### Start locally without Docker

#### Start PostgreSQL only

```powershell
cd e:\crisis-platform
docker compose up -d postgres
```

#### Start the API

```powershell
$env:PORT="3001"
$env:JWT_SECRET="dev-secret-change-me"
$env:ADMIN_EMAIL="bootstrap-admin@local"
$env:ADMIN_PASSWORD="change-me-to-a-strong-password"
$env:ADMIN_NAME="Bootstrap Admin"
$env:STRICT_INTEGRATIONS="false"
$env:DATABASE_URL="postgresql://crisis_user:change-me@localhost:5432/crisis_db"
$env:MEDIA_BACKEND="local"
$env:CONTRIBUTOR_KEY_SALT="change-me"
$env:CONFIRM_IP_SALT="change-me"
$env:WHATSAPP_SERVICE_TOKEN="local-whatsapp-integration-token"
$env:ALLOW_INSECURE_PASSWORD_RESET_LOG="true"

cd e:\crisis-platform\apps\api
npm run dev
```

#### Start the frontend

```powershell
cd e:\crisis-platform\apps\frontend
npm run dev
```

Frontend URL:

- `http://localhost:5173`

#### Start the WhatsApp service

```powershell
$env:WHATSAPP_PORT="3010"
$env:API_BASE_URL="http://localhost:3001"
$env:WHATSAPP_SERVICE_TOKEN="local-whatsapp-integration-token"
$env:WHATSAPP_APP_SECRET=""
$env:WHATSAPP_VERIFY_TOKEN="dev-verify-token"
$env:WHATSAPP_USE_STUB="true"
$env:WHATSAPP_TOKEN="dev-token"
$env:WHATSAPP_PHONE_ID="dev-phone-id"

cd e:\crisis-platform\apps\whatsapp
npm run dev
```

## Linux and macOS Local Setup

### Install npm packages

```bash
cd /path/to/crisis-platform/apps/frontend
npm ci

cd /path/to/crisis-platform/apps/api
npm ci

cd /path/to/crisis-platform/apps/whatsapp
npm ci
```

### Build all three apps

```bash
cd /path/to/crisis-platform/apps/frontend
npm run build

cd /path/to/crisis-platform/apps/api
npm run build

cd /path/to/crisis-platform/apps/whatsapp
npm run build
```

### Start with Docker Compose

```bash
cd /path/to/crisis-platform
docker compose up -d --build
```

Local services:

- Frontend: `http://localhost:8080`
- API: `http://localhost:3003`
- API health: `http://localhost:3003/api/health`
- WhatsApp service: `http://localhost:3010`
- WhatsApp health: `http://localhost:3010/health`

To stop:

```bash
cd /path/to/crisis-platform
docker compose down
```

To remove containers and volumes:

```bash
cd /path/to/crisis-platform
docker compose down -v
```

### Start locally without Docker

#### Start PostgreSQL only

```bash
cd /path/to/crisis-platform
docker compose up -d postgres
```

#### Start the API

```bash
export PORT=3001
export JWT_SECRET=dev-secret-change-me
export ADMIN_EMAIL=bootstrap-admin@local
export ADMIN_PASSWORD=change-me-to-a-strong-password
export ADMIN_NAME="Bootstrap Admin"
export STRICT_INTEGRATIONS=false
export DATABASE_URL=postgresql://crisis_user:change-me@localhost:5432/crisis_db
export MEDIA_BACKEND=local
export CONTRIBUTOR_KEY_SALT=change-me
export CONFIRM_IP_SALT=change-me
export WHATSAPP_SERVICE_TOKEN=local-whatsapp-integration-token
export ALLOW_INSECURE_PASSWORD_RESET_LOG=true

cd /path/to/crisis-platform/apps/api
npm run dev
```

#### Start the frontend

```bash
cd /path/to/crisis-platform/apps/frontend
npm run dev
```

Frontend URL:

- `http://localhost:5173`

#### Start the WhatsApp service

```bash
export WHATSAPP_PORT=3010
export API_BASE_URL=http://localhost:3001
export WHATSAPP_SERVICE_TOKEN=local-whatsapp-integration-token
export WHATSAPP_APP_SECRET=
export WHATSAPP_VERIFY_TOKEN=dev-verify-token
export WHATSAPP_USE_STUB=true
export WHATSAPP_TOKEN=dev-token
export WHATSAPP_PHONE_ID=dev-phone-id

cd /path/to/crisis-platform/apps/whatsapp
npm run dev
```

## Testing

Every push and pull request runs lint for all three apps, regular and scoped strict
typechecks, frontend tests, API tests with PostgreSQL, WhatsApp tests, production
dependency audits, and all production builds.
The production smoke job builds the Docker images and exercises HTTPS, login,
signup, report submission with an image, moderation, password reset, migrations,
and backup/restore using isolated Docker volumes.
Publishing a GitHub release runs `release.yml`, which requires successful checks
on its exact commit and publishes versioned API, frontend and WhatsApp images to
GitHub Container Registry. Server deployment still uses `deploy.sh` and the
server's own environment configuration.

Run that smoke test on a Linux host with Docker Compose, Node 22, OpenSSL, and
Playwright Chromium installed:

```bash
cd apps/frontend
npm ci
npx playwright install --with-deps chromium
cd ../..
bash scripts/production-smoke.sh
```

It uses ports 80 and 443 and deletes its own project volumes on exit. It does not
mount existing database or uploads directories. DB integration tests require an
isolated `DATABASE_URL`; set `RUN_DB_INTEGRATION=true` to run migration and password
reset/session tests locally. CI always enables these tests.

API:

```bash
cd apps/api
npm test
```

Frontend:

```bash
cd apps/frontend
npm test
npm run build
```

WhatsApp service:

```bash
cd apps/whatsapp
npm test
npm run build
```

## WhatsApp Notes

- The backend and WhatsApp service communicate through `WHATSAPP_SERVICE_TOKEN`.
- Real Meta webhook POSTs must be signed with `WHATSAPP_APP_SECRET`; local stub mode bypasses that check.
- Local Docker runs WhatsApp in stub mode, so bot replies are logged instead of sent through Meta.
- Password reset links are no longer logged by default; local-only fallback logging requires `ALLOW_INSECURE_PASSWORD_RESET_LOG=true`.
- The WhatsApp intake flow now supports:
  - GPS location capture
  - text-first location context with `location_capture_mode`
  - canonical `infra_category` mapping
  - `crisis_type`
  - `pressing_needs`
  - phone verification, phone replacement, and verification removal flows

## Production Deployment

The current production deployment path is intentionally:

- `frontend`
- `api`
- `postgres`
- `certbot`

WhatsApp is kept in the codebase, but it is not part of `docker-compose.prod.yml` for this release.

### Production environment

Copy `.env.example` to `.env` on the server and set all required values, especially:

- `DOMAIN`
- `APP_BASE_URL`
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`
- `CONTRIBUTOR_KEY_SALT`
- `CONFIRM_IP_SALT`

Recommended production pattern:

```env
DOMAIN=example.org
APP_BASE_URL=https://example.org
```

SEO indexing is blocked by default for the current dev-style deployment. When you are ready to allow public search indexing later, also set:

```env
VITE_SEO_ALLOW_INDEXING=true
SEO_X_ROBOTS_TAG=index, follow
```

### Production deploy

Run:

```bash
sudo bash ./deploy.sh
```

`deploy.sh` will:

- install Docker/Compose if needed
- clone or update the repo
- prompt for `.env` completion
- render bootstrap Nginx config
- start `postgres + api + frontend`
- obtain the TLS certificate with Certbot webroot
- switch Nginx to the TLS production config
- enable the systemd service
- install the nightly PostgreSQL backup cron

### Production runtime behavior

- frontend requests stay same-origin through Nginx with `VITE_API_URL=`
- the API trusts one proxy hop for real client IP rate limiting
- public and admin map views keep all three tile styles
- bootstrap admin access is for first login only; create managed admin users after bring-up
- admin and staff sessions last 30 minutes and use HttpOnly, Secure, SameSite=Strict cookies; production does not return operational JWTs
- sessions rotate on login and are revoked on logout, password reset, expiry, or account deactivation
- public JWTs remain compatible with account-owned offline submissions; public credentials require a separate future migration if moving those flows to cookies
- Nginx serves a CSP without `unsafe-eval` or inline scripts; API readiness checks include PostgreSQL connectivity
- production refuses startup with missing DB configuration, weak JWT/salt values, a non-HTTPS app URL, or insecure AI TLS

### Database migrations

Schema changes live in `apps/api/src/migrations`, with a frozen baseline that
supports existing installations. Startup applies unapplied versions in a
transaction under a PostgreSQL advisory lock. Checksums reject changed migration
files. `schema_migrations` records the current versions;
`schema_migration_history` retains application and rollback events.

```bash
cd apps/api
npm run db:status
npm run db:migrate
# Stop the API and workers before rolling back a schema change.
npm run db:rollback
```

Each future migration needs an explicit up/down operation. The baseline cannot
be rolled back by dropping legacy tables: restore a verified pre-migration backup
instead. Rolling back the session migration signs out all operational users.

### Logging and error monitoring

API requests return `X-Request-ID`. JSON logs include timestamp, level, event,
request ID and operational metadata. Errors from the API, DB pool, startup,
background workers and AI providers are logged centrally. Set `SENTRY_DSN` to
forward error events to Sentry; request bodies, cookies, headers, user information,
AI payloads and query data collection are disabled. Logs remain available when no
monitoring account is configured.

Configure alerts for failed startup/readiness, worker failures, elevated API 5xx
responses, and missing nightly `backup.completed` events. Password reset requires
working `MAIL_FROM` and `RESEND_API_KEY` values; provider delivery must be checked
on the deployed domain.

## Backups and Storage

- PostgreSQL data lives in Docker volume `postgres_data`
- uploaded media lives in Docker volume `crisis_uploads` in production
- nightly backup script: `scripts/backup.sh`
- backup output formats: `crisis_<timestamp>.sql.gz`, `uploads_<timestamp>.tar.gz`, and `complete_<timestamp>.manifest`
- uploads are archived from `/repo/uploads`; failures return a nonzero status and completion is marked only after both archives validate
- backups use private file permissions and retain completed artifacts for 30 days

Restore on a maintenance window after copying a matched, completed backup pair to
the backup directory:

```bash
APP_DIR=/opt/undp-crisis-platform RESTORE_CONFIRM=yes \
  bash scripts/restore.sh 20261005_020000_12345
```

Restore replaces the database and uploads. It stops the API and frontend, applies
the database dump with error checking in a transaction, restores uploads, then
waits for services to recover. On failure it leaves the application stopped for
inspection. These are live backups: stop report writes when an exact DB/media
snapshot is required. S3 objects require a separate provider backup/versioning
policy; this script covers local uploads.

Media backends:

- `MEDIA_BACKEND=local`
- `MEDIA_BACKEND=s3` with `S3_*` variables for object storage

## Operational Notes

- The runtime database is PostgreSQL.
- The frontend no longer falls back to demo data when the API fails.
- The bootstrap admin account is env-driven and should be rotated after first use.
- Translation and AI settings are optional for local bring-up; report submission still works without them.
