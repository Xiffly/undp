import { Report } from '../../types';

export interface SitrepLog {
  id: string;
  generated_at: string;
  report_count: number;
  focus_area?: string;
  model: string;
  preview: string;
}

export function compareSitrepLogsDescending(a: SitrepLog, b: SitrepLog) {
  const aTime = new Date(a.generated_at).getTime();
  const bTime = new Date(b.generated_at).getTime();
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  if (Number.isFinite(aTime) && !Number.isFinite(bTime)) return -1;
  if (!Number.isFinite(aTime) && Number.isFinite(bTime)) return 1;
  return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export function toDraftCoordinate(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function hasDraftCoordinates(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

export function hasAnyTargetTranslation(report: Report | null, targetLang: string) {
  if (!report) return false;
  const translated = report.translations?.[targetLang];
  return Boolean(
    translated?.address_text
    || translated?.infra_name
    || translated?.description
  );
}

export function canTriggerClassification(report: Report) {
  return report.ai_classification_status !== 'completed'
    && Number(report.photo_count || 0) > 0
    && report.ai_media_eligibility === 'eligible';
}

export function getClassificationBlockedMessage(
  report: Report,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (Number(report.photo_count || 0) <= 0) {
    return t('admin.reports.ai_no_photos', { defaultValue: 'AI classification requires at least one photo.' });
  }
  if (report.ai_media_eligibility === 'missing_media') {
    return t('admin.reports.ai_missing_media', { defaultValue: 'AI classification unavailable: photo files are missing.' });
  }
  if (report.ai_media_eligibility === 'invalid_media') {
    return t('admin.reports.ai_invalid_media', { defaultValue: 'AI classification unavailable: photo references are invalid.' });
  }
  return '';
}
