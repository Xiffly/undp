export type ConsentConfig = {
  consent_version: string;
  privacy_policy_url: string;
  governance_policy_url: string;
  banner_enabled: boolean;
};

export const DEFAULT_CONSENT_CONFIG: ConsentConfig = {
  consent_version: '2026-06-16',
  privacy_policy_url: '/privacy',
  governance_policy_url: '/governance',
  banner_enabled: true,
};
