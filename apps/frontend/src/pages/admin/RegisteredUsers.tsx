import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type AdminUserIdentitySummary, type AdminUserListItem } from '../../api/client';
import LoadingSpinner from '../../components/LoadingSpinner';

function timeAgo(d: string | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!d) return t('admin.registered_users.never', { defaultValue: 'Never' });
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return t('admin.registered_users.just_now', { defaultValue: 'Just now' });
  if (s < 3600) return t('admin.registered_users.minutes_ago', { count: Math.floor(s / 60), defaultValue: '{{count}}m ago' });
  if (s < 86400) return t('admin.registered_users.hours_ago', { count: Math.floor(s / 3600), defaultValue: '{{count}}h ago' });
  return t('admin.registered_users.days_ago', { count: Math.floor(s / 86400), defaultValue: '{{count}}d ago' });
}

function formatDate(value: string | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!value) return t('queue.unknown', { defaultValue: 'Unknown' });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('queue.unknown', { defaultValue: 'Unknown' });
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function identityBadge(identity: AdminUserIdentitySummary | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!identity) return { label: t('admin.registered_users.no_identity_data', { defaultValue: 'No identity data' }), tone: 'bg-gray-100 text-gray-500' };
  if (identity.phone_verified) return { label: t('admin.registered_users.phone_verified', { defaultValue: 'Phone verified' }), tone: 'bg-emerald-50 text-emerald-700' };
  if (identity.verification_pending) return { label: t('admin.registered_users.verification_pending', { defaultValue: 'Verification pending' }), tone: 'bg-amber-50 text-amber-700' };
  return { label: t('account.unverified', { defaultValue: 'Unverified' }), tone: 'bg-gray-100 text-gray-500' };
}

function whatsappBadge(identity: AdminUserIdentitySummary | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!identity) return { label: t('admin.registered_users.no_whatsapp_identity', { defaultValue: 'No WhatsApp identity' }), tone: 'bg-gray-100 text-gray-500' };
  if (identity.phone_verified) return { label: t('account.verified', { defaultValue: 'Verified' }), tone: 'bg-emerald-50 text-emerald-700' };
  return { label: t('account.unverified', { defaultValue: 'Unverified' }), tone: 'bg-gray-100 text-gray-500' };
}

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export default function RegisteredUsers() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.getUsers({ scope: 'public' });
      setUsers(response.users || []);
    } catch (err: unknown) {
      setUsers([]);
      setError(getApiErrorMessage(err, t('admin.registered_users.load_failed', { defaultValue: 'Failed to load registered users.' })));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const loadId = window.setTimeout(() => {
      loadUsers().catch(() => {});
    }, 0);
    return () => window.clearTimeout(loadId);
  }, [loadUsers]);

  const verifiedUsers = useMemo(
    () => users.filter((user) => user.identity?.phone_verified).length,
    [users]
  );

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('admin.registered_users.title', { defaultValue: 'Users' })}</h2>
          <p className="text-sm text-gray-500">
            {t('admin.registered_users.summary', {
              count: users.length,
              verified: verifiedUsers,
              defaultValue: '{{count}} registered public accounts, {{verified}} with verified phone links',
            })}
          </p>
        </div>
        <button onClick={() => loadUsers()} className="rounded-xl border border-gray-200 p-2 hover:bg-gray-50">
          <RefreshCw size={16} />
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <LoadingSpinner text={t('admin.registered_users.loading', { defaultValue: 'Loading registered users...' })} />
      ) : (
        <div className="space-y-3">
          {users.map((user) => {
            const badge = identityBadge(user.identity, t);
            const whatsapp = whatsappBadge(user.identity, t);
            const linkedContributor = user.identity?.linked_contributor_key || null;
            const contributor = user.identity?.contributor || null;
            const contributorSummary = t('admin.registered_users.contributor_summary', {
              badge: contributor?.primary_badge || t('admin.registered_users.none', { defaultValue: 'none' }),
              trust: contributor?.trust_score || 0,
              points: contributor?.points_total || 0,
              defaultValue: '{{badge}} · trust {{trust}}/100 · {{points}} pts',
            });

            return (
              <div key={user.id} className="rounded-xl border border-gray-100 p-4 transition hover:border-gray-200 hover:bg-gray-50">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.tone}`}>{badge.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{user.email}</p>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-xs text-gray-400">{t('account.phone', { defaultValue: 'Phone' })}</p>
                        <p className="font-semibold text-gray-900">{user.identity?.phone || user.phone || t('account.not_set', { defaultValue: 'Not set' })}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-xs text-gray-400">{t('admin.settings.organization', { defaultValue: 'Organization' })}</p>
                        <p className="font-semibold text-gray-900">{user.organization || t('account.not_set', { defaultValue: 'Not set' })}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-xs text-gray-400">{t('admin.registered_users.joined', { defaultValue: 'Joined' })}</p>
                        <p className="font-semibold text-gray-900">{formatDate(user.created_at, t)}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="text-xs text-gray-400">{t('admin.registered_users.last_login', { defaultValue: 'Last Login' })}</p>
                        <p className="font-semibold text-gray-900">{timeAgo(user.last_login, t)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="w-full min-w-0 rounded-xl border border-gray-100 p-3 lg:max-w-sm">
                    <p className="text-sm font-semibold text-gray-900">{t('admin.registered_users.contributor_link', { defaultValue: 'Contributor link' })}</p>
                    {linkedContributor ? (
                      <>
                        <p className="mt-2 break-all font-mono text-xs leading-5 text-gray-500">{linkedContributor}</p>
                        <p className="mt-2 text-sm text-gray-600">{contributorSummary}</p>
                        <p className="text-xs text-gray-400">
                          {t('admin.registered_users.verified_reports', {
                            count: contributor?.reports_verified || 0,
                            defaultValue: '{{count}} verified reports',
                          })}
                        </p>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-gray-500">{t('common.channel_whatsapp', { defaultValue: 'WhatsApp' })}</span>
                              <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${whatsapp.tone}`}>
                                {whatsapp.label}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-400">
                              {t('admin.registered_users.activity', {
                                time: timeAgo(user.identity?.last_whatsapp_activity_at, t),
                                defaultValue: 'Activity {{time}}',
                              })}
                            </p>
                          </div>
                          <Link
                            to={`/admin/users/contributors?selected=${encodeURIComponent(linkedContributor)}`}
                            className="shrink-0 text-xs font-medium text-un-blue hover:underline"
                          >
                            {t('admin.registered_users.open_contributor', { defaultValue: 'Open contributor' })}
                          </Link>
                        </div>
                      </>
                    ) : (
                      <div className="mt-2">
                        <p className="text-sm text-gray-500">{t('admin.registered_users.no_linked_contributor', { defaultValue: 'No linked contributor profile yet.' })}</p>
                        <p className="mt-2 text-xs text-gray-400">
                          {t('admin.registered_users.no_linked_contributor_help', {
                            defaultValue: 'Registered users appear here. Anonymous and non-registered submitters stay in Contributors.',
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {!users.length && (
            <div className="py-8 text-center text-sm text-gray-400">
              <UserRound size={24} className="mx-auto mb-2 opacity-40" />
              {t('admin.registered_users.empty', { defaultValue: 'No registered public users found.' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
