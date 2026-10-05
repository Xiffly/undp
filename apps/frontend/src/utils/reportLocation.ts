import type { Report } from '../types';

export function hasReportCoordinates(report: Pick<Report, 'lat' | 'lng'>): boolean {
  return Number.isFinite(report.lat) && Number.isFinite(report.lng);
}

export function formatReportCoordinates(report: Pick<Report, 'lat' | 'lng'>, digits = 4): string {
  if (!hasReportCoordinates(report)) return '';
  return `${Number(report.lat).toFixed(digits)}, ${Number(report.lng).toFixed(digits)}`;
}

export function getLocalizedAddress(report: Pick<Report, 'address_text' | 'localized'>): string {
  return String(report.localized?.address_text || report.address_text || '').trim();
}

export function getBuildingLabel(report: Pick<Report, 'building_label'>): string {
  return String(report.building_label || '').trim();
}

export function getLocationLine(report: Pick<Report, 'lat' | 'lng' | 'address_text' | 'building_label' | 'localized'>): string {
  return [getBuildingLabel(report), getLocalizedAddress(report)]
    .filter(Boolean)
    .join(' | ') || formatReportCoordinates(report, 4);
}
