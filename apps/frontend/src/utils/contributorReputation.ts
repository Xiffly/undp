export type ContributorSummary = {
  badge?: string;
  primary_badge?: string;
  level_code?: string;
  trust_score?: number;
  points_total?: number;
  validation_rate?: number;
  reports_submitted?: number;
  reports_verified?: number;
  suspicious_reports?: number;
  badges?: string[];
};

const BADGE_LABELS: Record<string, string> = {
  new_contributor: 'New Contributor',
  community_observer: 'Community Observer',
  trusted_reporter: 'Trusted Reporter',
  infrastructure_mapper: 'Infrastructure Mapper',
  early_responder: 'Early Responder',
  multilingual_contributor: 'Multilingual Contributor',
  coverage_champion: 'Coverage Champion',
  evidence_quality_award: 'Evidence Quality Award',
  recovery_supporter: 'Recovery Supporter',
  local_knowledge_contributor: 'Local Knowledge Contributor',
  verification_helper: 'Verification Helper',
  community_hero: 'Community Hero',
  none: 'Contributor',
};

const LEVEL_LABELS: Record<string, string> = {
  contributor: 'Contributor',
  active_contributor: 'Active Contributor',
  trusted_contributor: 'Trusted Contributor',
  community_mapper: 'Community Mapper',
  crisis_response_champion: 'Crisis Response Champion',
};

export function getBadgeLabel(badgeCode?: string | null, fallback = 'Contributor') {
  if (!badgeCode) return fallback;
  return BADGE_LABELS[badgeCode] || fallback;
}

export function getLevelLabel(levelCode?: string | null, fallback = 'Contributor') {
  if (!levelCode) return fallback;
  return LEVEL_LABELS[levelCode] || fallback;
}

export function getVisibleBadges(contributor?: ContributorSummary, max = 3) {
  return (contributor?.badges || []).slice(0, max);
}
