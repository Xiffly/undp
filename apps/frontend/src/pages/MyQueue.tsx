import React, { useCallback, useEffect, useState } from 'react';
import { Clock3, Loader2, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOfflineQueue, type QueuedReport } from '../hooks/useOfflineQueue';
import { usePublicAuthStore } from '../store/publicAuth';
import { useLocation } from 'react-router-dom';

function formatDate(value?: number | null) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function formatRetryCountdown(value?: number | null) {
  if (!value) return '';
  const remainingMs = value - Date.now();
  if (remainingMs <= 0) return 'now';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function MyQueue() {
  const { t } = useTranslation();
  const location = useLocation();
  const { isOnline, getQueue, syncQueue, retryItem, deleteItem, claimItem, cleanupQueue } = useOfflineQueue();
  const publicUser = usePublicAuthStore((state) => state.user);
  const isAuthenticated = usePublicAuthStore((state) => state.isAuthenticated);
  const [items, setItems] = useState<QueuedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    await cleanupQueue();
    setItems(await getQueue());
  }, [cleanupQueue, getQueue]);

  useEffect(() => {
    const loadId = window.setTimeout(() => {
      load()
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(loadId);
  }, [load]);

  useEffect(() => {
    if (!items.length) return;
    const intervalId = window.setInterval(() => {
      load().catch(() => {});
    }, items.some((item) => item.status === 'syncing')
      ? 3000
      : items.some((item) => item.status === 'failed_retryable' && item.next_retry_at)
        ? 1000
        : 10000);
    return () => window.clearInterval(intervalId);
  }, [items, load]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncQueue();
      await load();
    } finally {
      setSyncing(false);
    }
  }, [syncQueue, load]);

  useEffect(() => {
    if (!isOnline || syncing) return;
    const hasRetryable = items.some((item) =>
      item.status === 'queued'
      || item.status === 'failed'
      || item.status === 'failed_retryable'
      || item.status === 'syncing'
    );
    if (!hasRetryable) return;
    const timeoutId = window.setTimeout(() => {
      handleSync().catch(() => {});
    }, items.some((item) => item.status === 'syncing') ? 6000 : 4000);
    return () => window.clearTimeout(timeoutId);
  }, [isOnline, items, syncing, handleSync]);



  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('queue.title')}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {t('queue.subtitle')}
            </p>
          </div>
          <button onClick={handleSync} disabled={syncing} className="flex items-center gap-2 rounded-xl bg-un-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60">
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncing ? t('queue.syncing') : t('queue.sync_now')}
          </button>
        </div>

        {location.state && (location.state as { queued?: boolean; offline?: boolean; summary?: Record<string, unknown> }).queued && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">{t('submit.saved_offline_title', { defaultValue: 'Saved offline' })}</p>
            <p className="mt-1">
              {t('submit.saved_offline_message', { defaultValue: 'This report is stored on this device and will be submitted automatically when connectivity returns.' })}
            </p>
          </div>
        )}

        {!isAuthenticated && (
          <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {t('queue.anonymous_hint')}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-un-blue" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
            {t('queue.empty')}
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => {
              const crisis = item.data.crisis_type ? t(`crisis_types.${item.data.crisis_type}`, { defaultValue: item.data.crisis_type }) : t('queue.unspecified_crisis');
              const address = [item.data.building_label, item.data.address_text].filter(Boolean).join(' | ')
                || `${item.data.lat || t('queue.unknown')}, ${item.data.lng || t('queue.unknown')}`;
              const isAnonymousLocal = !item.owner_user_id;
              const nextRetryCountdown = item.status === 'failed_retryable' ? formatRetryCountdown(item.next_retry_at) : '';
              return (
                <div key={item.id} className="rounded-2xl bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-gray-900">{crisis}</p>
                      <p className="mt-1 text-sm text-gray-500">{address}</p>
                    </div>
                    <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600">
                      {t(`queue.status_${item.status}`, { defaultValue: item.status.replace('_', ' ') })}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm text-gray-600 md:grid-cols-2">
                    <p><span className="font-semibold text-gray-800">{t('queue.damage')}:</span> {item.data.damage_level ? t(`damage.${item.data.damage_level}`, { defaultValue: item.data.damage_level }) : t('queue.not_set')}</p>
                    <p><span className="font-semibold text-gray-800">{t('queue.photos')}:</span> {item.photos.length}</p>
                    <p><span className="font-semibold text-gray-800">{t('queue.created')}:</span> {formatDate(item.created_at) || t('queue.never')}</p>
                    <p><span className="font-semibold text-gray-800">{t('queue.last_attempt')}:</span> {formatDate(item.last_attempt_at) || t('queue.never')}</p>
                    <p><span className="font-semibold text-gray-800">{t('queue.attempts')}:</span> {item.attempt_count}</p>
                    <p><span className="font-semibold text-gray-800">{t('queue.owner')}:</span> {isAnonymousLocal ? t('queue.anonymous_owner') : item.owner_email || item.owner_user_id}</p>
                  </div>

                  {item.error_message && (
                    <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{item.error_message}</p>
                  )}

                  {item.status === 'failed_retryable' && item.next_retry_at && (
                    <p className="mt-3 text-sm text-amber-700">
                      Next automatic retry: {formatDate(item.next_retry_at)} ({nextRetryCountdown})
                    </p>
                  )}

                  <p className="mt-3 flex items-center gap-1 text-xs text-gray-400">
                    <Clock3 size={13} />
                    {t('queue.local_expiry')}: {formatDate(item.expires_at)}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.status !== 'sent_confirmed' && (
                      <button onClick={() => retryItem(item.id).then(load)} className="rounded-xl border border-un-blue px-4 py-2 text-sm font-medium text-un-blue hover:bg-un-light">
                        {t('queue.retry')}
                      </button>
                    )}
                    {isAuthenticated && publicUser && isAnonymousLocal && (
                      <button onClick={() => claimItem(item.id).then(load)} className="flex items-center gap-1 rounded-xl border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50">
                        <UserPlus size={14} />
                        {t('queue.claim')}
                      </button>
                    )}
                    <button onClick={() => deleteItem(item.id).then(load)} className="flex items-center gap-1 rounded-xl border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                      <Trash2 size={14} />
                      {t('queue.delete')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
