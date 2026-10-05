import { randomUUID as uuidv4 } from 'node:crypto';
import { execute, queryAll, queryOne } from '../dbRuntime';
import {
  CONTRIBUTOR_REPUTATION_DEFAULTS,
  getContributorReputationSettings,
  type ContributorReputationSettings,
} from './contributorReputationSettings';

export const REPORT_STATUSES = ['pending', 'verified', 'flagged', 'duplicate', 'rejected'] as const;
export type ReportStatus = typeof REPORT_STATUSES[number];

export const BADGE_PRIORITY = [
  'community_hero',
  'trusted_reporter',
  'coverage_champion',
  'recovery_supporter',
  'evidence_quality_award',
  'infrastructure_mapper',
  'early_responder',
  'multilingual_contributor',
  'local_knowledge_contributor',
  'verification_helper',
  'community_observer',
  'new_contributor',
] as const;

export const LEVEL_THRESHOLDS = [
  { code: 'crisis_response_champion', min: CONTRIBUTOR_REPUTATION_DEFAULTS.crisis_response_champion },
  { code: 'community_mapper', min: CONTRIBUTOR_REPUTATION_DEFAULTS.community_mapper },
  { code: 'trusted_contributor', min: CONTRIBUTOR_REPUTATION_DEFAULTS.trusted_contributor },
  { code: 'active_contributor', min: CONTRIBUTOR_REPUTATION_DEFAULTS.active_contributor },
  { code: 'contributor', min: 0 },
] as const;

type ReportReviewInput = {
  accuracy_score?: number | null;
  photo_quality_score?: number | null;
  location_precision_score?: number | null;
  completeness_score?: number | null;
  useful_infrastructure_details?: boolean;
  confirms_existing_damage?: boolean;
  new_coverage_location?: boolean;
  review_notes?: string | null;
  reviewed_by?: string | null;
  manual_overrides?: Record<string, boolean>;
};

type QualityReviewRow = {
  report_id: string;
  accuracy_score: number | null;
  photo_quality_score: number | null;
  location_precision_score: number | null;
  completeness_score: number | null;
  useful_infrastructure_details: boolean;
  confirms_existing_damage: boolean;
  new_coverage_location: boolean;
  review_notes?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  manual_overrides?: unknown;
};

type ContributorProfileRow = {
  contributor_key: string;
  primary_contact?: string | null;
  primary_badge: string;
  level_code: string;
  trust_score: number;
  points_total: number;
  validation_rate: number;
  reports_submitted: number;
  reports_verified: number;
  reports_duplicate: number;
  reports_rejected: number;
  reports_flagged_pending: number;
  suspicious_reports: number;
  confirmations_made: number;
  distinct_infra_types: number;
  distinct_languages: number;
  distinct_crises: number;
  new_coverage_reports: number;
  useful_detail_reports: number;
  high_quality_verified_reports: number;
  first_verified_at?: string | null;
  last_submitted_at?: string | null;
  last_engaged_at?: string | null;
  updated_at?: string | null;
};

type BadgeAwardRow = {
  id: string;
  badge_code: string;
  award_source: string;
  report_id?: string | null;
  awarded_at: string;
  awarded_by?: string | null;
  reason?: string | null;
  revoked_at?: string | null;
};

type ScoreEventRow = {
  id: string;
  event_code: string;
  points_delta: number;
  report_id?: string | null;
  source_ref: string;
  created_at: string;
};

function safeParseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Reputation metadata can be partially missing; fall back to an empty object.
  }
  return {};
}

function clampScore(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function cleanText(value: unknown, max = 1000): string | null {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

export function computeLevel(
  pointsTotal: number,
  thresholds: Pick<ContributorReputationSettings, 'active_contributor' | 'trusted_contributor' | 'community_mapper' | 'crisis_response_champion'> = CONTRIBUTOR_REPUTATION_DEFAULTS
): string {
  return [
    { code: 'crisis_response_champion', min: thresholds.crisis_response_champion },
    { code: 'community_mapper', min: thresholds.community_mapper },
    { code: 'trusted_contributor', min: thresholds.trusted_contributor },
    { code: 'active_contributor', min: thresholds.active_contributor },
    { code: 'contributor', min: 0 },
  ].find((entry) => pointsTotal >= entry.min)?.code || 'contributor';
}

export function computeWeightedQuality(
  row: QualityReviewRow,
  weights: Pick<ContributorReputationSettings, 'accuracy_weight' | 'photo_weight' | 'location_weight' | 'completeness_weight'> = CONTRIBUTOR_REPUTATION_DEFAULTS
): number | null {
  const accuracy = clampScore(row.accuracy_score);
  const photo = clampScore(row.photo_quality_score);
  const location = clampScore(row.location_precision_score);
  const completeness = clampScore(row.completeness_score);
  if ([accuracy, photo, location, completeness].some((value) => value === null)) return null;
  return Math.round(
    (accuracy! * weights.accuracy_weight) +
    (photo! * weights.photo_weight) +
    (location! * weights.location_weight) +
    (completeness! * weights.completeness_weight)
  );
}

export function pickPrimaryBadge(badges: string[]): string {
  return BADGE_PRIORITY.find((badge) => badges.includes(badge)) || 'none';
}

export function buildBadgeSet(stats: {
  reportsVerified: number;
  validationRate: number;
  distinctInfraTypes: number;
  distinctLanguages: number;
  distinctCrises: number;
  newCoverageReports: number;
  usefulDetailReports: number;
  highQualityVerifiedReports: number;
  confirmationsMade: number;
  firstVerifiedExists: boolean;
  earlyResponder: boolean;
  hasCommunityHero: boolean;
}, settings: Pick<ContributorReputationSettings,
  | 'community_observer_reports_verified'
  | 'trusted_reporter_reports_verified'
  | 'trusted_reporter_validation_rate'
  | 'infrastructure_mapper_distinct_types'
  | 'multilingual_contributor_distinct_languages'
  | 'coverage_champion_new_coverage_reports'
  | 'evidence_quality_award_high_quality_reports'
  | 'recovery_supporter_distinct_crises'
  | 'local_knowledge_contributor_useful_detail_reports'
  | 'verification_helper_confirmations'
> = CONTRIBUTOR_REPUTATION_DEFAULTS): string[] {
  const badges = new Set<string>();
  if (stats.firstVerifiedExists) badges.add('new_contributor');
  if (stats.reportsVerified >= settings.community_observer_reports_verified) badges.add('community_observer');
  if (stats.reportsVerified >= settings.trusted_reporter_reports_verified && stats.validationRate >= settings.trusted_reporter_validation_rate) badges.add('trusted_reporter');
  if (stats.distinctInfraTypes >= settings.infrastructure_mapper_distinct_types) badges.add('infrastructure_mapper');
  if (stats.earlyResponder) badges.add('early_responder');
  if (stats.distinctLanguages >= settings.multilingual_contributor_distinct_languages) badges.add('multilingual_contributor');
  if (stats.newCoverageReports >= settings.coverage_champion_new_coverage_reports) badges.add('coverage_champion');
  if (stats.highQualityVerifiedReports >= settings.evidence_quality_award_high_quality_reports) badges.add('evidence_quality_award');
  if (stats.distinctCrises >= settings.recovery_supporter_distinct_crises) badges.add('recovery_supporter');
  if (stats.usefulDetailReports >= settings.local_knowledge_contributor_useful_detail_reports) badges.add('local_knowledge_contributor');
  if (stats.confirmationsMade >= settings.verification_helper_confirmations) badges.add('verification_helper');
  if (stats.hasCommunityHero) badges.add('community_hero');
  return Array.from(badges);
}

export async function ensureContributorAlias(contributorKey: string, actorKey: string | null | undefined, source: string): Promise<void> {
  const cleanActorKey = String(actorKey || '').trim();
  if (!contributorKey || !cleanActorKey) return;
  await execute(`
    INSERT INTO contributor_identity_aliases (contributor_key, actor_key, source, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, NOW(), NOW())
    ON CONFLICT (contributor_key, actor_key) DO UPDATE SET
      source = EXCLUDED.source,
      last_seen_at = NOW()
  `, [contributorKey, cleanActorKey, cleanText(source, 50) || 'web']);
}

export function computeCompletenessScore(params: {
  addressText?: string | null;
  infraName?: string | null;
  description?: string | null;
  pressingNeeds?: unknown[];
  photosCount?: number;
  infraTypes?: unknown[];
}): number {
  let score = 10;
  if (cleanText(params.addressText, 200)) score += 20;
  if (Array.isArray(params.infraTypes) && params.infraTypes.filter(Boolean).length > 0) score += 15;
  if (cleanText(params.infraName, 200)) score += 10;
  if (cleanText(params.description, 500)) score += 25;
  if (Array.isArray(params.pressingNeeds) && params.pressingNeeds.filter(Boolean).length > 0) score += 10;
  if ((params.photosCount || 0) > 0) score += Math.min(20, (params.photosCount || 0) * 5);
  return Math.max(0, Math.min(100, score));
}

export function computeLocationPrecisionScore(params: {
  locationCaptureMode?: string | null;
  lat?: number;
  lng?: number;
}): number {
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
  if (params.locationCaptureMode === 'gps') return 95;
  if (params.locationCaptureMode === 'map') return 85;
  if (params.locationCaptureMode === 'manual_coordinates') return 75;
  if (params.locationCaptureMode === 'search') return 70;
  return 60;
}

export async function ensureReportQualityStub(reportId: string, values: {
  addressText?: string | null;
  infraName?: string | null;
  description?: string | null;
  pressingNeeds?: unknown[];
  photosCount?: number;
  infraTypes?: unknown[];
  locationCaptureMode?: string | null;
  lat?: number;
  lng?: number;
  newCoverageLocation?: boolean;
}): Promise<void> {
  const completeness = computeCompletenessScore(values);
  const locationPrecision = computeLocationPrecisionScore(values);
  const photoQuality = values.photosCount && values.photosCount > 0
    ? Math.min(100, 40 + Math.min(40, values.photosCount * 12))
    : 0;
  await execute(`
    INSERT INTO report_quality_reviews (
      report_id, photo_quality_score, location_precision_score, completeness_score,
      new_coverage_location, manual_overrides, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '{}'::jsonb, NOW(), NOW())
    ON CONFLICT (report_id) DO UPDATE SET
      photo_quality_score = COALESCE(report_quality_reviews.photo_quality_score, EXCLUDED.photo_quality_score),
      location_precision_score = COALESCE(report_quality_reviews.location_precision_score, EXCLUDED.location_precision_score),
      completeness_score = COALESCE(report_quality_reviews.completeness_score, EXCLUDED.completeness_score),
      new_coverage_location = report_quality_reviews.new_coverage_location OR EXCLUDED.new_coverage_location,
      updated_at = NOW()
  `, [reportId, photoQuality, locationPrecision, completeness, values.newCoverageLocation ? 1 : 0]);
}

export async function syncReportPhotoQualityFromAi(reportId: string, confidence: number, photoCount: number): Promise<void> {
  const boundedConfidence = Math.max(0, Math.min(1, Number(confidence) || 0));
  const nextScore = Math.round(Math.min(100, 25 + (photoCount * 10) + (boundedConfidence * 40)));
  await execute(`
    UPDATE report_quality_reviews
    SET photo_quality_score = CASE
      WHEN COALESCE((manual_overrides->>'photo_quality_score')::boolean, false) THEN photo_quality_score
      ELSE ?
    END,
    updated_at = NOW()
    WHERE report_id = ?
  `, [nextScore, reportId]);
}

export async function saveReputationReview(reportId: string, input: ReportReviewInput): Promise<QualityReviewRow | undefined> {
  const manualOverrides = safeParseObject(input.manual_overrides);
  await execute(`
    INSERT INTO report_quality_reviews (
      report_id, accuracy_score, photo_quality_score, location_precision_score, completeness_score,
      useful_infrastructure_details, confirms_existing_damage, new_coverage_location,
      review_notes, reviewed_by, reviewed_at, manual_overrides, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?::jsonb, NOW(), NOW())
    ON CONFLICT (report_id) DO UPDATE SET
      accuracy_score = COALESCE(EXCLUDED.accuracy_score, report_quality_reviews.accuracy_score),
      photo_quality_score = COALESCE(EXCLUDED.photo_quality_score, report_quality_reviews.photo_quality_score),
      location_precision_score = COALESCE(EXCLUDED.location_precision_score, report_quality_reviews.location_precision_score),
      completeness_score = COALESCE(EXCLUDED.completeness_score, report_quality_reviews.completeness_score),
      useful_infrastructure_details = EXCLUDED.useful_infrastructure_details,
      confirms_existing_damage = EXCLUDED.confirms_existing_damage,
      new_coverage_location = EXCLUDED.new_coverage_location,
      review_notes = EXCLUDED.review_notes,
      reviewed_by = EXCLUDED.reviewed_by,
      reviewed_at = NOW(),
      manual_overrides = EXCLUDED.manual_overrides,
      updated_at = NOW()
  `, [
    reportId,
    clampScore(input.accuracy_score),
    clampScore(input.photo_quality_score),
    clampScore(input.location_precision_score),
    clampScore(input.completeness_score),
    input.useful_infrastructure_details ? 1 : 0,
    input.confirms_existing_damage ? 1 : 0,
    input.new_coverage_location ? 1 : 0,
    cleanText(input.review_notes, 1000),
    cleanText(input.reviewed_by, 120),
    JSON.stringify(manualOverrides),
  ]);
  return queryOne<QualityReviewRow>('SELECT * FROM report_quality_reviews WHERE report_id = ?', [reportId]);
}

export async function applyResolvedAccuracyScore(reportId: string, status: ReportStatus, reviewedBy?: string | null): Promise<void> {
  if (!['verified', 'duplicate', 'rejected'].includes(status)) return;
  const accuracy = status === 'verified' ? 100 : 0;
  await saveReputationReview(reportId, {
    accuracy_score: accuracy,
    reviewed_by: reviewedBy || null,
    manual_overrides: { accuracy_score: false },
  });
}

async function syncBadgeAwards(contributorKey: string, autoBadges: string[]): Promise<void> {
  const activeAwards = await queryAll<BadgeAwardRow>(
    'SELECT * FROM contributor_badge_awards WHERE contributor_key = ? AND revoked_at IS NULL',
    [contributorKey]
  );
  const manualAwards = activeAwards.filter((award) => award.award_source === 'admin_manual').map((award) => award.badge_code);
  const desired = new Set([...autoBadges, ...manualAwards]);

  for (const badge of autoBadges) {
    await execute(`
      INSERT INTO contributor_badge_awards (id, contributor_key, badge_code, awarded_at, award_source)
      VALUES (?, ?, ?, NOW(), 'system')
      ON CONFLICT DO NOTHING
    `, [uuidv4(), contributorKey, badge]);
  }

  for (const award of activeAwards) {
    if (award.award_source === 'admin_manual') continue;
    if (!desired.has(award.badge_code)) {
      await execute(
        'UPDATE contributor_badge_awards SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL',
        [award.id]
      );
    }
  }
}

export async function recomputeContributorProfile(contributorKey: string): Promise<ContributorProfileRow | undefined> {
  const contributor = await queryOne<{ contributor_key: string; submitter_contact?: string | null }>(
    'SELECT contributor_key, MAX(submitter_contact) AS submitter_contact FROM reports WHERE contributor_key = ? GROUP BY contributor_key',
    [contributorKey]
  );
  if (!contributor?.contributor_key) {
    await execute('DELETE FROM contributor_profiles WHERE contributor_key = ?', [contributorKey]);
    return undefined;
  }
  const reputationSettings = await getContributorReputationSettings();

  const reports = await queryAll<any>(`
    SELECT
      r.id, r.location_id, r.version_number, r.status, r.submitted_at, r.crisis_event, r.infra_types, r.infra_name,
      r.source_language, r.location_capture_mode, r.lat, r.lng, r.moderation_flags,
      q.accuracy_score, q.photo_quality_score, q.location_precision_score, q.completeness_score,
      q.useful_infrastructure_details, q.confirms_existing_damage, q.new_coverage_location,
      ce.started_at AS crisis_started_at
    FROM reports r
    LEFT JOIN report_quality_reviews q ON q.report_id = r.id
    LEFT JOIN crisis_events ce ON ce.id = r.crisis_event
    WHERE r.contributor_key = ?
    ORDER BY r.submitted_at DESC
  `, [contributorKey]);

  const reportsSubmitted = reports.length;
  const reportsVerified = reports.filter((report) => report.status === 'verified').length;
  const reportsDuplicate = reports.filter((report) => report.status === 'duplicate').length;
  const reportsRejected = reports.filter((report) => report.status === 'rejected').length;
  const reportsFlaggedPending = reports.filter((report) => report.status === 'flagged').length;
  const suspiciousReports = reports.filter((report) => {
    const flags = safeParseObject({ list: report.moderation_flags }).list;
    return Array.isArray(flags) ? flags.length > 0 : String(report.moderation_flags || '').includes('[');
  }).length;
  const lastSubmittedAt = reports[0]?.submitted_at || null;

  const activeAliases = await queryAll<{ actor_key: string }>(
    'SELECT actor_key FROM contributor_identity_aliases WHERE contributor_key = ?',
    [contributorKey]
  );
  const actorKeys = activeAliases.map((alias) => alias.actor_key);
  const confirmationsMade = actorKeys.length
    ? (await queryOne<{ c: number }>(
      `SELECT COUNT(DISTINCT report_id) AS c FROM report_confirmations WHERE actor_key = ANY($1)`,
      [actorKeys]
    ))?.c || 0
    : 0;

  const distinctInfraTypes = new Set<string>();
  const distinctLanguages = new Set<string>();
  const distinctCrises = new Set<string>();
  let firstVerifiedAt: string | null = null;
  let newCoverageReports = 0;
  let usefulDetailReports = 0;
  let highQualityVerifiedReports = 0;
  let earlyResponder = false;

  const resolvedQualityRows = reports
    .filter((report) => ['verified', 'duplicate', 'rejected'].includes(report.status))
    .slice(0, 20)
    .map((report) => ({
      report_id: report.id,
      accuracy_score: clampScore(report.accuracy_score),
      photo_quality_score: clampScore(report.photo_quality_score),
      location_precision_score: clampScore(report.location_precision_score),
      completeness_score: clampScore(report.completeness_score),
      useful_infrastructure_details: Boolean(report.useful_infrastructure_details),
      confirms_existing_damage: Boolean(report.confirms_existing_damage),
      new_coverage_location: Boolean(report.new_coverage_location),
    } as QualityReviewRow));
  const resolvedQualityScores = resolvedQualityRows
    .map((row) => computeWeightedQuality(row, reputationSettings))
    .filter((value): value is number => value !== null);
  const trustScore = resolvedQualityScores.length
    ? Math.round(resolvedQualityScores.reduce((sum, value) => sum + value, 0) / resolvedQualityScores.length)
    : 0;

  for (const report of reports) {
    if (report.status !== 'verified') continue;
    if (!firstVerifiedAt || new Date(report.submitted_at).getTime() < new Date(firstVerifiedAt).getTime()) {
      firstVerifiedAt = report.submitted_at;
    }
    const infraTypes = Array.isArray(report.infra_types)
      ? report.infra_types
      : (() => {
          try { return JSON.parse(String(report.infra_types || '[]')); } catch { return []; }
        })();
    for (const type of infraTypes) {
      if (type) distinctInfraTypes.add(String(type));
    }
    if (report.source_language) distinctLanguages.add(String(report.source_language));
    if (report.crisis_event) distinctCrises.add(String(report.crisis_event));
    if (report.new_coverage_location) newCoverageReports += 1;
    if (report.useful_infrastructure_details && cleanText(report.infra_name, 200)) usefulDetailReports += 1;
    const weighted = computeWeightedQuality({
      report_id: report.id,
      accuracy_score: report.accuracy_score,
      photo_quality_score: report.photo_quality_score,
      location_precision_score: report.location_precision_score,
      completeness_score: report.completeness_score,
      useful_infrastructure_details: Boolean(report.useful_infrastructure_details),
      confirms_existing_damage: Boolean(report.confirms_existing_damage),
      new_coverage_location: Boolean(report.new_coverage_location),
    }, reputationSettings);
    if (
      weighted !== null &&
      weighted >= reputationSettings.high_quality_min_weighted_score &&
      (report.photo_quality_score || 0) >= reputationSettings.high_quality_min_photo_score &&
      (report.completeness_score || 0) >= reputationSettings.high_quality_min_completeness_score
    ) {
      highQualityVerifiedReports += 1;
    }
    if (report.crisis_started_at) {
      const delta = new Date(report.submitted_at).getTime() - new Date(report.crisis_started_at).getTime();
      if (delta >= 0 && delta <= (72 * 60 * 60 * 1000)) earlyResponder = true;
    }
  }

  const resolvedCount = reportsVerified + reportsDuplicate + reportsRejected;
  const validationRate = resolvedCount > 0 ? reportsVerified / resolvedCount : 0;

  const hasCommunityHero = Boolean((await queryOne<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM contributor_badge_awards WHERE contributor_key = ? AND badge_code = 'community_hero' AND revoked_at IS NULL",
    [contributorKey]
  ))?.c);

  const scoreSpecs = [
    reportsVerified > 0 ? { ref: `${contributorKey}:first_verified_report`, event: 'first_verified_report', delta: reputationSettings.first_verified_report, reportId: reports.find((report) => report.status === 'verified')?.id || null } : null,
    ...reports
      .filter((report) => report.status === 'verified')
      .map((report) => {
        const review = {
          report_id: report.id,
          accuracy_score: report.accuracy_score,
          photo_quality_score: report.photo_quality_score,
          location_precision_score: report.location_precision_score,
          completeness_score: report.completeness_score,
          useful_infrastructure_details: Boolean(report.useful_infrastructure_details),
          confirms_existing_damage: Boolean(report.confirms_existing_damage),
          new_coverage_location: Boolean(report.new_coverage_location),
        } as QualityReviewRow;
        const weighted = computeWeightedQuality(review, reputationSettings);
        const events: Array<{ ref: string; event: string; delta: number; reportId: string }> = [];
        if (weighted !== null && weighted >= reputationSettings.high_quality_min_weighted_score) events.push({ ref: `${report.id}:high_quality_verified_report`, event: 'high_quality_verified_report', delta: reputationSettings.high_quality_verified_report, reportId: report.id });
        if (report.version_number > 1 && report.confirms_existing_damage) events.push({ ref: `${report.id}:confirmed_existing_damage_update`, event: 'confirmed_existing_damage_update', delta: reputationSettings.confirmed_existing_damage_update, reportId: report.id });
        if (report.new_coverage_location) events.push({ ref: `${report.id}:previously_unmapped_location`, event: 'previously_unmapped_location', delta: reputationSettings.previously_unmapped_location, reportId: report.id });
        if (report.useful_infrastructure_details && cleanText(report.infra_name, 200)) events.push({ ref: `${report.id}:useful_infrastructure_details`, event: 'useful_infrastructure_details', delta: reputationSettings.useful_infrastructure_details, reportId: report.id });
        return events;
      })
      .flat(),
    ...reports
      .filter((report) => report.status === 'duplicate')
      .map((report) => ({ ref: `${report.id}:duplicate_report`, event: 'duplicate_report', delta: reputationSettings.duplicate_report, reportId: report.id })),
    ...reports
      .filter((report) => report.status === 'rejected')
      .map((report) => ({ ref: `${report.id}:rejected_report`, event: 'rejected_report', delta: reputationSettings.rejected_report, reportId: report.id })),
  ].filter(Boolean) as Array<{ ref: string; event: string; delta: number; reportId: string | null }>;

  const activeSourceRefs = new Set<string>(scoreSpecs.map((item) => item.ref));
  const existingEvents = await queryAll<ScoreEventRow>('SELECT * FROM contributor_score_events WHERE contributor_key = ?', [contributorKey]);
  for (const spec of scoreSpecs) {
    await execute(`
      INSERT INTO contributor_score_events (id, contributor_key, event_code, points_delta, report_id, source_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      ON CONFLICT (source_ref) DO NOTHING
    `, [uuidv4(), contributorKey, spec.event, spec.delta, spec.reportId, spec.ref]);
  }
  for (const event of existingEvents) {
    if (!activeSourceRefs.has(event.source_ref)) {
      await execute('DELETE FROM contributor_score_events WHERE id = ?', [event.id]);
    }
  }
  const pointsTotal = (await queryOne<{ total: number }>(
    'SELECT COALESCE(SUM(points_delta), 0)::int AS total FROM contributor_score_events WHERE contributor_key = ?',
    [contributorKey]
  ))?.total || 0;

  const autoBadges = buildBadgeSet({
    reportsVerified,
    validationRate,
    distinctInfraTypes: distinctInfraTypes.size,
    distinctLanguages: distinctLanguages.size,
    distinctCrises: distinctCrises.size,
    newCoverageReports,
    usefulDetailReports,
    highQualityVerifiedReports,
    confirmationsMade,
    firstVerifiedExists: reportsVerified > 0,
    earlyResponder,
    hasCommunityHero,
  }, reputationSettings);
  await syncBadgeAwards(contributorKey, autoBadges);
  const activeAwards = await queryAll<BadgeAwardRow>(
    'SELECT * FROM contributor_badge_awards WHERE contributor_key = ? AND revoked_at IS NULL ORDER BY awarded_at DESC',
    [contributorKey]
  );
  const badges = activeAwards.map((award) => award.badge_code);
  const primaryBadge = pickPrimaryBadge(badges);
  const levelCode = computeLevel(pointsTotal, reputationSettings);

  await execute(`
    INSERT INTO contributor_profiles (
      contributor_key, primary_contact, primary_badge, level_code, trust_score, points_total, validation_rate,
      reports_submitted, reports_verified, reports_duplicate, reports_rejected, reports_flagged_pending,
      duplicate_reports, flagged_reports, suspicious_reports, confirmations_made, distinct_infra_types,
      distinct_languages, distinct_crises, new_coverage_reports, useful_detail_reports, high_quality_verified_reports,
      badge, first_verified_at, last_submitted_at, last_engaged_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON CONFLICT (contributor_key) DO UPDATE SET
      primary_contact = EXCLUDED.primary_contact,
      primary_badge = EXCLUDED.primary_badge,
      level_code = EXCLUDED.level_code,
      trust_score = EXCLUDED.trust_score,
      points_total = EXCLUDED.points_total,
      validation_rate = EXCLUDED.validation_rate,
      reports_submitted = EXCLUDED.reports_submitted,
      reports_verified = EXCLUDED.reports_verified,
      reports_duplicate = EXCLUDED.reports_duplicate,
      reports_rejected = EXCLUDED.reports_rejected,
      reports_flagged_pending = EXCLUDED.reports_flagged_pending,
      duplicate_reports = EXCLUDED.duplicate_reports,
      flagged_reports = EXCLUDED.flagged_reports,
      suspicious_reports = EXCLUDED.suspicious_reports,
      confirmations_made = EXCLUDED.confirmations_made,
      distinct_infra_types = EXCLUDED.distinct_infra_types,
      distinct_languages = EXCLUDED.distinct_languages,
      distinct_crises = EXCLUDED.distinct_crises,
      new_coverage_reports = EXCLUDED.new_coverage_reports,
      useful_detail_reports = EXCLUDED.useful_detail_reports,
      high_quality_verified_reports = EXCLUDED.high_quality_verified_reports,
      badge = EXCLUDED.badge,
      first_verified_at = EXCLUDED.first_verified_at,
      last_submitted_at = EXCLUDED.last_submitted_at,
      last_engaged_at = EXCLUDED.last_engaged_at,
      updated_at = NOW()
  `, [
    contributorKey,
    contributor.submitter_contact || null,
    primaryBadge,
    levelCode,
    trustScore,
    pointsTotal,
    validationRate,
    reportsSubmitted,
    reportsVerified,
    reportsDuplicate,
    reportsRejected,
    reportsFlaggedPending,
    reportsDuplicate,
    reportsFlaggedPending,
    suspiciousReports,
    confirmationsMade,
    distinctInfraTypes.size,
    distinctLanguages.size,
    distinctCrises.size,
    newCoverageReports,
    usefulDetailReports,
    highQualityVerifiedReports,
    primaryBadge,
    firstVerifiedAt,
    lastSubmittedAt,
    lastSubmittedAt,
  ]);

  await execute('UPDATE reports SET contributor_badge = ? WHERE contributor_key = ?', [primaryBadge, contributorKey]);
  return queryOne<ContributorProfileRow>('SELECT * FROM contributor_profiles WHERE contributor_key = ?', [contributorKey]);
}

export async function recomputeAllContributorProfiles(): Promise<number> {
  const contributors = await queryAll<{ contributor_key: string }>(
    'SELECT DISTINCT contributor_key FROM reports WHERE contributor_key IS NOT NULL AND contributor_key <> \'\''
  );
  for (const contributor of contributors) {
    await recomputeContributorProfile(contributor.contributor_key);
  }
  return contributors.length;
}

export async function getContributorList(params: {
  search?: string;
  badge?: string;
  level?: string;
  minTrust?: number;
  minPoints?: number;
  limit?: number;
  offset?: number;
}) {
  let sql = 'SELECT * FROM contributor_profiles WHERE 1=1';
  const queryParams: any[] = [];
  if (params.search) {
    const search = `%${params.search}%`;
    sql += ' AND (contributor_key LIKE ? OR COALESCE(primary_contact, \'\') LIKE ?)';
    queryParams.push(search, search);
  }
  if (params.badge && params.badge !== 'all') {
    sql += ' AND primary_badge = ?';
    queryParams.push(params.badge);
  }
  if (params.level && params.level !== 'all') {
    sql += ' AND level_code = ?';
    queryParams.push(params.level);
  }
  if (params.minTrust !== undefined) {
    sql += ' AND trust_score >= ?';
    queryParams.push(params.minTrust);
  }
  if (params.minPoints !== undefined) {
    sql += ' AND points_total >= ?';
    queryParams.push(params.minPoints);
  }
  const total = (await queryOne<{ c: number }>(sql.replace('SELECT *', 'SELECT COUNT(*)::int AS c'), queryParams))?.c || 0;
  sql += ' ORDER BY trust_score DESC, points_total DESC, updated_at DESC LIMIT ? OFFSET ?';
  queryParams.push(params.limit || 50, params.offset || 0);
  const contributors = await queryAll<ContributorProfileRow>(sql, queryParams);
  return { contributors, total };
}

export async function getContributorDetail(contributorKey: string) {
  const profile = await queryOne<ContributorProfileRow>('SELECT * FROM contributor_profiles WHERE contributor_key = ?', [contributorKey]);
  if (!profile) return null;
  const badges = await queryAll<BadgeAwardRow>(
    'SELECT * FROM contributor_badge_awards WHERE contributor_key = ? ORDER BY awarded_at DESC',
    [contributorKey]
  );
  const scoreEvents = await queryAll<ScoreEventRow>(
    'SELECT * FROM contributor_score_events WHERE contributor_key = ? ORDER BY created_at DESC',
    [contributorKey]
  );
  const aliases = await queryAll<{ actor_key: string; source: string; first_seen_at: string; last_seen_at: string }>(
    'SELECT actor_key, source, first_seen_at, last_seen_at FROM contributor_identity_aliases WHERE contributor_key = ? ORDER BY last_seen_at DESC',
    [contributorKey]
  );
  const linkedUser = await queryOne<{ id: string; name: string; email: string; phone?: string | null; verified_phone?: string | null }>(`
    SELECT u.id, u.name, u.email, u.phone, upv.phone_e164 AS verified_phone
    FROM user_contributor_links ucl
    JOIN users u ON u.id = ucl.user_id
    LEFT JOIN user_phone_verifications upv ON upv.user_id = ucl.user_id
    WHERE ucl.contributor_key = ?
    LIMIT 1
  `, [contributorKey]);
  const mergeHistory = await queryAll<{ source_contributor_key: string; merged_at: string; merged_by?: string | null; reason?: string | null }>(
    'SELECT source_contributor_key, merged_at, merged_by, reason FROM contributor_merges WHERE target_contributor_key = ? ORDER BY merged_at DESC',
    [contributorKey]
  );
  const reports = await queryAll<any>(`
    SELECT r.id, r.status, r.damage_level, r.submitted_at, r.community_confirms, r.address_text,
      q.accuracy_score, q.photo_quality_score, q.location_precision_score, q.completeness_score
    FROM reports r
    LEFT JOIN report_quality_reviews q ON q.report_id = r.id
    WHERE r.contributor_key = ?
    ORDER BY r.submitted_at DESC
    LIMIT 20
  `, [contributorKey]);
  const confirmations = aliases.length
    ? await queryAll<any>(
      `SELECT report_id, actor_key, created_at FROM report_confirmations WHERE actor_key = ANY($1) ORDER BY created_at DESC LIMIT 20`,
      [aliases.map((alias) => alias.actor_key)]
    )
    : [];
  return { profile, badges, score_events: scoreEvents, aliases, linked_user: linkedUser || null, merge_history: mergeHistory, recent_reports: reports, confirmations };
}

export async function grantManualBadge(contributorKey: string, badgeCode: string, awardedBy: string, reason: string): Promise<void> {
  const activeAward = await queryOne<{ id: string }>(
    "SELECT id FROM contributor_badge_awards WHERE contributor_key = ? AND badge_code = ? AND award_source = 'admin_manual' AND revoked_at IS NULL LIMIT 1",
    [contributorKey, badgeCode]
  );
  if (!activeAward) {
    const revokedAward = await queryOne<{ id: string }>(
      "SELECT id FROM contributor_badge_awards WHERE contributor_key = ? AND badge_code = ? AND award_source = 'admin_manual' AND revoked_at IS NOT NULL ORDER BY awarded_at DESC LIMIT 1",
      [contributorKey, badgeCode]
    );
    if (revokedAward?.id) {
      await execute(
        "UPDATE contributor_badge_awards SET revoked_at = NULL, awarded_at = NOW(), awarded_by = ?, reason = ? WHERE id = ?",
        [cleanText(awardedBy, 120), cleanText(reason, 500), revokedAward.id]
      );
      await recomputeContributorProfile(contributorKey);
      return;
    }
  } else {
    await recomputeContributorProfile(contributorKey);
    return;
  }
  await execute(`
    INSERT INTO contributor_badge_awards (id, contributor_key, badge_code, awarded_at, award_source, awarded_by, reason)
    VALUES (?, ?, ?, NOW(), 'admin_manual', ?, ?)
    ON CONFLICT DO NOTHING
  `, [uuidv4(), contributorKey, badgeCode, cleanText(awardedBy, 120), cleanText(reason, 500)]);
  await recomputeContributorProfile(contributorKey);
}

export async function revokeManualBadge(contributorKey: string, badgeCode: string): Promise<void> {
  await execute(
    "UPDATE contributor_badge_awards SET revoked_at = NOW() WHERE contributor_key = ? AND badge_code = ? AND award_source = 'admin_manual' AND revoked_at IS NULL",
    [contributorKey, badgeCode]
  );
  await recomputeContributorProfile(contributorKey);
}
