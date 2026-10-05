import { execute, queryAll } from '../dbRuntime';

const MODERATION_SETTING_DEFAULTS = {
  feature_duplicate_detect: 'true',
  duplicate_radius_m: '100',
  duplicate_time_hours: '24',
  abuse_max_reports_per_hour: '8',
  abuse_max_reports_per_day: '25',
  abuse_repeat_window_minutes: '30',
} as const;

const LEGACY_AI_KEYS = Object.keys(MODERATION_SETTING_DEFAULTS);

export type ModerationSettings = {
  duplicateDetectionEnabled: boolean;
  duplicateRadiusM: number;
  duplicateTimeHours: number;
  abuseMaxReportsPerHour: number;
  abuseMaxReportsPerDay: number;
  abuseRepeatWindowMinutes: number;
};

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function ensureModerationSettingsMigrated(): Promise<void> {
  for (const [key, fallback] of Object.entries(MODERATION_SETTING_DEFAULTS)) {
    await execute(
      `
      INSERT INTO moderation_settings (key, value)
      VALUES (
        ?,
        COALESCE(
          (SELECT value FROM moderation_settings WHERE key = ?),
          (SELECT value FROM ai_settings WHERE key = ?),
          ?
        )
      )
      ON CONFLICT (key) DO NOTHING
      `,
      [key, key, key, fallback]
    );
  }
}

export async function getModerationSettings(): Promise<ModerationSettings> {
  await ensureModerationSettingsMigrated();
  const rows = await queryAll<{ key: string; value: string }>(
    'SELECT key, value FROM moderation_settings WHERE key = ANY($1)',
    [LEGACY_AI_KEYS]
  );

  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const merged = { ...MODERATION_SETTING_DEFAULTS, ...stored };

  return {
    duplicateDetectionEnabled: merged.feature_duplicate_detect === 'true',
    duplicateRadiusM: parsePositiveNumber(merged.duplicate_radius_m, 100),
    duplicateTimeHours: parsePositiveNumber(merged.duplicate_time_hours, 24),
    abuseMaxReportsPerHour: parsePositiveInt(merged.abuse_max_reports_per_hour, 8),
    abuseMaxReportsPerDay: parsePositiveInt(merged.abuse_max_reports_per_day, 25),
    abuseRepeatWindowMinutes: parsePositiveInt(merged.abuse_repeat_window_minutes, 30),
  };
}

export async function getModerationSettingsPayload(): Promise<Record<string, string>> {
  await ensureModerationSettingsMigrated();
  const rows = await queryAll<{ key: string; value: string }>(
    'SELECT key, value FROM moderation_settings WHERE key = ANY($1)',
    [LEGACY_AI_KEYS]
  );
  return { ...MODERATION_SETTING_DEFAULTS, ...Object.fromEntries(rows.map((row) => [row.key, row.value])) };
}

export async function setModerationSettings(next: Record<string, string>): Promise<string[]> {
  await ensureModerationSettingsMigrated();
  const updated: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (!LEGACY_AI_KEYS.includes(key)) continue;
    await execute(
      "INSERT INTO moderation_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
      [key, String(value)]
    );
    updated.push(key);
  }
  return updated;
}
