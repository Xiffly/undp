import React from 'react';
import { useTranslation } from 'react-i18next';
import { ContributorSummary, getBadgeLabel, getLevelLabel, getVisibleBadges } from '../utils/contributorReputation';

const BADGE_KEY_MAP: Record<string, string> = {
  new_contributor: 'contributor.badges.new_contributor',
  community_observer: 'contributor.badges.community_observer',
  trusted_reporter: 'contributor.badges.trusted_reporter',
  infrastructure_mapper: 'contributor.badges.infrastructure_mapper',
  early_responder: 'contributor.badges.early_responder',
  multilingual_contributor: 'contributor.badges.multilingual_contributor',
  coverage_champion: 'contributor.badges.coverage_champion',
  evidence_quality_award: 'contributor.badges.evidence_quality_award',
  recovery_supporter: 'contributor.badges.recovery_supporter',
  local_knowledge_contributor: 'contributor.badges.local_knowledge_contributor',
  verification_helper: 'contributor.badges.verification_helper',
  community_hero: 'contributor.badges.community_hero',
  none: 'contributor.badges.none',
};

const LEVEL_KEY_MAP: Record<string, string> = {
  contributor: 'contributor.levels.contributor',
  active_contributor: 'contributor.levels.active_contributor',
  trusted_contributor: 'contributor.levels.trusted_contributor',
  community_mapper: 'contributor.levels.community_mapper',
  crisis_response_champion: 'contributor.levels.crisis_response_champion',
};

export default function ContributorSummaryCard({
  contributor,
  title = 'Community standing',
  pendingMessage = 'Badges and points update after reviewer validation. Submitting more reports does not increase your standing by itself.',
  className = '',
}: {
  contributor?: ContributorSummary;
  title?: string;
  pendingMessage?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!contributor) return null;
  const visibleBadges = getVisibleBadges(contributor);
  const resolveBadgeLabel = (badgeCode?: string | null, fallback = 'Contributor') => {
    if (!badgeCode) return fallback;
    return t(BADGE_KEY_MAP[badgeCode] || '', { defaultValue: getBadgeLabel(badgeCode, fallback) });
  };
  const resolveLevelLabel = (levelCode?: string | null, fallback = 'Contributor') => {
    if (!levelCode) return fallback;
    return t(LEVEL_KEY_MAP[levelCode] || '', { defaultValue: getLevelLabel(levelCode, fallback) });
  };

  return (
    <div className={`rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left ${className}`.trim()}>
      <p className="mb-1 text-sm font-semibold text-emerald-800">{title}</p>
      <p className="text-sm text-emerald-700">
        {t('contributor.badge_label', { defaultValue: 'Badge' })}: <span className="font-semibold">{resolveBadgeLabel(contributor.primary_badge || contributor.badge, 'Contributor')}</span>
      </p>
      <p className="mt-1 text-xs text-emerald-700">
        {t('contributor.trust_summary', {
          trust: contributor.trust_score ?? 0,
          status: resolveLevelLabel(contributor.level_code, 'Contributor'),
          verified: contributor.reports_verified ?? 0,
          points: contributor.points_total ?? 0,
          defaultValue: 'Trust score {{trust}}/100 | Status {{status}} | {{verified}} verified reports | {{points}} points',
        })}
      </p>
      {visibleBadges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {visibleBadges.map((badge) => (
            <span key={badge} className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              {resolveBadgeLabel(badge, badge)}
            </span>
          ))}
          {(contributor.badges?.length || 0) > visibleBadges.length && (
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              {t('contributor.more', {
                count: (contributor.badges?.length || 0) - visibleBadges.length,
                defaultValue: '+{{count}} more',
              })}
            </span>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-emerald-700">{pendingMessage}</p>
    </div>
  );
}
