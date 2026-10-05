import { logger } from '../observability/logger';
import { translateDynamicText, resolveTranslationsForMany, attachTranslations, startTranslationWorker, reconcileCorruptedStoredReportTranslations, getTranslationJobs, deriveTranslationState, enqueueTranslationJob, applyRequestedTranslationState, processTranslationJob, setStoredTranslationStatus, getTranslationJob, translateAndPersistField, getCachedTranslation, getTranslationInFlightKey, hashStable, SUPPORTED_LANGS } from '../reports/translation';
import express, { Request, Response } from 'express';
import multer from 'multer';

import { randomUUID as uuidv4 } from 'node:crypto';
import { queryAll, queryOne, execute } from '../dbRuntime';

import { checkAndSendAlerts } from './alerts';
import { authMiddleware, requireRole, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { deleteMediaKeys, isAllowedPublicImageMimeType, MediaValidationError, saveMediaFile } from '../media';
import { normalizeStoredPhotoKeys, resolveReportMedia } from '../reportMedia';
import { DEFAULT_LANGUAGE } from '../utils/languages';
import { detectSourceLanguage, normalizeLanguageCode, TRANSLATABLE_FIELDS } from '../utils/reportContentLanguage';

import { applyResolvedAccuracyScore, ensureContributorAlias, ensureReportQualityStub, recomputeContributorProfile } from '../services/contributorReputation';
import { deriveContributorKeyFromUser, ensureUserContributorLink, normalizePhone } from '../services/identityLinking';

import { getModerationSettings, type ModerationSettings } from '../services/moderationSettings';
import { requirePrivacyConsent } from '../middleware/consent';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedPublicImageMimeType(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, GIF, and AVIF images are allowed'));
  },
});

type GeocodeHit = {
  display_name: string;
  lat: string;
  lon: string;
};

type GeocodeJobRow = {
  id: string;
  report_id: string;
  status: 'pending' | 'processing' | 'retry_wait' | 'completed' | 'failed_terminal';
  attempt_count: number;
  next_attempt_at?: string;
  last_error_code?: string | null;
  last_error_message?: string | null;
  locked_at?: string | null;
};

type GeocodeLookupResult =
  | { kind: 'success'; lat: number; lng: number }
  | { kind: 'no_result' }
  | { kind: 'retryable_error'; code: string; message: string };

type NormalizedCustomFieldValue = string | string[] | boolean | null;
const GEOCODE_POLL_MS = parseInt(process.env.GEOCODE_POLL_MS || '15000', 10);
const GEOCODE_LOCK_MINUTES = parseInt(process.env.GEOCODE_LOCK_MINUTES || '2', 10);
const GEOCODE_MAX_ATTEMPTS = parseInt(process.env.GEOCODE_MAX_ATTEMPTS || '5', 10);
const GEOCODE_RETRY_MINUTES = parseInt(process.env.GEOCODE_RETRY_MINUTES || '15', 10);

export async function formatReport(r: any) {
  const media = await resolveReportMedia(r.photos);
  let contributor = undefined as undefined | {
    key: string;
    badge: string;
    primary_badge: string;
    level_code: string;
    trust_score: number;
    points_total: number;
    validation_rate: number;
    badges: string[];
    reports_submitted: number;
    reports_verified: number;
    suspicious_reports: number;
  };
  if (r.contributor_key) {
    const profile = (
      r.contributor_trust_score !== undefined
        ? {
            trust_score: r.contributor_trust_score,
            primary_badge: r.contributor_primary_badge,
            level_code: r.contributor_level_code,
            points_total: r.contributor_points_total,
            validation_rate: r.contributor_validation_rate,
            reports_submitted: r.contributor_reports_submitted,
            reports_verified: r.contributor_reports_verified,
            suspicious_reports: r.contributor_suspicious_reports,
            badges: r.contributor_badges,
          }
        : await queryOne<{
            trust_score: number;
            primary_badge: string;
            level_code: string;
            points_total: number;
            validation_rate: number;
            reports_submitted: number;
            reports_verified: number;
            suspicious_reports: number;
            badges_json?: string;
          }>(
            `SELECT cp.trust_score, cp.primary_badge, cp.level_code, cp.points_total, cp.validation_rate,
              cp.reports_submitted, cp.reports_verified, cp.suspicious_reports,
              COALESCE((
                SELECT jsonb_agg(cba.badge_code ORDER BY cba.awarded_at DESC)
                FROM contributor_badge_awards cba
                WHERE cba.contributor_key = cp.contributor_key AND cba.revoked_at IS NULL
              ), '[]'::jsonb) AS badges_json
            FROM contributor_profiles cp
            WHERE cp.contributor_key = ?`,
            [r.contributor_key]
          )
    ) || { trust_score: 0, primary_badge: 'none', level_code: 'contributor', points_total: 0, validation_rate: 0, reports_submitted: 0, reports_verified: 0, suspicious_reports: 0, badges_json: '[]' };
    contributor = {
      key: r.contributor_key,
      badge: r.contributor_badge || profile.primary_badge || 'none',
      primary_badge: profile.primary_badge || r.contributor_badge || 'none',
      level_code: profile.level_code || 'contributor',
      trust_score: Number(profile.trust_score || 0),
      points_total: Number(profile.points_total || 0),
      validation_rate: Number(profile.validation_rate || 0),
      reports_submitted: Number(profile.reports_submitted || 0),
      reports_verified: Number(profile.reports_verified || 0),
      suspicious_reports: Number(profile.suspicious_reports || 0),
      badges: Array.isArray((profile as any).badges)
        ? ((profile as any).badges as string[])
        : tryParse((profile as any).badges_json, []),
    };
  }
  return {
    ...r,
    infra_types: tryParse(r.infra_types, []),
    electricity_condition: normalizeChoice(r.electricity_condition, VALID_ELEC) || null,
    health_services: normalizeChoice(r.health_services, VALID_HEALTH) || null,
    pressing_needs: normalizePressingNeedsInput(r.pressing_needs).values,
    extra_fields: normalizeCustomFieldsInput(r.extra_fields).values,
    photos: media.photos,
    photo_count: media.photo_count,
    media_state: media.media_state,
    ai_media_eligibility: media.ai_media_eligibility,
    is_urgent: Boolean(r.is_urgent),
    has_debris: normalizeChoice(r.has_debris, VALID_DEBRIS) || null,
    moderation_flags: tryParse(r.moderation_flags, []),
    ai_classification: tryParse(r.ai_classification, null),
    ai_classification_status: r.ai_classification_status || null,
    ai_classification_error: r.ai_classification_error || null,
    internal_notes: stripAiModelPrefix(r.internal_notes),
    source_language: r.source_language || null,
    source_language_confidence: r.source_language_confidence !== undefined && r.source_language_confidence !== null
      ? Number(r.source_language_confidence)
      : null,
    translation_status: r.translation_status || null,
    translation_target_lang: r.translation_target_lang || null,
    translations: r.translations || {},
    actor_key: r.actor_key || null,
    location_capture_mode: r.location_capture_mode || 'unknown',
    contributor,
  };
}

function toPublicContributor(contributor: any) {
  if (!contributor) return undefined;
  return {
    badge: contributor.badge || 'none',
    primary_badge: contributor.primary_badge || contributor.badge || 'none',
    level_code: contributor.level_code || 'contributor',
    trust_score: Number(contributor.trust_score || 0),
    points_total: Number(contributor.points_total || 0),
    validation_rate: Number(contributor.validation_rate || 0),
    reports_submitted: Number(contributor.reports_submitted || 0),
    reports_verified: Number(contributor.reports_verified || 0),
    suspicious_reports: Number(contributor.suspicious_reports || 0),
    badges: Array.isArray(contributor.badges) ? contributor.badges : [],
  };
}

function toPublicReport(report: any) {
  return {
    id: report.id,
    status: report.status,
    lat: Number.isFinite(Number(report.lat)) ? Number(report.lat) : null,
    lng: Number.isFinite(Number(report.lng)) ? Number(report.lng) : null,
    address_text: report.address_text || null,
    building_label: report.building_label || null,
    infra_category: report.infra_category || null,
    infra_name: report.infra_name || null,
    infra_types: Array.isArray(report.infra_types) ? report.infra_types : [],
    electricity_condition: report.electricity_condition || null,
    health_services: report.health_services || null,
    pressing_needs: Array.isArray(report.pressing_needs) ? report.pressing_needs : [],
    extra_fields: report.extra_fields && typeof report.extra_fields === 'object' ? report.extra_fields : {},
    photos: Array.isArray(report.photos) ? report.photos : [],
    photo_count: Number(report.photo_count || 0),
    media_state: report.media_state || null,
    ai_media_eligibility: report.ai_media_eligibility || null,
    is_urgent: Boolean(report.is_urgent),
    has_debris: report.has_debris || null,
    crisis_type: report.crisis_type || null,
    damage_level: report.damage_level || null,
    description: report.description || '',
    channel: report.channel || null,
    source_language: report.source_language || null,
    source_language_confidence: report.source_language_confidence ?? null,
    translation_status: report.translation_status || null,
    translation_target_lang: report.translation_target_lang || null,
    translations: report.translations || {},
    localized: report.localized || undefined,
    submitted_at: report.submitted_at,
    updated_at: report.updated_at,
    verified_at: report.verified_at || null,
    community_confirms: Number(report.community_confirms || 0),
    contributor: toPublicContributor(report.contributor),
  };
}

function tryParse(val: any, fallback: any) {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val || '[]'); } catch { return fallback; }
}

function stripAiModelPrefix(value: string | undefined): string {
  return String(value || '').replace(/^\[AI\/[^\]]+\]\s*/i, '').trim();
}

function sanitize(s: string | undefined, maxLen = 500): string {
  if (!s) return '';
  return s.replace(/<[^>]*>/g, '').replace(/[<>"']/g, '').trim().substring(0, maxLen);
}

function normalizeChoice(value: unknown, validValues: string[]): string | null {
  const text = String(value || '').trim();
  return validValues.includes(text) ? text : null;
}

function normalizeCustomFieldEntry(value: unknown): NormalizedCustomFieldValue | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const cleaned = sanitize(value, 500);
    return cleaned || '';
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitize(String(item || ''), 200))
      .filter(Boolean)
      .slice(0, 25);
  }
  return undefined;
}

function normalizeCustomFieldsInput(value: unknown): { values: Record<string, NormalizedCustomFieldValue>; invalid: boolean } {
  if (value == null || value === '') return { values: {}, invalid: false };

  let raw: Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { values: {}, invalid: true };
      raw = parsed as Record<string, unknown>;
    } catch {
      return { values: {}, invalid: true };
    }
  } else if (typeof value === 'object' && !Array.isArray(value)) {
    raw = value as Record<string, unknown>;
  } else {
    return { values: {}, invalid: true };
  }

  const values: Record<string, NormalizedCustomFieldValue> = {};
  let invalid = false;
  for (const [key, entry] of Object.entries(raw)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      invalid = true;
      continue;
    }
    const normalizedValue = normalizeCustomFieldEntry(entry);
    if (normalizedValue === undefined) {
      invalid = true;
      continue;
    }
    values[normalizedKey] = normalizedValue;
  }

  return { values, invalid };
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((v) => Number.isNaN(v))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return null;
  if (minLat > maxLat || minLng > maxLng) return null;
  return [minLng, minLat, maxLng, maxLat];
}

async function generateId(): Promise<string> {
  const year = new Date().getFullYear();
  const last = await queryOne<{ id: string }>(`SELECT id FROM reports WHERE id LIKE ? ORDER BY id DESC LIMIT 1`, [`CR-${year}-%`]);
  if (!last) return `CR-${year}-0001`;
  const num = parseInt(last.id.split('-')[2]) + 1;
  return `CR-${year}-${String(num).padStart(4, '0')}`;
}

const VALID_INFRA_CATS = ['residential','commercial','government','utility','transport','community','public','other'];
const VALID_CRISIS_TYPES = ['earthquake','flood','tsunami','hurricane','wildfire','explosion','chemical','conflict','civil_unrest'];
const VALID_DAMAGE = ['minimal','partial','destroyed'];
const VALID_ELEC = ['none','minor','moderate','severe','destroyed','unknown'];
const VALID_HEALTH = ['fully_functional','partially_functional','largely_disrupted','not_functioning','unknown'];
const VALID_PRESSING_NEEDS = ['food_water', 'cash', 'healthcare', 'shelter', 'livelihoods', 'wash', 'infrastructure', 'protection', 'local_authority', 'other'];
const VALID_DEBRIS = ['yes','no','unknown'];
const CONFIRM_IP_SALT = process.env.CONFIRM_IP_SALT || 'crisis-confirm-salt';
const CONFIRM_COUNTRY_ENFORCE = (process.env.CONFIRM_COUNTRY_ENFORCE || 'true') === 'true';
const CONTRIBUTOR_SALT = process.env.CONTRIBUTOR_KEY_SALT || 'crisis-contributor-salt';

function normalizePressingNeedValue(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  if (VALID_PRESSING_NEEDS.includes(text)) return text;
  if (!text.startsWith('other:')) return null;
  const detail = sanitize(text.slice(6), 160);
  return detail ? `other:${detail}` : null;
}

function normalizePressingNeedsInput(value: unknown): { values: string[]; invalid: boolean } {
  if (value == null || value === '') return { values: [], invalid: false };

  let rawValues: unknown[];
  if (Array.isArray(value)) {
    rawValues = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return { values: [], invalid: false };
    if (!trimmed.startsWith('[')) return { values: [], invalid: true };
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return { values: [], invalid: true };
      rawValues = parsed;
    } catch {
      return { values: [], invalid: true };
    }
  } else {
    return { values: [], invalid: true };
  }

  const normalized: string[] = [];
  let invalid = false;
  for (const item of rawValues) {
    const next = normalizePressingNeedValue(item);
    if (!next) {
      invalid = true;
      continue;
    }
    if (!normalized.includes(next)) normalized.push(next);
  }

  return { values: normalized, invalid };
}

function normalizeCountryCode(value: unknown): string | null {
  if (!value) return null;
  const clean = String(value).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(clean) ? clean : null;
}

function getClientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  const rawIp = fwd || req.ip || (req.socket as any)?.remoteAddress || '0.0.0.0';
  return rawIp.replace(/^::ffff:/, '').replace(/:\d+$/, '');
}

function getRequestCountry(req: Request): string | null {
  return normalizeCountryCode(
    req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'] || req.body?.country_code
  );
}

function metersToLatitudeDegrees(radiusM: number): number {
  return radiusM / 111320;
}

function metersToLongitudeDegrees(radiusM: number, lat: number): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const safeCos = Math.max(Math.abs(cosLat), 0.01);
  return radiusM / (111320 * safeCos);
}

function normalizeOptionalAddress(value: unknown): string | null {
  const cleaned = sanitize(value === undefined || value === null ? '' : String(value), 200);
  return cleaned || null;
}

function isRetryableNetworkErrorMessage(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('fetch failed')
    || normalized.includes('network')
    || normalized.includes('timeout')
    || normalized.includes('timed out')
    || normalized.includes('abort')
    || normalized.includes('tls')
    || normalized.includes('certificate')
    || normalized.includes('econnreset')
    || normalized.includes('enetunreach')
    || normalized.includes('eai_again')
    || normalized.includes('econnrefused');
}

async function resolveAddressCoordinatesDetailed(addressText: string, acceptLanguage?: string): Promise<GeocodeLookupResult> {
  const query = String(addressText || '').trim();
  if (!query) return { kind: 'no_result' };
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Language': acceptLanguage || 'en',
        'User-Agent': 'UNDP-Crisis-Reporter/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return {
        kind: 'retryable_error',
        code: `http_${response.status}`,
        message: `Geocode request failed with status ${response.status}`,
      };
    }
    const rows = await response.json() as Array<{ lat?: string; lon?: string }>;
    const first = rows[0];
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { kind: 'no_result' };
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { kind: 'no_result' };
    return { kind: 'success', lat, lng };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Geocode request failed';
    const code = String((error as { cause?: { code?: string } })?.cause?.code || '');
    if (
      error instanceof Error
      && (error.name === 'TimeoutError' || error.name === 'AbortError' || isRetryableNetworkErrorMessage(message) || code)
    ) {
      return {
        kind: 'retryable_error',
        code: code || 'network_error',
        message,
      };
    }
    return {
      kind: 'retryable_error',
      code: 'network_error',
      message,
    };
  }
}

async function resolveAddressCoordinates(addressText: string, acceptLanguage?: string): Promise<{ lat: number; lng: number } | null> {
  const resolved = await resolveAddressCoordinatesDetailed(addressText, acceptLanguage);
  return resolved.kind === 'success' ? { lat: resolved.lat, lng: resolved.lng } : null;
}

async function searchAddressCandidates(addressText: string, acceptLanguage?: string, limit = 5): Promise<GeocodeHit[]> {
  const query = String(addressText || '').trim();
  if (query.length < 3) return [];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=${Math.max(1, Math.min(limit, 5))}&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Language': acceptLanguage || 'en',
        'User-Agent': 'UNDP-Crisis-Reporter/1.0',
      },
    });
    if (!response.ok) return [];
    const rows = await response.json() as GeocodeHit[];
    return Array.isArray(rows) ? rows.filter((row) => row?.display_name && row?.lat && row?.lon) : [];
  } catch {
    return [];
  }
}

function sameOptionalText(a: unknown, b: unknown): boolean {
  return String(a || '').trim() === String(b || '').trim();
}

router.get('/geocode', async (req: Request, res: Response): Promise<void> => {
  const query = sanitize(String(req.query?.q || ''), 200);
  if (query.trim().length < 3) {
    res.json({ hits: [] });
    return;
  }
  const hits = await searchAddressCandidates(query, String(req.headers['accept-language'] || 'en'));
  res.json({ hits });
});

async function resolveAdminLocationAssignment(params: {
  reportId: string;
  lat: number;
  lng: number;
  addressText: string | null;
  buildingLabel?: string | null;
  footprintSetId?: string | null;
  footprintFeatureId?: string | null;
  footprintFeatureKey?: string | null;
}): Promise<{ locationId: string; versionNumber: number }> {
  const radiusM = 25;
  const latTol = metersToLatitudeDegrees(radiusM);
  const lngTol = metersToLongitudeDegrees(radiusM, params.lat);
  const exactAddress = normalizeOptionalAddress(params.addressText);
  const hasFootprintIdentity = Boolean(params.footprintSetId && (params.footprintFeatureId || params.footprintFeatureKey));
  const nearby = hasFootprintIdentity
    ? await queryOne<{ id: string }>(
        `SELECT id
         FROM report_locations
         WHERE last_report_id != ?
           AND footprint_set_id = ?
           AND (
             (? IS NOT NULL AND footprint_feature_id = ?)
             OR (? IS NOT NULL AND footprint_feature_key = ?)
           )
         ORDER BY updated_at DESC
         LIMIT 1`,
        [
          params.reportId,
          params.footprintSetId,
          params.footprintFeatureId,
          params.footprintFeatureId,
          params.footprintFeatureKey,
          params.footprintFeatureKey,
        ]
      )
    : await queryOne<{ id: string }>(
        `SELECT id
         FROM report_locations
         WHERE last_report_id != ?
           AND ABS(lat - ?) <= ?
           AND ABS(lng - ?) <= ?
           AND (
             (? IS NOT NULL AND lower(COALESCE(address_text, '')) = lower(?))
             OR (? IS NULL)
           )
         ORDER BY updated_at DESC
         LIMIT 1`,
        [params.reportId, params.lat, latTol, params.lng, lngTol, exactAddress, exactAddress, exactAddress]
      );

  let locationId = nearby?.id;
  if (!locationId) {
    locationId = `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await execute(
      `INSERT INTO report_locations
       (id, lat, lng, footprint_set_id, footprint_feature_id, footprint_feature_key, building_label, address_text, last_report_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        locationId,
        params.lat,
        params.lng,
        params.footprintSetId || null,
        params.footprintFeatureId || null,
        params.footprintFeatureKey || null,
        normalizeOptionalAddress(params.buildingLabel),
        exactAddress,
        params.reportId,
      ]
    );
  } else {
    await execute(
      `UPDATE report_locations
       SET updated_at = NOW(),
           last_report_id = ?,
           building_label = COALESCE(?, building_label),
           address_text = COALESCE(?, address_text),
           footprint_set_id = COALESCE(?, footprint_set_id),
           footprint_feature_id = COALESCE(?, footprint_feature_id),
           footprint_feature_key = COALESCE(?, footprint_feature_key)
       WHERE id = ?`,
      [
        params.reportId,
        normalizeOptionalAddress(params.buildingLabel),
        exactAddress,
        params.footprintSetId || null,
        params.footprintFeatureId || null,
        params.footprintFeatureKey || null,
        locationId,
      ]
    );
  }

  const nextVersion = await queryOne<{ v: number }>(
    'SELECT COALESCE(MAX(version_number), 0) + 1 AS v FROM reports WHERE location_id = ?',
    [locationId]
  );
  return { locationId, versionNumber: nextVersion?.v || 1 };
}

async function getGeocodeJob(reportId: string): Promise<GeocodeJobRow | undefined> {
  return queryOne<GeocodeJobRow>('SELECT * FROM report_geocode_jobs WHERE report_id = ?', [reportId]);
}

async function upsertGeocodeJob(reportId: string): Promise<GeocodeJobRow | undefined> {
  await execute(
    `INSERT INTO report_geocode_jobs (id, report_id, status, attempt_count, next_attempt_at, updated_at)
     VALUES (?, ?, 'pending', 0, NOW(), NOW())
     ON CONFLICT (report_id) DO UPDATE SET
       status = CASE
         WHEN report_geocode_jobs.status = 'processing' THEN 'processing'
         WHEN report_geocode_jobs.status = 'completed' THEN 'completed'
         ELSE 'pending'
       END,
       next_attempt_at = CASE
         WHEN report_geocode_jobs.status IN ('processing', 'completed') THEN report_geocode_jobs.next_attempt_at
         ELSE NOW()
       END,
       updated_at = NOW()`,
    [uuidv4(), reportId]
  );
  return getGeocodeJob(reportId);
}

async function updateGeocodeJob(jobId: string, fields: Partial<GeocodeJobRow>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.status !== undefined) { sets.push('status = ?'); params.push(fields.status); }
  if (fields.attempt_count !== undefined) { sets.push('attempt_count = ?'); params.push(fields.attempt_count); }
  if (fields.next_attempt_at !== undefined) { sets.push('next_attempt_at = ?'); params.push(fields.next_attempt_at); }
  if (fields.last_error_code !== undefined) { sets.push('last_error_code = ?'); params.push(fields.last_error_code); }
  if (fields.last_error_message !== undefined) { sets.push('last_error_message = ?'); params.push(fields.last_error_message); }
  if (fields.locked_at !== undefined) { sets.push('locked_at = ?'); params.push(fields.locked_at); }
  if (sets.length === 0) return;
  params.push(jobId);
  await execute(`UPDATE report_geocode_jobs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params as any[]);
}

async function reconcilePendingGeocodeJobs(): Promise<void> {
  const rows = await queryAll<{ id: string }>(
    `SELECT r.id
     FROM reports r
     LEFT JOIN report_geocode_jobs j ON j.report_id = r.id
     WHERE j.report_id IS NULL
       AND COALESCE(trim(r.address_text), '') <> ''
       AND r.lat IS NULL
       AND r.lng IS NULL`
  );
  for (const row of rows) {
    await upsertGeocodeJob(row.id);
  }
}

async function acquireGeocodeJob(): Promise<GeocodeJobRow | undefined> {
  return queryOne<GeocodeJobRow>(
    `UPDATE report_geocode_jobs
     SET status = 'processing', locked_at = NOW(), updated_at = NOW()
     WHERE id = (
       SELECT id
       FROM report_geocode_jobs
       WHERE status IN ('pending', 'retry_wait')
         AND next_attempt_at <= NOW()
         AND (locked_at IS NULL OR locked_at <= (NOW() - (? * INTERVAL '1 minute')))
       ORDER BY next_attempt_at ASC
       LIMIT 1
     )
     RETURNING *`,
    [GEOCODE_LOCK_MINUTES]
  );
}

function buildGeocodeRetryAt(attemptCount: number): string {
  const boundedAttempt = Math.max(1, Math.min(attemptCount, GEOCODE_MAX_ATTEMPTS));
  return new Date(Date.now() + ((GEOCODE_RETRY_MINUTES * boundedAttempt) * 60 * 1000)).toISOString();
}

function deriveGeocodeCaptureMode(currentMode?: string | null): string {
  const normalized = String(currentMode || '').trim();
  if (normalized && normalized !== 'unknown') return normalized;
  return 'search';
}

async function applyGeocodedCoordinates(report: any, lat: number, lng: number): Promise<void> {
  const nextAddress = normalizeOptionalAddress(report.address_text);
  const nextBuildingLabel = normalizeOptionalAddress(report.building_label);
  const nextCaptureMode = deriveGeocodeCaptureMode(report.location_capture_mode);
  const nextLocation = await resolveAdminLocationAssignment({
    reportId: String(report.id),
    lat,
    lng,
    addressText: nextAddress,
    buildingLabel: nextBuildingLabel,
    footprintSetId: report.footprint_set_id || null,
    footprintFeatureId: report.footprint_feature_id || null,
    footprintFeatureKey: report.footprint_feature_key || null,
  });

  await execute(
    `UPDATE reports
     SET location_id = ?,
         version_number = ?,
         location_capture_mode = ?,
         lat = ?,
         lng = ?,
         address_text = ?
     WHERE id = ?`,
    [nextLocation.locationId, nextLocation.versionNumber, nextCaptureMode, lat, lng, nextAddress, report.id]
  );

  await execute(
    `UPDATE report_locations
     SET updated_at = NOW(),
         last_report_id = ?,
         lat = ?,
         lng = ?,
         footprint_set_id = COALESCE(?, footprint_set_id),
         footprint_feature_id = COALESCE(?, footprint_feature_id),
         footprint_feature_key = COALESCE(?, footprint_feature_key),
         building_label = COALESCE(?, building_label),
         address_text = COALESCE(?, address_text)
     WHERE id = ?`,
    [
      report.id,
      lat,
      lng,
      report.footprint_set_id || null,
      report.footprint_feature_id || null,
      report.footprint_feature_key || null,
      nextBuildingLabel,
      nextAddress,
      nextLocation.locationId,
    ]
  );

  await execute(
    'INSERT INTO report_versions (id, location_id, report_id, version_number, change_type, payload) VALUES (?, ?, ?, ?, ?, ?)',
    [
      `rv_${report.id}_${Date.now()}`,
      nextLocation.locationId,
      report.id,
      nextLocation.versionNumber,
      'geocode_backfill',
      JSON.stringify({
        previous: {
          location_id: report.location_id,
          version_number: report.version_number,
          location_capture_mode: report.location_capture_mode,
          lat: report.lat,
          lng: report.lng,
          address_text: report.address_text,
        },
        next: {
          location_id: nextLocation.locationId,
          version_number: nextLocation.versionNumber,
          location_capture_mode: nextCaptureMode,
          lat,
          lng,
          address_text: nextAddress,
        },
      }),
    ]
  );
}

async function processGeocodeJob(job: GeocodeJobRow): Promise<void> {
  const report = await queryOne<any>('SELECT * FROM reports WHERE id = ?', [job.report_id]);
  if (!report) {
    await updateGeocodeJob(job.id, {
      status: 'failed_terminal',
      last_error_code: 'report_not_found',
      last_error_message: 'Report not found',
      locked_at: null,
      next_attempt_at: null,
    });
    return;
  }

  if (report.lat !== null && report.lng !== null) {
    await updateGeocodeJob(job.id, {
      status: 'completed',
      last_error_code: null,
      last_error_message: null,
      locked_at: null,
      next_attempt_at: null,
    });
    return;
  }

  const addressText = normalizeOptionalAddress(report.address_text);
  if (!addressText) {
    await updateGeocodeJob(job.id, {
      status: 'failed_terminal',
      attempt_count: job.attempt_count + 1,
      last_error_code: 'missing_address',
      last_error_message: 'Address text missing',
      locked_at: null,
      next_attempt_at: null,
    });
    return;
  }

  const geocoded = await resolveAddressCoordinatesDetailed(addressText, DEFAULT_LANGUAGE);
  if (geocoded.kind === 'success') {
    await applyGeocodedCoordinates(report, geocoded.lat, geocoded.lng);
    await updateGeocodeJob(job.id, {
      status: 'completed',
      attempt_count: job.attempt_count + 1,
      last_error_code: null,
      last_error_message: null,
      locked_at: null,
      next_attempt_at: null,
    });
    return;
  }

  if (geocoded.kind === 'no_result') {
    await updateGeocodeJob(job.id, {
      status: 'failed_terminal',
      attempt_count: job.attempt_count + 1,
      last_error_code: 'no_result',
      last_error_message: 'No geocode result found',
      locked_at: null,
      next_attempt_at: null,
    });
    return;
  }

  const attempts = job.attempt_count + 1;
  const terminal = attempts >= GEOCODE_MAX_ATTEMPTS;
  await updateGeocodeJob(job.id, {
    status: terminal ? 'failed_terminal' : 'retry_wait',
    attempt_count: attempts,
    last_error_code: geocoded.code,
    last_error_message: geocoded.message,
    locked_at: null,
    next_attempt_at: terminal ? null : buildGeocodeRetryAt(attempts),
  });
}
let geocodeWorkerStarted = false;
let corruptedTranslationReconcileStarted = false;

function startGeocodeWorker() {
  if (geocodeWorkerStarted) return;
  geocodeWorkerStarted = true;
  setInterval(async () => {
    try {
      await reconcilePendingGeocodeJobs();
      const job = await acquireGeocodeJob();
      if (!job) return;
      await processGeocodeJob(job);
    } catch (error) {
      logger.error('worker.geocode.failed', { error });
    }
  }, GEOCODE_POLL_MS).unref?.();
}

function startCorruptedTranslationReconcile() {
  if (corruptedTranslationReconcileStarted) return;
  corruptedTranslationReconcileStarted = true;
  void reconcileCorruptedStoredReportTranslations().catch((error) => {
    logger.error('worker.translation.reconcile.failed', { error });
  });
}

export function startReportBackgroundWorkers() {
  startCorruptedTranslationReconcile();
  startTranslationWorker();
  startGeocodeWorker();
}

async function localizeReportDynamicFields(report: any, lang?: string) {
  const targetLang = normalizeLanguageCode(lang) || DEFAULT_LANGUAGE;
  const withTranslations = report.translations ? report : await attachTranslations(report, [targetLang].filter(Boolean));
  const job = await getTranslationJob(report.id, targetLang);
  const state = deriveTranslationState(withTranslations, targetLang, job);
  if (state.status === 'pending' && state.missingFields.length > 0 && (!job || job.status === 'completed')) {
    await enqueueTranslationJob(report.id, targetLang);
  }
  if (!SUPPORTED_LANGS.has(targetLang)) {
    return { ...applyRequestedTranslationState(withTranslations, state), localized: {} };
  }

  const localized: Record<string, string> = {};
  for (const field of TRANSLATABLE_FIELDS) {
    const val = String(report[field] || '').trim();
    if (!val) continue;
    const existing = withTranslations.translations?.[targetLang]?.[field];
    if (existing) {
      localized[field] = existing;
      continue;
    }
    localized[field] = val;
  }
  return { ...applyRequestedTranslationState(withTranslations, state), localized };
}

type UploadedFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

type RequestWithFiles = Request & {
  files?: UploadedFile[];
};

async function getContributorKey(req: Request, contact: string): Promise<string> {
  const authenticatedUser = (req as AuthenticatedRequest).user;
  if (authenticatedUser?.id && authenticatedUser.role === 'public_user') {
    const existingLink = await queryOne<{ contributor_key: string }>(
      'SELECT contributor_key FROM user_contributor_links WHERE user_id = ?',
      [authenticatedUser.id]
    );
    if (existingLink?.contributor_key) {
      return existingLink.contributor_key;
    }
    const contributorKey = deriveContributorKeyFromUser(authenticatedUser.id);
    await ensureUserContributorLink(authenticatedUser.id, contributorKey, 'public_submit');
    return contributorKey;
  }
  const raw = contact
    ? `contact:${contact.toLowerCase()}`
    : `ip:${getClientIp(req)}`;
  return hashStable(`${CONTRIBUTOR_SALT}:${raw}`);
}

function normalizeDescriptionFingerprint(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\u0400-\u04FF\u4e00-\u9fff]+/gi, ' ').trim().slice(0, 180);
}

async function refreshContributorProfile(contributorKey: string): Promise<any> {
  return recomputeContributorProfile(contributorKey);
}

async function getContributorBadgeCodes(contributorKey: string): Promise<string[]> {
  const rows = await queryAll<{ badge_code: string }>(
    'SELECT badge_code FROM contributor_badge_awards WHERE contributor_key = ? AND revoked_at IS NULL ORDER BY awarded_at DESC',
    [contributorKey]
  );
  return rows.map((row) => row.badge_code);
}

async function assessModerationFlags(params: {
  settings: ModerationSettings;
  contributorKey: string;
  lat: number;
  lng: number;
  description: string;
  addressText: string;
}): Promise<string[]> {
  const flags = new Set<string>();
  const latTol = metersToLatitudeDegrees(params.settings.duplicateRadiusM);
  const lngTol = metersToLongitudeDegrees(params.settings.duplicateRadiusM, params.lat);
  const hourly = await queryOne<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM reports WHERE contributor_key = ? AND submitted_at >= (NOW() - INTERVAL '1 hour')",
    [params.contributorKey]
  );
  const daily = await queryOne<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM reports WHERE contributor_key = ? AND submitted_at >= (NOW() - INTERVAL '1 day')",
    [params.contributorKey]
  );
  if ((hourly?.c || 0) >= params.settings.abuseMaxReportsPerHour) flags.add('high_frequency_hourly');
  if ((daily?.c || 0) >= params.settings.abuseMaxReportsPerDay) flags.add('high_frequency_daily');

  const repeat = await queryOne<{ c: number }>(`
      SELECT COUNT(*)::int AS c
      FROM reports
      WHERE contributor_key = ?
        AND submitted_at >= (NOW() - (? * INTERVAL '1 minute'))
        AND ABS(lat - ?) <= ?
        AND ABS(lng - ?) <= ?
  `, [params.contributorKey, params.settings.abuseRepeatWindowMinutes, params.lat, latTol, params.lng, lngTol]);
  if ((repeat?.c || 0) > 0) flags.add('repeat_same_location');

  const fingerprint = normalizeDescriptionFingerprint(params.description || params.addressText || '');
  if (fingerprint) {
    const dupText = await queryOne<{ c: number }>(`
      SELECT COUNT(*)::int AS c
      FROM reports
      WHERE contributor_key = ?
        AND submitted_at >= (NOW() - (? * INTERVAL '1 minute'))
        AND lower(COALESCE(description, address_text, '')) LIKE ?
    `, [params.contributorKey, params.settings.abuseRepeatWindowMinutes, `%${fingerprint.slice(0, 40)}%`]);
    if ((dupText?.c || 0) > 0) flags.add('repeat_same_description');
  }
  return Array.from(flags);
}

router.post('/', optionalAuthMiddleware, upload.array('photos', 5), async (req: Request, res: Response): Promise<void> => {
  const requestWithFiles = req as RequestWithFiles;
  let photoKeys: string[] = [];
  try {
    const {
      lat, lng, address_text, infra_types, infra_category, infra_name, crisis_type,
      damage_level, electricity_condition, health_services, pressing_needs,
      has_debris, description, is_urgent, submitter_contact, source_language,
      actor_key, location_capture_mode, footprint_set_id, footprint_feature_id, footprint_feature_key, building_label,
    } = req.body;

    const cleanAddress = sanitize(address_text, 200);
    const hasCoordinateInput = String(lat ?? '').trim() !== '' && String(lng ?? '').trim() !== '';
    const explicitLatNum = hasCoordinateInput ? parseFloat(lat) : null;
    const explicitLngNum = hasCoordinateInput ? parseFloat(lng) : null;
    const hasExplicitCoordinates = Number.isFinite(explicitLatNum) && Number.isFinite(explicitLngNum)
      && (explicitLatNum as number) >= -90 && (explicitLatNum as number) <= 90
      && (explicitLngNum as number) >= -180 && (explicitLngNum as number) <= 180;
    if (hasCoordinateInput && !hasExplicitCoordinates) {
      res.status(400).json({ error: 'Invalid coordinates' }); return;
    }
    if (!hasExplicitCoordinates && !cleanAddress) {
      res.status(400).json({ error: 'Location required' }); return;
    }
    if (!damage_level || !VALID_DAMAGE.includes(damage_level)) {
      res.status(400).json({ error: 'Valid damage_level required' }); return;
    }

    const cleanBuildingLabel = sanitize(building_label, 200);
    const cleanDesc = sanitize(description, 500);
    const cleanContact = normalizePhone(submitter_contact) || sanitize(submitter_contact, 50);
    const cleanInfraName = sanitize(infra_name, 200);
    const sourceLanguageGuess = detectSourceLanguage([cleanDesc, cleanAddress, cleanInfraName], source_language);
    const countryCode = getRequestCountry(req);
    const resolvedAddressCoordinates = !hasExplicitCoordinates && cleanAddress
      ? await resolveAddressCoordinates(cleanAddress, String(req.headers['accept-language'] || 'en'))
      : null;
    const latNum = hasExplicitCoordinates ? explicitLatNum : resolvedAddressCoordinates?.lat ?? null;
    const lngNum = hasExplicitCoordinates ? explicitLngNum : resolvedAddressCoordinates?.lng ?? null;
    const hasCoordinates = latNum !== null && lngNum !== null;

    const infraCat = VALID_INFRA_CATS.includes(infra_category) ? infra_category : 'other';
    const crisisType = VALID_CRISIS_TYPES.includes(crisis_type) ? crisis_type : null;
    const elecCond = normalizeChoice(electricity_condition, VALID_ELEC) || 'unknown';
    const healthSvc = normalizeChoice(health_services, VALID_HEALTH) || 'unknown';
    const debrisVal = VALID_DEBRIS.includes(has_debris) ? has_debris : 'unknown';

    const infraArr = (() => {
      try {
        if (Array.isArray(infra_types)) return infra_types;
        if (typeof infra_types === 'string') return infra_types.startsWith('[') ? JSON.parse(infra_types) : [infra_types];
        return [infraCat];
      } catch { return [infraCat]; }
    })();

    const normalizedNeeds = normalizePressingNeedsInput(pressing_needs);
    if (normalizedNeeds.invalid) {
      res.status(400).json({ error: 'Invalid pressing needs format' });
      return;
    }
    const needsArr = normalizedNeeds.values;
    const normalizedCustomFields = normalizeCustomFieldsInput(req.body.custom_fields);
    if (normalizedCustomFields.invalid) {
      res.status(400).json({ error: 'Invalid custom fields format' });
      return;
    }

    const files = requestWithFiles.files || [];
    photoKeys = await Promise.all(files.map((f) => saveMediaFile({
      buffer: f.buffer,
      mimetype: f.mimetype,
      originalname: f.originalname,
    })));
    const id = await generateId();
    const media = await resolveReportMedia(photoKeys);
    const aiClassificationStatus = media.ai_media_eligibility === 'eligible' ? 'pending' : null;
    const translationStatus = sourceLanguageGuess.language === DEFAULT_LANGUAGE || [cleanDesc, cleanAddress, cleanInfraName].every((value) => !value)
      ? 'not_needed'
      : 'pending';
    const moderationSettings = await getModerationSettings();
    const latTol = hasCoordinates ? metersToLatitudeDegrees(moderationSettings.duplicateRadiusM) : null;
    const lngTol = hasCoordinates ? metersToLongitudeDegrees(moderationSettings.duplicateRadiusM, latNum as number) : null;
    const contributorKey = await getContributorKey(req, cleanContact);
    const actorKey = sanitize(actor_key, 120) || null;
    const locationCaptureMode = ['gps', 'map', 'manual_coordinates', 'search', 'footprint', 'unknown'].includes(String(location_capture_mode || ''))
      ? String(location_capture_mode)
      : 'unknown';
    const footprintSetId = sanitize(footprint_set_id, 120) || null;
    const footprintFeatureId = sanitize(footprint_feature_id, 160) || null;
    const footprintFeatureKey = sanitize(footprint_feature_key, 240) || null;
    const hasFootprintSelection = Boolean(footprintSetId && (footprintFeatureId || footprintFeatureKey));
    // Submission writes report content, contributor linkage, moderation context, and location lineage
    // in one pass so review, deduplication, and trust scoring all start from the same source of truth.
    const moderationFlags = await assessModerationFlags({
      settings: moderationSettings,
      contributorKey,
      lat: hasCoordinates ? latNum : undefined,
      lng: hasCoordinates ? lngNum : undefined,
      description: cleanDesc,
      addressText: cleanAddress,
    });
    const possibleDuplicate = moderationSettings.duplicateDetectionEnabled && hasCoordinates
      ? await queryOne<{ id: string }>(`
          SELECT id FROM reports
          WHERE damage_level = ?
            AND submitted_at >= (NOW() - (? * INTERVAL '1 hour'))
            AND ABS(lat - ?) <= ?
            AND ABS(lng - ?) <= ?
          ORDER BY submitted_at DESC
          LIMIT 1
        `, [damage_level, moderationSettings.duplicateTimeHours, latNum, latTol, lngNum, lngTol])
      : undefined;
    let locationId = '';
    let versionNumber: number;
    const nearbyLocation = hasFootprintSelection
      ? await queryOne<{ id: string }>(
          `SELECT id
           FROM report_locations
           WHERE footprint_set_id = ?
             AND (
               (? IS NOT NULL AND footprint_feature_id = ?)
               OR (? IS NOT NULL AND footprint_feature_key = ?)
             )
           ORDER BY updated_at DESC
           LIMIT 1`,
          [
            footprintSetId,
            footprintFeatureId,
            footprintFeatureId,
            footprintFeatureKey,
            footprintFeatureKey,
          ]
        )
      : hasCoordinates
        ? await queryOne<{ id: string }>(`
            SELECT id
            FROM report_locations
            WHERE ABS(lat - ?) <= ?
              AND ABS(lng - ?) <= ?
            ORDER BY updated_at DESC
            LIMIT 1
          `, [latNum, latTol, lngNum, lngTol])
        : null;

    if (nearbyLocation?.id) {
      locationId = nearbyLocation.id;
      const nextVersion = await queryOne<{ v: number }>('SELECT COALESCE(MAX(version_number), 0) + 1 AS v FROM reports WHERE location_id = ?', [locationId]);
      versionNumber = nextVersion?.v || 1;
    } else {
      locationId = `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      versionNumber = 1;
      await execute(
        `INSERT INTO report_locations
         (id, lat, lng, footprint_set_id, footprint_feature_id, footprint_feature_key, building_label, address_text, last_report_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          locationId,
          hasCoordinates ? latNum : null,
          hasCoordinates ? lngNum : null,
          footprintSetId,
          footprintFeatureId,
          footprintFeatureKey,
          cleanBuildingLabel || null,
          cleanAddress || null,
          id,
        ]
      );
    }

    const abuseEscalated = moderationFlags.includes('high_frequency_hourly') || moderationFlags.includes('repeat_same_description');
    const initialStatus = possibleDuplicate ? 'duplicate' : abuseEscalated ? 'flagged' : 'pending';
    const initialNote = possibleDuplicate
      ? `Potential duplicate of ${possibleDuplicate.id} (auto-detected by proximity/time).`
      : moderationFlags.length
        ? `Auto-moderation flags: ${moderationFlags.join(', ')}.`
        : null;

    await execute(`
      INSERT INTO reports (
        id, location_id, version_number, actor_key, location_capture_mode, footprint_set_id, footprint_feature_id, footprint_feature_key, building_label,
        lat, lng, address_text, infra_category, infra_name, infra_types,
        crisis_type, damage_level, electricity_condition, health_services,
        pressing_needs, has_debris, description, extra_fields, is_urgent, submitter_contact, contributor_key, contributor_badge,
        country_code, photos, moderation_flags, channel, status, internal_notes,
        ai_classification_status, ai_classification_error, source_language, source_language_confidence, translation_status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      id, locationId, versionNumber, actorKey, locationCaptureMode, footprintSetId, footprintFeatureId, footprintFeatureKey, cleanBuildingLabel || null, hasCoordinates ? latNum : null, hasCoordinates ? lngNum : null,
      cleanAddress || null, infraCat, cleanInfraName || null, JSON.stringify(infraArr),
      crisisType, damage_level, elecCond, healthSvc,
      JSON.stringify(needsArr), debrisVal,
      cleanDesc || null, JSON.stringify(normalizedCustomFields.values), is_urgent === 'true' || is_urgent === true ? 1 : 0,
      cleanContact || null, contributorKey, 'none', countryCode,
      JSON.stringify(photoKeys), JSON.stringify(moderationFlags), req.body.channel || 'web',
      initialStatus, initialNote, aiClassificationStatus, null, sourceLanguageGuess.language, sourceLanguageGuess.confidence, translationStatus,
    ]);

    await execute(
      `UPDATE report_locations
       SET updated_at = NOW(),
           building_label = COALESCE(?, building_label),
           address_text = COALESCE(?, address_text),
           last_report_id = ?,
           footprint_set_id = COALESCE(?, footprint_set_id),
           footprint_feature_id = COALESCE(?, footprint_feature_id),
           footprint_feature_key = COALESCE(?, footprint_feature_key)
       WHERE id = ?`,
      [cleanBuildingLabel || null, cleanAddress || null, id, footprintSetId, footprintFeatureId, footprintFeatureKey, locationId]
    );

    await execute(
      'INSERT INTO report_versions (id, location_id, report_id, version_number, change_type, payload) VALUES (?, ?, ?, ?, ?, ?)',
      [
        `rv_${id}`,
        locationId,
        id,
        versionNumber,
        'submit',
        JSON.stringify({
          actor_key: actorKey,
          location_capture_mode: locationCaptureMode,
          footprint_set_id: footprintSetId,
          footprint_feature_id: footprintFeatureId,
          footprint_feature_key: footprintFeatureKey,
          building_label: cleanBuildingLabel || null,
          lat: hasCoordinates ? latNum : null,
          lng: hasCoordinates ? lngNum : null,
          address_text: cleanAddress || null,
          damage_level,
          infra_category: infraCat,
          crisis_type: crisisType,
        }),
      ]
    );

    await ensureContributorAlias(contributorKey, actorKey, String(req.body.channel || 'web'));
    await ensureReportQualityStub(id, {
      addressText: cleanAddress,
      infraName: cleanInfraName,
      description: cleanDesc,
      pressingNeeds: needsArr,
      photosCount: photoKeys.length,
      infraTypes: infraArr,
      locationCaptureMode,
      lat: hasCoordinates ? latNum : undefined,
      lng: hasCoordinates ? lngNum : undefined,
      newCoverageLocation: versionNumber === 1,
    });

    const report = await queryOne('SELECT * FROM reports WHERE id = ?', [id]);
    const contributorProfile = await refreshContributorProfile(contributorKey);
    const contributorBadges = await getContributorBadgeCodes(contributorKey);
    await execute('UPDATE reports SET contributor_badge = ? WHERE id = ?', [contributorProfile?.primary_badge || 'none', id]);
    checkAndSendAlerts(id).catch((error: unknown) => logger.error('alerts.delivery.failed', { reportId: id, error }));
    if (media.ai_media_eligibility === 'eligible') {
      setTimeout(() => {
        import('./ai')
          .then(async ({ triggerClassificationForReport }) => {
            const outcome = await triggerClassificationForReport(id);
            if (outcome.status >= 400) {
              logger.error('ai.classify.trigger', { details: [{ reportId: id, status: outcome.status, body: outcome.body }] });
            }
          })
          .catch((error) => {
            logger.error('ai.classify.trigger', { details: [{ reportId: id, message: error instanceof Error ? error.message : String(error) }] });
          });
      }, 2000);
    }
    if (cleanAddress && !hasCoordinates) {
      await upsertGeocodeJob(id);
    }
    const formatted = await attachTranslations(await formatReport({
      ...report,
      contributor_badge: contributorProfile?.primary_badge || 'none',
      contributor_primary_badge: contributorProfile?.primary_badge || 'none',
      contributor_level_code: contributorProfile?.level_code || 'contributor',
      contributor_trust_score: contributorProfile?.trust_score || 0,
      contributor_points_total: contributorProfile?.points_total || 0,
      contributor_validation_rate: contributorProfile?.validation_rate || 0,
      contributor_reports_submitted: contributorProfile?.reports_submitted || 0,
      contributor_reports_verified: contributorProfile?.reports_verified || 0,
      contributor_suspicious_reports: contributorProfile?.suspicious_reports || 0,
      contributor_badges: contributorBadges,
    }), []);
    res.status(201).json({
      success: true,
      report: toPublicReport(formatted),
      contributor: {
        key: contributorProfile?.contributor_key || contributorKey,
        badge: contributorProfile?.primary_badge || 'none',
        primary_badge: contributorProfile?.primary_badge || 'none',
        level_code: contributorProfile?.level_code || 'contributor',
        trust_score: contributorProfile?.trust_score || 0,
        points_total: contributorProfile?.points_total || 0,
        validation_rate: contributorProfile?.validation_rate || 0,
        reports_submitted: contributorProfile?.reports_submitted || 0,
        reports_verified: contributorProfile?.reports_verified || 0,
        suspicious_reports: contributorProfile?.suspicious_reports || 0,
        badges: contributorBadges,
      },
      moderation: {
        flags: moderationFlags,
        review_required: initialStatus === 'flagged' || initialStatus === 'duplicate',
      },
    });
  } catch (err: any) {
    if (photoKeys.length > 0) {
      await deleteMediaKeys(photoKeys).catch((error: unknown) => logger.error('cleanup.failed', { error }));
    }
    if (err instanceof MediaValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error('report.submission.failed', { details: [err] });
    res.status(500).json({ error: 'Failed to submit' });
  }
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, damage_level, crisis_type, since, bbox, limit = '200', offset = '0', crisis_event } = req.query;
    const safeLimit = parsePositiveInt(limit, 200, 500);
    const safeOffset = parsePositiveInt(offset, 0, 100000);

    let query = 'SELECT * FROM reports WHERE 1=1';
    const params: (string | number)[] = [];
    if (status && status !== 'all') { query += ' AND status = ?'; params.push(status as string); }
    if (damage_level && damage_level !== 'all') { query += ' AND damage_level = ?'; params.push(damage_level as string); }
    if (crisis_type) { query += ' AND crisis_type = ?'; params.push(crisis_type as string); }
    if (crisis_event) { query += ' AND crisis_event = ?'; params.push(crisis_event as string); }
    if (since) { query += ' AND submitted_at >= ?'; params.push(since as string); }
    if (bbox) {
      const parsedBbox = parseBbox(String(bbox));
      if (!parsedBbox) {
        res.status(400).json({ error: 'Invalid bbox format. Expected minLng,minLat,maxLng,maxLat' });
        return;
      }
      const [minLng, minLat, maxLng, maxLat] = parsedBbox;
      query += ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?';
      params.push(minLat, maxLat, minLng, maxLng);
    }
    const base = query.split('WHERE 1=1')[1];
    const total = ((await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM reports WHERE 1=1${base}`, params)) as { c: number }).c;
    query += ' ORDER BY submitted_at DESC LIMIT ? OFFSET ?';
    params.push(safeLimit, safeOffset);
    const rows = await queryAll(query, params);
    const formattedRows = await Promise.all(rows.map(async (row) => toPublicReport(await formatReport(row))));
    res.json({ reports: formattedRows, total, limit: safeLimit, offset: safeOffset });
  } catch (err: any) {
    logger.error('report.fetch.failed', { details: [err] });
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, damage_level, crisis_type, since, bbox, crisis_event } = req.query;
    let query = 'FROM reports WHERE 1=1';
    const params: (string | number)[] = [];

    if (status && status !== 'all') { query += ' AND status = ?'; params.push(status as string); }
    if (damage_level && damage_level !== 'all') { query += ' AND damage_level = ?'; params.push(damage_level as string); }
    if (crisis_type) { query += ' AND crisis_type = ?'; params.push(crisis_type as string); }
    if (crisis_event) { query += ' AND crisis_event = ?'; params.push(crisis_event as string); }
    if (since) { query += ' AND submitted_at >= ?'; params.push(since as string); }
    if (bbox) {
      const parsedBbox = parseBbox(String(bbox));
      if (!parsedBbox) {
        res.status(400).json({ error: 'Invalid bbox format. Expected minLng,minLat,maxLng,maxLat' });
        return;
      }
      const [minLng, minLat, maxLng, maxLat] = parsedBbox;
      query += ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?';
      params.push(minLat, maxLat, minLng, maxLng);
    }

    const stats = await queryOne<{
      total: number;
      destroyed: number;
      partial: number;
      minimal: number;
      urgent: number;
      pending: number;
      verified: number;
      flagged: number;
      duplicate: number;
      rejected: number;
    }>(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN damage_level = 'destroyed' THEN 1 ELSE 0 END), 0)::int AS destroyed,
        COALESCE(SUM(CASE WHEN damage_level = 'partial' THEN 1 ELSE 0 END), 0)::int AS partial,
        COALESCE(SUM(CASE WHEN damage_level = 'minimal' THEN 1 ELSE 0 END), 0)::int AS minimal,
        COALESCE(SUM(CASE WHEN CAST(is_urgent AS text) IN ('1', 'true', 't') THEN 1 ELSE 0 END), 0)::int AS urgent,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)::int AS pending,
        COALESCE(SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END), 0)::int AS verified,
        COALESCE(SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END), 0)::int AS flagged,
        COALESCE(SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END), 0)::int AS duplicate,
        COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0)::int AS rejected
      ${query}
    `, params);

    res.json(stats || {
      total: 0,
      destroyed: 0,
      partial: 0,
      minimal: 0,
      urgent: 0,
      pending: 0,
      verified: 0,
      flagged: 0,
      duplicate: 0,
      rejected: 0,
    });
  } catch (err: any) {
    logger.error('report.stats.fetch.failed', { details: [err] });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/locations/:locationId/versions', async (req: Request, res: Response): Promise<void> => {
  const { locationId } = req.params;
  const versions = await queryAll(`
    SELECT
      rv.id as version_id,
      rv.location_id,
      rv.report_id,
      rv.version_number,
      rv.change_type,
      rv.submitted_at,
      rv.payload,
      r.damage_level,
      r.status,
      r.description,
      r.photos,
      r.channel,
      r.community_confirms
    FROM report_versions rv
    LEFT JOIN reports r ON r.id = rv.report_id
    WHERE rv.location_id = ?
    ORDER BY rv.version_number DESC
  `, [locationId]);

  const formatted = versions.map((v: any) => ({
    version_id: v.version_id,
    report_id: v.report_id,
    version_number: v.version_number,
    change_type: v.change_type,
    submitted_at: v.submitted_at,
    damage_level: v.damage_level,
    status: v.status,
    description: v.description,
    channel: v.channel,
    community_confirms: Number(v.community_confirms || 0),
    photos: v.photos,
  }));

  const versionsWithMedia = await Promise.all(formatted.map(async (version) => {
    const media = await resolveReportMedia(version.photos);
    return {
      ...version,
      photos: media.photos,
      photo_count: media.photo_count,
      media_state: media.media_state,
      ai_media_eligibility: media.ai_media_eligibility,
    };
  }));

  res.json({ location_id: locationId, versions: versionsWithMedia });
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const lang = String(req.query.lang || '').toLowerCase();
  const r = await queryOne('SELECT * FROM reports WHERE id = ?', [req.params.id]);
  if (!r) { res.status(404).json({ error: 'Not found' }); return; }
  const formatted = await attachTranslations(await formatReport(r), [lang].filter(Boolean));
  res.json(toPublicReport(await localizeReportDynamicFields(formatted, lang)));
});

router.patch('/:id', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const {
    status,
    internal_notes,
    verified_by,
    lat,
    lng,
    address_text,
    building_label,
    location_capture_mode,
    footprint_set_id,
    footprint_feature_id,
    footprint_feature_key,
  } = req.body;
  const allowed = ['pending', 'verified', 'flagged', 'duplicate', 'rejected'];
  if (status && !allowed.includes(status)) { res.status(400).json({ error: 'Invalid status' }); return; }
  const locationModes = ['gps', 'map', 'manual_coordinates', 'search', 'footprint', 'unknown'];
  if (location_capture_mode !== undefined && !locationModes.includes(String(location_capture_mode))) {
    res.status(400).json({ error: 'Invalid location capture mode' }); return;
  }

  const before = await queryOne<any>('SELECT * FROM reports WHERE id = ?', [req.params.id]);
  if (!before) { res.status(404).json({ error: 'Not found' }); return; }

  const updates: string[] = [];
  const params: (string | number)[] = [];
  if (status) { updates.push('status = ?'); params.push(status); }
  if (internal_notes !== undefined) { updates.push('internal_notes = ?'); params.push(sanitize(internal_notes, 1000)); }
  if (status === 'verified') {
    updates.push('verified_at = ?', 'verified_by = ?');
    params.push(new Date().toISOString(), verified_by || 'admin');
  }

  const wantsLocationUpdate = lat !== undefined
    || lng !== undefined
    || address_text !== undefined
    || building_label !== undefined
    || location_capture_mode !== undefined
    || footprint_set_id !== undefined
    || footprint_feature_id !== undefined
    || footprint_feature_key !== undefined;
  if (wantsLocationUpdate) {
    const parseNullableCoordinate = (value: unknown): number | null => {
      if (value === undefined || value === null) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const beforeLat = parseNullableCoordinate(before.lat);
    const beforeLng = parseNullableCoordinate(before.lng);
    let nextLat = lat !== undefined ? parseNullableCoordinate(lat) : beforeLat;
    let nextLng = lng !== undefined ? parseNullableCoordinate(lng) : beforeLng;
    const nextAddress = address_text !== undefined ? normalizeOptionalAddress(address_text) : normalizeOptionalAddress(before.address_text);
    if (nextLat === null && nextLng === null && nextAddress) {
      const resolved = await resolveAddressCoordinates(nextAddress, String(req.headers['accept-language'] || 'en'));
      if (resolved) {
        nextLat = resolved.lat;
        nextLng = resolved.lng;
      }
    }
    if ((nextLat === null) !== (nextLng === null)) {
      res.status(400).json({ error: 'Invalid coordinates' }); return;
    }
    if ((nextLat !== null && (nextLat < -90 || nextLat > 90)) || (nextLng !== null && (nextLng < -180 || nextLng > 180))) {
      res.status(400).json({ error: 'Invalid coordinates' }); return;
    }

    const nextBuildingLabel = building_label !== undefined ? normalizeOptionalAddress(building_label) : normalizeOptionalAddress(before.building_label);
    const nextCaptureMode = location_capture_mode !== undefined ? String(location_capture_mode) : String(before.location_capture_mode || 'unknown');
    let nextFootprintSetId = footprint_set_id !== undefined ? (sanitize(footprint_set_id, 120) || null) : (before.footprint_set_id || null);
    let nextFootprintFeatureId = footprint_feature_id !== undefined ? (sanitize(footprint_feature_id, 160) || null) : (before.footprint_feature_id || null);
    let nextFootprintFeatureKey = footprint_feature_key !== undefined ? (sanitize(footprint_feature_key, 240) || null) : (before.footprint_feature_key || null);
    const coordinateChanged = nextLat !== beforeLat || nextLng !== beforeLng;
    const spatialChanged =
      coordinateChanged ||
      !sameOptionalText(nextAddress, before.address_text);
    const buildingLabelChanged = !sameOptionalText(nextBuildingLabel, before.building_label);
    if (spatialChanged && footprint_set_id === undefined && footprint_feature_id === undefined && footprint_feature_key === undefined) {
      nextFootprintSetId = null;
      nextFootprintFeatureId = null;
      nextFootprintFeatureKey = null;
    }
    const footprintChanged =
      String(nextFootprintSetId || '') !== String(before.footprint_set_id || '')
      || String(nextFootprintFeatureId || '') !== String(before.footprint_feature_id || '')
      || String(nextFootprintFeatureKey || '') !== String(before.footprint_feature_key || '');
    const locationChanged =
      spatialChanged ||
      buildingLabelChanged ||
      footprintChanged ||
      nextCaptureMode !== String(before.location_capture_mode || 'unknown');

    if (locationChanged) {
      let locationId = String(before.location_id || '');
      let versionNumber: number;
      if (coordinateChanged || footprintChanged) {
        if (nextLat === null || nextLng === null) {
          res.status(400).json({ error: 'Coordinates required for map or footprint reassignment' }); return;
        }
        const nextLocation = await resolveAdminLocationAssignment({
          reportId: req.params.id,
          lat: nextLat,
          lng: nextLng,
          addressText: nextAddress,
          buildingLabel: nextBuildingLabel,
          footprintSetId: nextFootprintSetId,
          footprintFeatureId: nextFootprintFeatureId,
          footprintFeatureKey: nextFootprintFeatureKey,
        });
        locationId = nextLocation.locationId;
        versionNumber = nextLocation.versionNumber;
      } else {
        const nextVersion = await queryOne<{ v: number }>(
          'SELECT COALESCE(MAX(version_number), 0) + 1 AS v FROM reports WHERE location_id = ?',
          [locationId]
        );
        versionNumber = nextVersion?.v || (Number(before.version_number || 1) + 1);
      }

      updates.push(
        'location_id = ?',
        'version_number = ?',
        'location_capture_mode = ?',
        'footprint_set_id = ?',
        'footprint_feature_id = ?',
        'footprint_feature_key = ?',
        'building_label = ?',
        'lat = ?',
        'lng = ?',
        'address_text = ?'
      );
      params.push(
        locationId,
        versionNumber,
        nextCaptureMode,
        nextFootprintSetId,
        nextFootprintFeatureId,
        nextFootprintFeatureKey,
        nextBuildingLabel,
        nextLat,
        nextLng,
        nextAddress
      );

      await execute(
        `UPDATE report_locations
         SET updated_at = NOW(),
             last_report_id = ?,
             lat = ?,
             lng = ?,
             footprint_set_id = ?,
             footprint_feature_id = ?,
             footprint_feature_key = ?,
             building_label = ?,
             address_text = ?
         WHERE id = ?`,
        [
          req.params.id,
          nextLat,
          nextLng,
          nextFootprintSetId,
          nextFootprintFeatureId,
          nextFootprintFeatureKey,
          nextBuildingLabel,
          nextAddress,
          locationId,
        ]
      );

      await execute(
        'INSERT INTO report_versions (id, location_id, report_id, version_number, change_type, payload) VALUES (?, ?, ?, ?, ?, ?)',
        [
          `rv_${req.params.id}_${Date.now()}`,
          locationId,
          req.params.id,
          versionNumber,
          'admin_location_fix',
          JSON.stringify({
            previous: {
              location_id: before.location_id,
              version_number: before.version_number,
              location_capture_mode: before.location_capture_mode,
              footprint_set_id: before.footprint_set_id,
              footprint_feature_id: before.footprint_feature_id,
              footprint_feature_key: before.footprint_feature_key,
              building_label: before.building_label,
              lat: before.lat,
              lng: before.lng,
              address_text: before.address_text,
            },
            next: {
              location_id: locationId,
              version_number: versionNumber,
              location_capture_mode: nextCaptureMode,
              footprint_set_id: nextFootprintSetId,
              footprint_feature_id: nextFootprintFeatureId,
              footprint_feature_key: nextFootprintFeatureKey,
              building_label: nextBuildingLabel,
              lat: nextLat,
              lng: nextLng,
              address_text: nextAddress,
            },
            updated_by: verified_by || 'admin',
          }),
        ]
      );

      if (!sameOptionalText(nextAddress, before.address_text)) {
        await execute("DELETE FROM report_translations WHERE report_id = ? AND field_name = 'address_text'", [req.params.id]);
        if (nextAddress && before.source_language && before.source_language !== DEFAULT_LANGUAGE) {
          await enqueueTranslationJob(req.params.id, DEFAULT_LANGUAGE);
          await setStoredTranslationStatus(req.params.id, 'pending');
        }
      }
    }
  }

  if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.id);
  await execute(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`, params);
  const after = await queryOne<any>('SELECT * FROM reports WHERE id = ?', [req.params.id]);
  if (normalizeOptionalAddress(after?.address_text) && after?.lat === null && after?.lng === null) {
    await upsertGeocodeJob(req.params.id);
  }
  if (status === 'verified' || status === 'duplicate' || status === 'rejected') {
    await applyResolvedAccuracyScore(req.params.id, status, verified_by || 'admin');
  }
  const r = after;
  if (before?.contributor_key) {
    await refreshContributorProfile(before.contributor_key);
  }
  res.json(await attachTranslations(await formatReport(r), []));
});

export { resolveTranslationsForMany };

router.delete('/:id', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const r = await queryOne<{ photos: string; contributor_key?: string; submitter_contact?: string }>('SELECT photos, contributor_key, submitter_contact FROM reports WHERE id = ?', [req.params.id]);
  if (!r) { res.status(404).json({ error: 'Not found' }); return; }
  try {
    await deleteMediaKeys(normalizeStoredPhotoKeys(r.photos).stored_keys);
  } catch {
    // Media cleanup is best-effort after the report record has been deleted.
  }
  await execute('DELETE FROM reports WHERE id = ?', [req.params.id]);
  if (r.contributor_key) {
    await refreshContributorProfile(r.contributor_key);
  }
  res.json({ success: true });
});

router.post('/:id/confirm', requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  const report = await queryOne<{ id: string; country_code?: string }>('SELECT id, country_code FROM reports WHERE id = ?', [req.params.id]);
  if (!report) { res.status(404).json({ error: 'Not found' }); return; }

  // Community confirms feed trust signals, so we bind them to actor and network fingerprints and can
  // optionally require the confirmer to appear in the same country as the reported incident.
  const clientIp = getClientIp(req);
  const ipHash = hashStable(`${CONFIRM_IP_SALT}:${clientIp}`);
  const uaHash = hashStable(String(req.headers['user-agent'] || 'unknown'));
  const requestCountry = getRequestCountry(req);
  const reportCountry = normalizeCountryCode(report.country_code || null);
  const actorKey = sanitize(req.body?.actor_key, 120) || null;

  if (CONFIRM_COUNTRY_ENFORCE && reportCountry && requestCountry && reportCountry !== requestCountry) {
    res.status(403).json({ success: false, status: 'blocked_country', error: 'Country mismatch for confirmation policy' });
    return;
  }

  try {
    await execute(
      'INSERT INTO report_confirmations (id, report_id, actor_key, ip_hash, country_code, user_agent_hash) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), req.params.id, actorKey, ipHash, requestCountry, uaHash]
    );
  } catch (err: any) {
    if (err?.code === '23505') {
      const countRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM report_confirmations WHERE report_id = ?', [req.params.id]);
      res.json({ success: true, status: 'already_confirmed', community_confirms: countRow?.c || 0 });
      return;
    }
    throw err;
  }

  const countRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM report_confirmations WHERE report_id = ?', [req.params.id]);
  const confirms = countRow?.c || 0;
  await execute('UPDATE reports SET community_confirms = ? WHERE id = ?', [confirms, req.params.id]);
  const linkedContributor = actorKey
    ? await queryOne<{ contributor_key: string }>('SELECT contributor_key FROM contributor_identity_aliases WHERE actor_key = ? ORDER BY last_seen_at DESC LIMIT 1', [actorKey])
    : undefined;
  if (linkedContributor?.contributor_key) {
    await refreshContributorProfile(linkedContributor.contributor_key);
  }
  res.json({ success: true, status: 'confirmed', community_confirms: confirms });
});

export const __translationInternals = {
  acquireGeocodeJob,
  deriveTranslationState,
  getGeocodeJob,
  getCachedTranslation,
  getTranslationInFlightKey,
  getTranslationJob,
  getTranslationJobs,
  processGeocodeJob,
  processTranslationJob,
  reconcileCorruptedStoredReportTranslations,
  reconcilePendingGeocodeJobs,
  resolveAddressCoordinatesDetailed,
  translateAndPersistField,
  translateDynamicText,
  upsertGeocodeJob,
};

export default router;

export { attachTranslations, attachTranslationsToMany } from '../reports/translation';
