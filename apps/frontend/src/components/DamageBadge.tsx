import React from 'react';
import { useTranslation } from 'react-i18next';

const config = {
  destroyed: { key: 'map.filter_destroyed', fallback: 'Destroyed', color: 'bg-red-100 text-red-700 border-red-300', dot: 'bg-red-500' },
  partial: { key: 'map.filter_partial', fallback: 'Partial', color: 'bg-orange-100 text-orange-700 border-orange-300', dot: 'bg-orange-500' },
  minimal: { key: 'map.filter_minimal', fallback: 'Minimal', color: 'bg-green-100 text-green-700 border-green-300', dot: 'bg-green-500' },
  pending: { key: 'admin.dashboard.pending_review', fallback: 'Pending Review', color: 'bg-gray-100 text-gray-700 border-gray-300', dot: 'bg-gray-500' },
} as const;

export default function DamageBadge({ level, size = 'sm' }: { level: string; size?: 'sm' | 'lg' }) {
  const { t } = useTranslation();
  const badge = config[level as keyof typeof config] || config.pending;

  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium ${badge.color} ${size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'}`}>
      <span className={`h-2 w-2 rounded-full ${badge.dot}`} />
      {t(badge.key, { defaultValue: badge.fallback })}
    </span>
  );
}
