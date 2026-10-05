import React from 'react';
import { useTranslation } from 'react-i18next';

const config = {
  pending: { key: 'common.pending', fallback: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  verified: { key: 'common.verified', fallback: 'Verified', color: 'bg-green-100 text-green-800' },
  flagged: { key: 'common.flagged', fallback: 'Flagged', color: 'bg-red-100 text-red-800' },
  duplicate: { key: 'common.duplicate', fallback: 'Duplicate', color: 'bg-gray-100 text-gray-600' },
  rejected: { key: 'common.rejected', fallback: 'Rejected', color: 'bg-red-100 text-red-800' },
} as const;

export default function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const badge = config[status as keyof typeof config] || config.pending;

  return (
    <span className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
      {t(badge.key, { defaultValue: badge.fallback })}
    </span>
  );
}
