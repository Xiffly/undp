import { useTranslation } from 'react-i18next';
import type { ContentTranslationStatus } from '../../types';

export function Alert({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  return <div className={`rounded-xl px-4 py-3 text-sm ${tone === 'error' ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-green-200 bg-green-50 text-green-700'}`}>{message}</div>;
}

export function StatusChip({ status, stale = false }: { status: ContentTranslationStatus; stale?: boolean }) {
  const { t } = useTranslation();
  const base = status === 'published'
    ? 'bg-green-100 text-green-700'
    : status === 'review'
      ? 'bg-amber-100 text-amber-700'
      : status === 'draft'
        ? 'bg-blue-100 text-blue-700'
        : 'bg-gray-100 text-gray-500';
  const statusLabel = status === 'published'
    ? t('admin.content_manager.status_published', { defaultValue: 'Published' })
    : status === 'review'
      ? t('admin.content_manager.status_review', { defaultValue: 'Review' })
      : status === 'draft'
        ? t('admin.content_manager.status_draft', { defaultValue: 'Draft' })
        : t('admin.content_manager.status_unknown', { defaultValue: 'Unknown' });
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${base}`}>
      {stale
        ? t('admin.content_manager.status_stale', { defaultValue: '{{status}} | Stale', status: statusLabel })
        : statusLabel}
    </span>
  );
}
