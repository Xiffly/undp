import type { TFunction } from 'i18next';

export function formatRelativeTime(t: TFunction, dateInput: string | Date) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return t('report.time_seconds_ago', { count: seconds, defaultValue: '{{count}}s ago' });
  if (seconds < 3600) return t('report.time_minutes_ago', { count: Math.floor(seconds / 60), defaultValue: '{{count}}m ago' });
  if (seconds < 86400) return t('report.time_hours_ago', { count: Math.floor(seconds / 3600), defaultValue: '{{count}}h ago' });
  return t('report.time_days_ago', { count: Math.floor(seconds / 86400), defaultValue: '{{count}}d ago' });
}
