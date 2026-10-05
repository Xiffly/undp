import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, Settings2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { ContributorProfile } from '../../types';
import LoadingSpinner from '../../components/LoadingSpinner';
import { getBadgeLabel } from '../../utils/contributorReputation';

type ContributorDetail = {
  profile: ContributorProfile;
  badges?: Array<{ id: string; badge_code: string; revoked_at?: string | null }>;
  score_events?: Array<{ id: string; event_code: string; points_delta: number }>;
  aliases?: Array<{ actor_key: string; source: string }>;
  linked_user?: { id: string; name: string; email: string; verified_phone?: string | null } | null;
  merge_history?: Array<{ source_contributor_key: string; reason?: string | null }>;
  recent_reports?: Array<{ id: string; status: string; building_label?: string | null; address_text?: string | null }>;
};

type ContributorSettings = Record<string, number>;

type FieldConfig = { key: string; labelKey: string; fallback: string };
type IdentityConflict = {
  id?: string | null;
  user_id: string;
  conflict_type?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  contributor_key?: string | null;
  reason?: string | null;
};

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

function ContributorSettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<ContributorSettings>({});

  const settingsGroups: Array<{ titleKey: string; titleFallback: string; descKey: string; descFallback: string; fields: FieldConfig[] }> = [
    {
      titleKey: 'admin.contributors.weights_title',
      titleFallback: 'Trust score weights',
      descKey: 'admin.contributors.weights_description',
      descFallback: 'Applied when report quality reviews have all four component scores.',
      fields: [
        { key: 'accuracy_weight', labelKey: 'admin.contributors.accuracy_weight', fallback: 'Accuracy weight' },
        { key: 'photo_weight', labelKey: 'admin.contributors.photo_weight', fallback: 'Photo weight' },
        { key: 'location_weight', labelKey: 'admin.contributors.location_weight', fallback: 'Location weight' },
        { key: 'completeness_weight', labelKey: 'admin.contributors.completeness_weight', fallback: 'Completeness weight' },
      ],
    },
    {
      titleKey: 'admin.contributors.level_thresholds_title',
      titleFallback: 'Level thresholds',
      descKey: 'admin.contributors.level_thresholds_description',
      descFallback: 'Minimum points required to promote a contributor level.',
      fields: [
        { key: 'active_contributor', labelKey: 'admin.contributors.active_contributor', fallback: 'Active Contributor' },
        { key: 'trusted_contributor', labelKey: 'admin.contributors.trusted_contributor', fallback: 'Trusted Contributor' },
        { key: 'community_mapper', labelKey: 'admin.contributors.community_mapper', fallback: 'Community Mapper' },
        { key: 'crisis_response_champion', labelKey: 'admin.contributors.crisis_response_champion', fallback: 'Crisis Response Champion' },
      ],
    },
    {
      titleKey: 'admin.contributors.score_event_deltas_title',
      titleFallback: 'Score event deltas',
      descKey: 'admin.contributors.score_event_deltas_description',
      descFallback: 'Points added or removed when score events are rebuilt.',
      fields: [
        { key: 'first_verified_report', labelKey: 'admin.contributors.first_verified_report', fallback: 'First verified report' },
        { key: 'high_quality_verified_report', labelKey: 'admin.contributors.high_quality_verified_report', fallback: 'High quality verified report' },
        { key: 'confirmed_existing_damage_update', labelKey: 'admin.contributors.confirmed_existing_damage_update', fallback: 'Confirmed existing damage update' },
        { key: 'previously_unmapped_location', labelKey: 'admin.contributors.previously_unmapped_location', fallback: 'Previously unmapped location' },
        { key: 'useful_infrastructure_details', labelKey: 'admin.contributors.useful_infrastructure_details', fallback: 'Useful infrastructure details' },
        { key: 'duplicate_report', labelKey: 'admin.contributors.duplicate_report', fallback: 'Duplicate report' },
        { key: 'rejected_report', labelKey: 'admin.contributors.rejected_report', fallback: 'Rejected report' },
      ],
    },
    {
      titleKey: 'admin.contributors.badge_thresholds_title',
      titleFallback: 'Badge thresholds',
      descKey: 'admin.contributors.badge_thresholds_description',
      descFallback: 'Counts or validation minimums used when automatic badges are recomputed.',
      fields: [
        { key: 'community_observer_reports_verified', labelKey: 'admin.contributors.community_observer_reports_verified', fallback: 'Community Observer verified reports' },
        { key: 'trusted_reporter_reports_verified', labelKey: 'admin.contributors.trusted_reporter_reports_verified', fallback: 'Trusted Reporter verified reports' },
        { key: 'trusted_reporter_validation_rate', labelKey: 'admin.contributors.trusted_reporter_validation_rate', fallback: 'Trusted Reporter validation rate' },
        { key: 'infrastructure_mapper_distinct_types', labelKey: 'admin.contributors.infrastructure_mapper_distinct_types', fallback: 'Infrastructure Mapper distinct types' },
        { key: 'multilingual_contributor_distinct_languages', labelKey: 'admin.contributors.multilingual_contributor_distinct_languages', fallback: 'Multilingual Contributor languages' },
        { key: 'coverage_champion_new_coverage_reports', labelKey: 'admin.contributors.coverage_champion_new_coverage_reports', fallback: 'Coverage Champion coverage wins' },
        { key: 'evidence_quality_award_high_quality_reports', labelKey: 'admin.contributors.evidence_quality_award_high_quality_reports', fallback: 'Evidence Quality high quality reports' },
        { key: 'recovery_supporter_distinct_crises', labelKey: 'admin.contributors.recovery_supporter_distinct_crises', fallback: 'Recovery Supporter crises' },
        { key: 'local_knowledge_contributor_useful_detail_reports', labelKey: 'admin.contributors.local_knowledge_contributor_useful_detail_reports', fallback: 'Local Knowledge useful detail reports' },
        { key: 'verification_helper_confirmations', labelKey: 'admin.contributors.verification_helper_confirmations', fallback: 'Verification Helper confirmations' },
      ],
    },
    {
      titleKey: 'admin.contributors.high_quality_cutoffs_title',
      titleFallback: 'High-quality cutoffs',
      descKey: 'admin.contributors.high_quality_cutoffs_description',
      descFallback: 'Used both for aggregate counts and score-event creation.',
      fields: [
        { key: 'high_quality_min_weighted_score', labelKey: 'admin.contributors.high_quality_min_weighted_score', fallback: 'Weighted score minimum' },
        { key: 'high_quality_min_photo_score', labelKey: 'admin.contributors.high_quality_min_photo_score', fallback: 'Photo score minimum' },
        { key: 'high_quality_min_completeness_score', labelKey: 'admin.contributors.high_quality_min_completeness_score', fallback: 'Completeness score minimum' },
      ],
    },
  ];

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.getContributorSettings();
      setForm(response.settings || {});
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.contributors.load_settings_failed', { defaultValue: 'Failed to load contributor reputation settings.' })));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const loadId = scheduleTask(() => {
      loadSettings().catch(() => {});
    });
    return () => window.clearTimeout(loadId);
  }, [loadSettings]);

  const save = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.saveContributorSettings(form);
      setForm(response.settings || {});
      setSuccess(t('admin.contributors.settings_saved', { defaultValue: 'Contributor reputation settings saved. Run Rebuild Scores to apply them to existing contributors.' }));
      await onSaved();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.contributors.save_settings_failed', { defaultValue: 'Failed to save contributor reputation settings.' })));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.saveContributorSettings({ reset: true });
      setForm(response.settings || {});
      setSuccess(t('admin.contributors.settings_reset', { defaultValue: 'Defaults restored. Run Rebuild Scores to apply them to existing contributors.' }));
      await onSaved();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.contributors.reset_settings_failed', { defaultValue: 'Failed to reset contributor reputation settings.' })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="text-lg font-bold text-gray-900">{t('admin.contributors.settings_modal_title', { defaultValue: 'Contributor score settings' })}</h3>
          <p className="text-sm text-gray-500">{t('admin.contributors.settings_modal_description', { defaultValue: 'Trust score is a weighted blend of accuracy, photo quality, location precision, and completeness. Badge thresholds and score-event deltas below define how contributor reputation is rebuilt.' })}</p>
        </div>
        <div className="space-y-4 p-5">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {success && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}
          {loading ? (
            <LoadingSpinner text={t('admin.contributors.loading_settings', { defaultValue: 'Loading contributor score settings...' })} />
          ) : (
            settingsGroups.map((group) => (
              <div key={group.titleKey} className="rounded-xl border border-gray-100 p-4">
                <h4 className="text-sm font-semibold text-gray-900">{t(group.titleKey, { defaultValue: group.titleFallback })}</h4>
                <p className="mt-1 text-xs text-gray-500">{t(group.descKey, { defaultValue: group.descFallback })}</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {group.fields.map((field) => (
                    <label key={field.key} className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t(field.labelKey, { defaultValue: field.fallback })}</span>
                      <input
                        type="number"
                        step={field.key.includes('weight') || field.key.includes('rate') ? '0.01' : '1'}
                        min={0}
                        value={form[field.key] ?? ''}
                        onChange={(event) => setForm((current) => ({ ...current, [field.key]: Number(event.target.value) }))}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={reset} disabled={saving || loading} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            {t('admin.contributors.reset_defaults', { defaultValue: 'Reset defaults' })}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            {t('admin.common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button type="button" onClick={save} disabled={saving || loading} className="rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60">
            {saving ? t('admin.common.saving', { defaultValue: 'Saving...' }) : t('admin.contributors.save_settings', { defaultValue: 'Save settings' })}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Contributors() {
  const { t } = useTranslation();
  const [contributors, setContributors] = useState<ContributorProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContributorDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [identityConflicts, setIdentityConflicts] = useState<IdentityConflict[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [busyAction, setBusyAction] = useState<'rebuild' | 'hero' | null>(null);
  const [meRole, setMeRole] = useState<string>('team_lead');
  const [searchParams] = useSearchParams();
  const detailRequestId = useRef(0);

  const isAdmin = meRole === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [contributorsData, conflictsData, me] = await Promise.all([
        api.getContributors(query ? { search: query } : undefined),
        api.getIdentityConflicts(),
        api.getMe('admin'),
      ]);
      setContributors(contributorsData.contributors || []);
      setTotal(contributorsData.total || 0);
      setIdentityConflicts((conflictsData.conflicts || []) as IdentityConflict[]);
      setMeRole(me.role || 'team_lead');
    } catch (err: unknown) {
      setContributors([]);
      setTotal(0);
      setIdentityConflicts([]);
      setError(getApiErrorMessage(err, t('admin.contributors.load_failed', { defaultValue: 'Failed to load contributors.' })));
    } finally {
      setLoading(false);
    }
  }, [query, t]);

  const loadDetail = useCallback(async (key: string) => {
    setSelectedKey(key);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    const requestId = ++detailRequestId.current;
    try {
      const nextDetail = await api.getContributorDetail(key) as ContributorDetail;
      if (detailRequestId.current !== requestId) return;
      if (nextDetail?.profile?.contributor_key !== key) {
        setDetailError(t('admin.contributors.detail_mismatch', { defaultValue: 'Loaded contributor detail does not match the selected contributor.' }));
        return;
      }
      setDetail(nextDetail);
    } catch (err: unknown) {
      if (detailRequestId.current !== requestId) return;
      setDetailError(getApiErrorMessage(err, t('admin.contributors.detail_failed', { defaultValue: 'Failed to load contributor detail.' })));
    } finally {
      if (detailRequestId.current === requestId) setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const loadId = scheduleTask(() => {
      load().catch(() => {});
    });
    return () => window.clearTimeout(loadId);
  }, [load]);

  useEffect(() => {
    const selected = searchParams.get('selected');
    if (!selected || !contributors.length) return;
    if (selectedKey === selected) return;
    const exists = contributors.some((contributor) => contributor.contributor_key === selected);
    if (exists) {
      const detailId = scheduleTask(() => {
        loadDetail(selected).catch(() => {});
      });
      return () => window.clearTimeout(detailId);
    }
  }, [contributors, searchParams, selectedKey, loadDetail]);

  const selectedSummary = useMemo(
    () => contributors.find((contributor) => contributor.contributor_key === selectedKey) || null,
    [contributors, selectedKey]
  );

  const refreshSelection = useCallback(async () => {
    await load();
    if (selectedKey) await loadDetail(selectedKey);
  }, [load, loadDetail, selectedKey]);

  const recomputeAll = async () => {
    if (!isAdmin) return;
    setBusyAction('rebuild');
    setError('');
    setSuccess('');
    try {
      const response = await api.recomputeAllContributors();
      setSuccess(t('admin.contributors.rebuild_success', {
        count: response.recomputed,
        defaultValue: 'Rebuilt scores for {{count}} contributor profiles.',
      }));
      await refreshSelection();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.contributors.rebuild_failed', { defaultValue: 'Failed to rebuild contributor scores.' })));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleHero = async () => {
    if (!selectedKey || !detail?.profile || !isAdmin) return;
    setBusyAction('hero');
    setError('');
    setSuccess('');
    const hasHero = (detail.badges || []).some((badge) => badge.badge_code === 'community_hero' && !badge.revoked_at);
    try {
      if (hasHero) {
        await api.revokeManualContributorBadge(selectedKey, 'community_hero');
        setSuccess(t('admin.contributors.hero_revoked', { defaultValue: 'Hero badge revoked.' }));
      } else {
        await api.grantManualContributorBadge(selectedKey, 'community_hero', 'Exceptional contribution recognized by admins');
        setSuccess(t('admin.contributors.hero_awarded', { defaultValue: 'Hero badge awarded.' }));
      }
      await refreshSelection();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.contributors.hero_failed', { defaultValue: 'Failed to update hero badge.' })));
    } finally {
      setBusyAction(null);
    }
  };

  const manualLinkConflict = async (conflict: IdentityConflict) => {
    if (!selectedKey || !conflict?.user_id || !isAdmin) return;
    setError('');
    try {
      await api.manualLinkIdentity(conflict.user_id, selectedKey, 'Manual identity link from contributors admin');
      await refreshSelection();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.contributors.link_failed', { defaultValue: 'Failed to link selected contributor.' })));
    }
  };

  const mergeIntoSelected = async (sourceContributorKey: string) => {
    if (!selectedKey || !sourceContributorKey || sourceContributorKey === selectedKey || !isAdmin) return;
    setError('');
    try {
      await api.mergeContributorProfiles(selectedKey, sourceContributorKey, 'Manual merge from contributors admin');
      await refreshSelection();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.contributors.merge_failed', { defaultValue: 'Failed to merge contributor profiles.' })));
    }
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('admin.contributors.title', { defaultValue: 'Contributors' })}</h2>
          <p className="text-sm text-gray-500">
            {t('admin.contributors.summary', {
              count: total,
              defaultValue: '{{count}} report-derived contributor profiles, including anonymous and non-registered submitters',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} className="rounded-xl border border-gray-200 p-2 hover:bg-gray-50">
            <RefreshCw size={16} />
          </button>
          {isAdmin && (
            <>
              <button onClick={() => setShowSettings(true)} className="flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Settings2 size={16} />
                {t('admin.contributors.settings_button', { defaultValue: 'Settings' })}
              </button>
              <button onClick={recomputeAll} disabled={busyAction === 'rebuild'} className="rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60">
                {busyAction === 'rebuild' ? t('admin.contributors.rebuilding', { defaultValue: 'Rebuilding...' }) : t('admin.contributors.rebuild_scores', { defaultValue: 'Rebuild Scores' })}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

      {!!identityConflicts.length && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">{t('admin.contributors.identity_conflicts', { defaultValue: 'Identity conflicts' })}</h3>
          <div className="mt-3 space-y-2">
            {identityConflicts.slice(0, 6).map((conflict) => (
              <div key={conflict.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 text-xs text-amber-900">
                <div>
                  <p className="font-semibold">{conflict.conflict_type}</p>
                  <p>
                    {conflict.phone_e164 || t('admin.contributors.no_phone', { defaultValue: 'No phone' })}
                    {conflict.user_id ? ` | ${t('admin.contributors.user', { defaultValue: 'user' })} ${conflict.user_id}` : ''}
                    {conflict.contributor_key ? ` | ${t('admin.contributors.contributor', { defaultValue: 'contributor' })} ${conflict.contributor_key}` : ''}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex gap-2">
                    {conflict.user_id && selectedKey && (
                      <button onClick={() => manualLinkConflict(conflict)} className="rounded-lg border border-amber-200 px-2 py-1 hover:bg-amber-100">
                        {t('admin.contributors.link_to_selected', { defaultValue: 'Link To Selected' })}
                      </button>
                    )}
                    {conflict.contributor_key && selectedKey && conflict.contributor_key !== selectedKey && (
                      <button onClick={() => mergeIntoSelected(conflict.contributor_key)} className="rounded-lg border border-amber-200 px-2 py-1 hover:bg-amber-100">
                        {t('admin.contributors.merge_into_selected', { defaultValue: 'Merge Into Selected' })}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2">
            <Search size={16} className="text-gray-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('admin.contributors.search_placeholder', { defaultValue: 'Search contributor key or contact' })} className="w-full text-sm outline-none" />
          </div>
          {loading ? <LoadingSpinner text={t('admin.contributors.loading', { defaultValue: 'Loading contributors...' })} /> : (
            <div className="space-y-2">
              {contributors.map((contributor) => (
                <button
                  key={contributor.contributor_key}
                  onClick={() => loadDetail(contributor.contributor_key)}
                  className={`w-full rounded-xl border p-4 text-left transition ${selectedKey === contributor.contributor_key ? 'border-un-blue bg-un-light' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-gray-500">{contributor.contributor_key}</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{getBadgeLabel(contributor.primary_badge, t('confirmation.badge_default', { defaultValue: 'Contributor' }))}</p>
                      <p className="text-xs text-gray-500">
                        {t('admin.contributors.list_summary', {
                          level: contributor.level_code,
                          trust: contributor.trust_score,
                          points: contributor.points_total,
                          defaultValue: '{{level}} | trust {{trust}}/100 | {{points}} pts',
                        })}
                      </p>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>{t('admin.contributors.verified_short', { count: contributor.reports_verified, defaultValue: '{{count}} verified' })}</p>
                      <p>{t('admin.contributors.validation_rate', { rate: Math.round((contributor.validation_rate || 0) * 100), defaultValue: '{{rate}}% validation' })}</p>
                    </div>
                  </div>
                </button>
              ))}
              {!contributors.length && <p className="py-8 text-center text-sm text-gray-400">{t('admin.contributors.empty', { defaultValue: 'No contributor profiles found.' })}</p>}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          {!selectedKey ? (
            <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-gray-400">{t('admin.contributors.select_prompt', { defaultValue: 'Select a contributor to inspect badges, linked user, and score history.' })}</div>
          ) : detailLoading ? (
            <LoadingSpinner text={t('admin.contributors.loading_detail', { defaultValue: 'Loading contributor detail...' })} />
          ) : detailError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{detailError}</div>
          ) : detail?.profile ? (
            <div className="space-y-4">
              <div>
                <p className="font-mono text-xs text-gray-500">{detail.profile.contributor_key}</p>
                <h3 className="text-xl font-bold text-gray-900">{getBadgeLabel(detail.profile.primary_badge, t('confirmation.badge_default', { defaultValue: 'Contributor' }))}</h3>
                <p className="text-sm text-gray-500">
                  {t('admin.contributors.detail_summary', {
                    level: detail.profile.level_code,
                    trust: detail.profile.trust_score,
                    points: detail.profile.points_total,
                    defaultValue: '{{level}} | trust {{trust}}/100 | {{points}} points',
                  })}
                </p>
                {detail.linked_user && (
                  <p className="mt-1 text-xs text-gray-500">
                    {t('admin.contributors.linked_user', {
                      name: detail.linked_user.name,
                      email: detail.linked_user.email,
                      phone: detail.linked_user.verified_phone || '',
                      defaultValue: 'Linked user: {{name}} ({{email}}) {{phone}}',
                    })}
                  </p>
                )}
                {selectedSummary && selectedSummary.reports_verified !== detail.profile.reports_verified && (
                  <p className="mt-2 text-xs text-amber-700">{t('admin.contributors.stale_counts_notice', { defaultValue: 'List and detail aggregates were reloaded for this contributor to prevent stale counts.' })}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-gray-50 p-3"><p className="text-gray-400">{t('common.verified', { defaultValue: 'Verified' })}</p><p className="font-semibold text-gray-900">{detail.profile.reports_verified}</p></div>
                <div className="rounded-xl bg-gray-50 p-3"><p className="text-gray-400">{t('admin.contributors.confirmations', { defaultValue: 'Confirmations' })}</p><p className="font-semibold text-gray-900">{detail.profile.confirmations_made}</p></div>
                <div className="rounded-xl bg-gray-50 p-3"><p className="text-gray-400">{t('admin.contributors.coverage_wins', { defaultValue: 'Coverage Wins' })}</p><p className="font-semibold text-gray-900">{detail.profile.new_coverage_reports}</p></div>
                <div className="rounded-xl bg-gray-50 p-3"><p className="text-gray-400">{t('admin.contributors.high_quality', { defaultValue: 'High Quality' })}</p><p className="font-semibold text-gray-900">{detail.profile.high_quality_verified_reports}</p></div>
              </div>

              <div className="rounded-xl border border-gray-100 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">{t('admin.contributors.badges', { defaultValue: 'Badges' })}</p>
                  {isAdmin ? (
                    <button onClick={toggleHero} disabled={busyAction === 'hero'} className="rounded-lg border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60">
                      {busyAction === 'hero'
                        ? t('admin.common.saving', { defaultValue: 'Saving...' })
                        : (detail.badges || []).some((badge) => badge.badge_code === 'community_hero' && !badge.revoked_at)
                          ? t('admin.contributors.revoke_hero', { defaultValue: 'Revoke Hero' })
                          : t('admin.contributors.award_hero', { defaultValue: 'Award Hero' })}
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">{t('admin.contributors.admin_only', { defaultValue: 'Admin only' })}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(detail.badges || []).filter((badge) => !badge.revoked_at).map((badge) => (
                    <span key={badge.id} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{getBadgeLabel(badge.badge_code, badge.badge_code)}</span>
                  ))}
                  {!(detail.badges || []).filter((badge) => !badge.revoked_at).length && <span className="text-xs text-gray-400">{t('admin.contributors.no_active_badges', { defaultValue: 'No active badges' })}</span>}
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 p-3">
                <p className="mb-2 text-sm font-semibold text-gray-900">{t('admin.contributors.actor_aliases', { defaultValue: 'Actor aliases' })}</p>
                <div className="space-y-2 text-xs text-gray-600">
                  {(detail.aliases || []).slice(0, 6).map((alias) => (
                    <div key={alias.actor_key} className="rounded-lg bg-gray-50 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono truncate">{alias.actor_key}</span>
                        <span>{alias.source}</span>
                      </div>
                    </div>
                  ))}
                  {!(detail.aliases || []).length && <p className="text-xs text-gray-400">{t('admin.contributors.no_aliases', { defaultValue: 'No aliases' })}</p>}
                </div>
              </div>

              {!!detail.merge_history?.length && (
                <div className="rounded-xl border border-gray-100 p-3">
                  <p className="mb-2 text-sm font-semibold text-gray-900">{t('admin.contributors.merge_history', { defaultValue: 'Merge history' })}</p>
                  <div className="space-y-2 text-xs text-gray-600">
                    {detail.merge_history.slice(0, 6).map((entry) => (
                      <div key={entry.source_contributor_key} className="rounded-lg bg-gray-50 px-2.5 py-2">
                        <p className="font-mono">{entry.source_contributor_key}</p>
                        <p className="mt-1">{entry.reason || t('admin.contributors.merged_history', { defaultValue: 'Merged contributor history' })}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-gray-100 p-3">
                <p className="mb-2 text-sm font-semibold text-gray-900">{t('admin.contributors.recent_score_events', { defaultValue: 'Recent score events' })}</p>
                <div className="space-y-2 text-xs">
                  {(detail.score_events || []).slice(0, 8).map((event) => (
                    <div key={event.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-2.5 py-2">
                      <span className="font-medium text-gray-700">{event.event_code}</span>
                      <span className={event.points_delta >= 0 ? 'text-emerald-700' : 'text-red-600'}>{event.points_delta >= 0 ? '+' : ''}{event.points_delta}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 p-3">
                <p className="mb-2 text-sm font-semibold text-gray-900">{t('admin.contributors.recent_reports', { defaultValue: 'Recent reports' })}</p>
                <div className="space-y-2 text-xs text-gray-600">
                  {(detail.recent_reports || []).slice(0, 6).map((report) => (
                    <div key={report.id} className="rounded-lg bg-gray-50 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono">{report.id}</span>
                        <span>{report.status}</span>
                      </div>
                      <p className="mt-1 truncate">{[report.building_label, report.address_text].filter(Boolean).join(' | ') || t('admin.contributors.no_address_provided', { defaultValue: 'No address provided' })}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400">{t('admin.contributors.detail_unavailable', { defaultValue: 'Contributor detail unavailable.' })}</div>
          )}
        </div>
      </div>

      {showSettings && <ContributorSettingsModal onClose={() => setShowSettings(false)} onSaved={refreshSelection} />}
    </div>
  );
}
