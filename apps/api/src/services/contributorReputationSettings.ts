import { execute, queryAll } from '../dbRuntime';

export const CONTRIBUTOR_REPUTATION_DEFAULTS = {
  accuracy_weight: 0.4,
  photo_weight: 0.25,
  location_weight: 0.2,
  completeness_weight: 0.15,
  active_contributor: 50,
  trusted_contributor: 150,
  community_mapper: 400,
  crisis_response_champion: 800,
  first_verified_report: 10,
  high_quality_verified_report: 5,
  confirmed_existing_damage_update: 3,
  previously_unmapped_location: 8,
  useful_infrastructure_details: 2,
  duplicate_report: 0,
  rejected_report: -5,
  community_observer_reports_verified: 5,
  trusted_reporter_reports_verified: 20,
  trusted_reporter_validation_rate: 0.85,
  infrastructure_mapper_distinct_types: 5,
  multilingual_contributor_distinct_languages: 2,
  coverage_champion_new_coverage_reports: 3,
  evidence_quality_award_high_quality_reports: 5,
  recovery_supporter_distinct_crises: 2,
  local_knowledge_contributor_useful_detail_reports: 5,
  verification_helper_confirmations: 5,
  high_quality_min_weighted_score: 85,
  high_quality_min_photo_score: 80,
  high_quality_min_completeness_score: 80,
} as const;

export type ContributorReputationSettings = typeof CONTRIBUTOR_REPUTATION_DEFAULTS;

const FLOAT_KEYS = new Set<keyof ContributorReputationSettings>([
  'accuracy_weight',
  'photo_weight',
  'location_weight',
  'completeness_weight',
  'trusted_reporter_validation_rate',
]);

async function ensureContributorReputationSettingsDefaults(): Promise<void> {
  for (const [key, value] of Object.entries(CONTRIBUTOR_REPUTATION_DEFAULTS)) {
    await execute(
      'INSERT INTO contributor_reputation_settings (key, value, updated_at) VALUES (?, ?, NOW()) ON CONFLICT (key) DO NOTHING',
      [key, String(value)]
    );
  }
}

function normalizeValue(key: keyof ContributorReputationSettings, raw: unknown): number {
  const fallback = CONTRIBUTOR_REPUTATION_DEFAULTS[key];
  const parsed = FLOAT_KEYS.has(key)
    ? Number.parseFloat(String(raw ?? ''))
    : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (FLOAT_KEYS.has(key)) {
    return parsed > 0 ? parsed : fallback;
  }
  return parsed >= 0 ? parsed : fallback;
}

export async function getContributorReputationSettings(): Promise<ContributorReputationSettings> {
  await ensureContributorReputationSettingsDefaults();
  const rows = await queryAll<{ key: keyof ContributorReputationSettings; value: string }>(
    'SELECT key, value FROM contributor_reputation_settings'
  );
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Partial<Record<keyof ContributorReputationSettings, string>>;
  return Object.fromEntries(
    (Object.keys(CONTRIBUTOR_REPUTATION_DEFAULTS) as Array<keyof ContributorReputationSettings>).map((key) => [
      key,
      normalizeValue(key, stored[key]),
    ])
  ) as ContributorReputationSettings;
}

export async function updateContributorReputationSettings(
  updates: Partial<Record<keyof ContributorReputationSettings, unknown>>
): Promise<ContributorReputationSettings> {
  await ensureContributorReputationSettingsDefaults();
  for (const key of Object.keys(updates) as Array<keyof ContributorReputationSettings>) {
    if (!(key in CONTRIBUTOR_REPUTATION_DEFAULTS)) continue;
    const nextValue = normalizeValue(key, updates[key]);
    await execute(
      `INSERT INTO contributor_reputation_settings (key, value, updated_at)
       VALUES (?, ?, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [key, String(nextValue)]
    );
  }
  return getContributorReputationSettings();
}

export async function resetContributorReputationSettings(): Promise<ContributorReputationSettings> {
  for (const [key, value] of Object.entries(CONTRIBUTOR_REPUTATION_DEFAULTS)) {
    await execute(
      `INSERT INTO contributor_reputation_settings (key, value, updated_at)
       VALUES (?, ?, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [key, String(value)]
    );
  }
  return getContributorReputationSettings();
}
