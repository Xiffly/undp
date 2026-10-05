# Backend and Frontend Overview

This project is a three-part system:

- `apps/frontend`: React/Vite client for the public site and admin dashboard
- `apps/api`: Express/PostgreSQL backend
- `apps/whatsapp`: separate WhatsApp webhook service that submits into the API

## Runtime Topology

For normal web usage, the browser talks to the API through the same origin:

- frontend is served by Nginx
- API is exposed behind Nginx at `/api`
- uploaded media is exposed at `/uploads`
- the frontend uses a relative API base by default, so production traffic stays same-origin

For local Docker:

- frontend is available on `http://localhost:8080`
- API is available on `http://localhost:3003` with Docker Compose (`3001` when running Node directly)
- WhatsApp service is available on `http://localhost:3010`

## How Frontend Calls the Backend

The frontend API client lives in [apps/frontend/src/api/client.ts](../apps/frontend/src/api/client.ts).

Key behavior:

- `VITE_API_URL` defaults to empty, so requests go to the current origin
- the frontend keeps separate auth stores for:
  - admin/staff sessions
  - public-user sessions
- API usage is explicit at the request layer:
  - admin-intended methods use an admin-authenticated client
  - public-user methods use a public-authenticated client
  - anonymous/public-read methods use a client without auth
- `401` responses are handled by auth context:
  - admin-authenticated requests clear only the admin session and redirect to `/admin/login` only when already inside the admin area
  - public-authenticated requests clear only the public-user session

This means the frontend can preserve concurrent admin and public-user sessions without deciding credentials from the current page path.

## API Entry Point

The API entry point is [apps/api/src/index.ts](../apps/api/src/index.ts).

At startup it:

- loads environment variables
- enables async-route wrapping
- configures CORS for local dev and the configured production domain
- enables rate limiting for auth and report submission
- serves `/uploads` with restrictive static headers
- applies versioned PostgreSQL migrations and seeds runtime defaults
- runs a versioning backfill
- starts background AI workers

Important runtime assumptions:

- PostgreSQL is the active database backend
- `STRICT_INTEGRATIONS=true` requires `DATABASE_URL`
- in production the API trusts one reverse-proxy hop for real client IP handling

## Main Backend Domains

### 1. Reports

Primary router: [apps/api/src/routes/reports.ts](../apps/api/src/routes/reports.ts)

This domain handles:

- public report submission with multipart photo upload
- public report listing and single-report fetch
- report confirmation by community users
- admin report updates, moderation, deletion, and location repair
- report version history for location-based change tracking
- translation attachment and localized dynamic fields
- contributor linking and reputation updates on submission

Important behavior:

- public responses are intentionally reduced to a safe public shape
- internal fields such as moderation notes and identity linkage data stay out of public report responses
- images are limited to safe public image MIME types

### 2. Users and Authentication

Primary router: [apps/api/src/routes/users.ts](../apps/api/src/routes/users.ts)

This domain handles:

- public user registration and login
- staff user creation and management
- `/me` profile updates
- avatar upload
- password reset token issuance and password reset completion
- phone verification lifecycle

Important behavior:

- public accounts use JWTs for authenticated API access; operational users use 30-minute HttpOnly sessions in production
- password reset emails are not logged by default
- phone verification is linked to contributor identity and WhatsApp activity

### 3. Admin Operations

Relevant routers include:

- [apps/api/src/routes/admin.ts](../apps/api/src/routes/admin.ts)
- [apps/api/src/routes/export.ts](../apps/api/src/routes/export.ts)
- [apps/api/src/routes/contributors.ts](../apps/api/src/routes/contributors.ts)
- [apps/api/src/routes/ai.ts](../apps/api/src/routes/ai.ts)

These cover:

- admin stats and dashboard data
- bulk report actions
- exports
- contributor reputation management
- AI classification and sitrep generation

### 4. Dynamic Form Builder

Primary router: [apps/api/src/routes/form-builder.ts](../apps/api/src/routes/form-builder.ts)

This domain lets admins change the public submission form without editing frontend code:

- enable or disable sections
- rename labels
- add custom fields
- reorder fields
- manage translation keys and locale state

The frontend reads the form definition at runtime and renders the public submission flow from that response.

### 5. Content Management

Primary router: [apps/api/src/routes/content.ts](../apps/api/src/routes/content.ts)

This domain powers:

- homepage section management
- public homepage delivery
- news article management
- public news delivery
- localized publish/review workflow

The API is split into:

- `/api/content/...` for authenticated editing flows
- `/api/public/...` for public published content

### 6. Footprints and Map Data

Primary router: [apps/api/src/routes/footprints.ts](../apps/api/src/routes/footprints.ts)

This domain handles:

- footprint-set upload by staff
- public merged footprint GeoJSON
- admin CRUD for footprint layers

The public map and admin map can request footprint data and use it to bind reports to specific structures.

## Media Flow

Media helpers live in [apps/api/src/media.ts](../apps/api/src/media.ts).

Current behavior:

- local media is stored under `uploads/`
- optional S3 storage is supported through environment configuration
- local media URLs are returned as `/uploads/...`
- uploaded files are restricted to a safe image allowlist
- static serving adds `nosniff`, restrictive CSP, and cache headers

## Report Submission Flow

For the browser path:

1. The public frontend builds a `FormData` payload.
2. The frontend posts it to `POST /api/reports`.
3. The API validates fields, stores images, creates the report, links contributor identity, and returns a public-safe report payload.
4. The frontend uses the returned contributor summary and moderation result to complete the UX.

For the WhatsApp path:

1. The WhatsApp service receives a webhook event from Meta.
2. It verifies the webhook signature unless running in local stub mode.
3. It walks the user through a session-based intake flow.
4. It converts the completed session into the same report submission shape and sends it to the API.

This keeps the report system centralized in the API even though intake can come from different channels.

## Auth Model

There are two user-facing auth contexts:

- staff/admin users
- public users

The frontend stores them separately, and each request uses the correct bearer token explicitly through the client method being called.

Route separation is important:

- admin pages call admin-only and privileged endpoints
- public pages call public-user endpoints and public report/content endpoints

Some endpoints such as `/api/users/me` and phone-verification flows are shared by both auth types. In those cases, the frontend passes an explicit auth mode so the same backend contract can be used without falling back to route-based token selection.

## What Is and Is Not in Production

The current live deployment path is intentionally:

- `frontend`
- `api`
- `postgres`
- `certbot`

The WhatsApp service remains in the repository and can be run locally, but it is not part of the current `docker-compose.prod.yml` release path.

## Operational Notes

- uploaded media is public by design for report evidence, but upload types are restricted to reduce script-injection risk
- the API is the single source of truth for reports, users, contributors, content, and form definitions
- the frontend is mostly a runtime client over API-driven data and configuration, not a hard-coded static workflow
- PostgreSQL is the real persistence layer for deployment and backups
