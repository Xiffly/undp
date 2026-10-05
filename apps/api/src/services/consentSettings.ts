import { execute, queryAll } from '../dbRuntime';

const DEFAULT_CONSENT_SETTINGS = {
  consent_version: (process.env.CONSENT_VERSION || '2026-06-16').trim() || '2026-06-16',
  privacy_policy_url: (process.env.PRIVACY_POLICY_URL || '/privacy').trim() || '/privacy',
  governance_policy_url: (process.env.GOVERNANCE_POLICY_URL || '/governance').trim() || '/governance',
  banner_enabled: String(process.env.CONSENT_BANNER_ENABLED || 'true').trim().toLowerCase() === 'false' ? 'false' : 'true',
};

type ConsentSettingKey = keyof typeof DEFAULT_CONSENT_SETTINGS;

async function ensureConsentSettings() {
  for (const [key, value] of Object.entries(DEFAULT_CONSENT_SETTINGS) as Array<[ConsentSettingKey, string]>) {
    await execute(
      'INSERT INTO consent_settings (key, value, updated_at) VALUES (?, ?, NOW()) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }
}

export async function getConsentSettings() {
  await ensureConsentSettings();
  const rows = await queryAll<{ key: string; value: string }>('SELECT key, value FROM consent_settings');
  const settings = { ...DEFAULT_CONSENT_SETTINGS };
  for (const row of rows) {
    if (row.key in settings) {
      settings[row.key as ConsentSettingKey] = String(row.value || DEFAULT_CONSENT_SETTINGS[row.key as ConsentSettingKey]);
    }
  }

  return {
    consentVersion: settings.consent_version,
    privacyPolicyUrl: settings.privacy_policy_url,
    governancePolicyUrl: settings.governance_policy_url,
    bannerEnabled: settings.banner_enabled === 'true',
  };
}
