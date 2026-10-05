

export type SitrepStats = {
  total: number;
  destroyed: number;
  partial: number;
  minimal: number;
  urgent: number;
  verified: number;
  crisisTypes: string[];
  infraCategories: string[];
  needsCounts: Record<string, number>;
};

export type SitrepFiltersSnapshot = {
  bbox: string | null;
  crisis_event: string | null;
  since: string | null;
  focus_area: string | null;
  scope?: ResolvedSitrepScope | null;
  duplicate_radius_m?: number | null;
  duplicate_time_hours?: number | null;
  candidate_report_count?: number | null;
  outside_scope_excluded?: number | null;
  duplicate_reports_excluded?: number | null;
  status_reports_excluded?: number | null;
  low_coverage?: boolean | null;
  min_reports_required?: number | null;
};

export type SitrepScopeLevel = 'country' | 'region' | 'city' | 'town' | 'locality' | 'unknown';

export type ResolvedSitrepScope = {
  provider: 'nominatim';
  query: string;
  resolved_name: string;
  scope_level: SitrepScopeLevel;
  country_code: string | null;
  country_name: string | null;
  admin1: string | null;
  locality: string | null;
  bbox: string | null;
  min_lng: number | null;
  min_lat: number | null;
  max_lng: number | null;
  max_lat: number | null;
  center_lat: number | null;
  center_lng: number | null;
};

export type SitrepSelectionResult = {
  reports: any[];
  candidateReportCount: number;
  outsideScopeExcluded: number;
  duplicateReportsExcluded: number;
  statusReportsExcluded: number | null;
};

export type SitrepCompositionContext = {
  stats: SitrepStats;
  reports: any[];
  resolvedScope: ResolvedSitrepScope | null;
  focusArea: string | null;
  moderationSettings: { duplicateRadiusM: number; duplicateTimeHours: number };
  filterSnapshot: SitrepFiltersSnapshot;
  minReports: number;
};

export function sanitizeSitrepContent(content: string, focusArea?: string | null): string {
  const trimmed = String(content || '').trim();
  if (!trimmed) return trimmed;
  let next = trimmed;
  if (focusArea && focusArea.trim()) {
    const safeFocusArea = focusArea.trim();
    next = next
      .replace(/\[ADDRESS\]/gi, safeFocusArea)
      .replace(/\[FOCUS AREA\]/gi, safeFocusArea)
      .replace(/\[FOCUS_AREA\]/gi, safeFocusArea);
    const escapedFocusArea = safeFocusArea.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const repeatedFocusArea = new RegExp(`(${escapedFocusArea})(?:\\s*,\\s*\\1)+`, 'gi');
    next = next.replace(repeatedFocusArea, safeFocusArea);
  }
  return next
    .replace(/\[ADDRESS\]/gi, 'the reported area')
    .replace(/\[FOCUS AREA\]/gi, 'the reported area')
    .replace(/\[FOCUS_AREA\]/gi, 'the reported area');
}

export function parseBboxString(bbox: string): [number, number, number, number] | null {
  const parts = String(bbox || '').split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return null;
  if (minLat > maxLat || minLng > maxLng) return null;
  return [minLng, minLat, maxLng, maxLat];
}

export function normalizeCountryCode(value: unknown): string | null {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(text) ? text : null;
}

export function normalizePlaceName(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text : null;
}

export function inferScopeLevel(addresstype?: string | null, address?: Record<string, string>): SitrepScopeLevel {
  const normalized = String(addresstype || '').trim().toLowerCase();
  const safeAddress = address || {};
  if (normalized === 'country') return 'country';
  if (['state', 'province', 'region', 'county'].includes(normalized)) return 'region';
  if (normalized === 'city' || safeAddress.city || safeAddress.municipality) return 'city';
  if (['town', 'village', 'hamlet'].includes(normalized) || safeAddress.town || safeAddress.village || safeAddress.hamlet) return 'town';
  if (['suburb', 'district', 'neighbourhood', 'quarter'].includes(normalized) || safeAddress.suburb || safeAddress.neighbourhood) return 'locality';
  return 'unknown';
}

export function getScopeLocality(scopeLevel: SitrepScopeLevel, address?: Record<string, string>): string | null {
  const safeAddress = address || {};
  if (scopeLevel === 'city') return normalizePlaceName(safeAddress.city || safeAddress.municipality || safeAddress.county);
  if (scopeLevel === 'town') return normalizePlaceName(safeAddress.town || safeAddress.village || safeAddress.hamlet);
  if (scopeLevel === 'locality') return normalizePlaceName(safeAddress.suburb || safeAddress.neighbourhood || safeAddress.city_district || safeAddress.quarter);
  return null;
}

export function toResolvedScope(params: {
  query: string;
  displayName?: string;
  addresstype?: string;
  address?: Record<string, string>;
  lat?: string | number | null;
  lon?: string | number | null;
  boundingbox?: string[];
}): ResolvedSitrepScope {
  const bboxSource = Array.isArray(params.boundingbox) && params.boundingbox.length === 4
    ? params.boundingbox.map((value) => Number(value))
    : null;
  const minLat = bboxSource && Number.isFinite(bboxSource[0]) ? bboxSource[0] : null;
  const maxLat = bboxSource && Number.isFinite(bboxSource[1]) ? bboxSource[1] : null;
  const minLng = bboxSource && Number.isFinite(bboxSource[2]) ? bboxSource[2] : null;
  const maxLng = bboxSource && Number.isFinite(bboxSource[3]) ? bboxSource[3] : null;
  const bbox = [minLng, minLat, maxLng, maxLat].every((value) => value !== null)
    ? `${minLng},${minLat},${maxLng},${maxLat}`
    : null;
  const scopeLevel = inferScopeLevel(params.addresstype, params.address);
  const centerLat = Number(params.lat);
  const centerLng = Number(params.lon);
  return {
    provider: 'nominatim',
    query: params.query,
    resolved_name: String(params.displayName || params.query || '').trim(),
    scope_level: scopeLevel,
    country_code: normalizeCountryCode(params.address?.country_code),
    country_name: normalizePlaceName(params.address?.country),
    admin1: normalizePlaceName(params.address?.state || params.address?.region || params.address?.county),
    locality: getScopeLocality(scopeLevel, params.address),
    bbox,
    min_lng: minLng,
    min_lat: minLat,
    max_lng: maxLng,
    max_lat: maxLat,
    center_lat: Number.isFinite(centerLat) ? centerLat : null,
    center_lng: Number.isFinite(centerLng) ? centerLng : null,
  };
}

export async function resolveFocusAreaScope(focusArea: string, acceptLanguage?: string): Promise<ResolvedSitrepScope | null> {
  const query = String(focusArea || '').trim();
  if (!query) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': acceptLanguage || 'en',
      'User-Agent': 'UNDP-Crisis-Admin/1.0',
    },
  });
  if (!response.ok) return null;
  const rows = await response.json() as Array<{
    display_name?: string;
    addresstype?: string;
    lat?: string;
    lon?: string;
    boundingbox?: string[];
    address?: Record<string, string>;
  }>;
  const first = rows[0];
  if (!first) return null;
  return toResolvedScope({
    query,
    displayName: first.display_name,
    addresstype: first.addresstype,
    address: first.address,
    lat: first.lat,
    lon: first.lon,
    boundingbox: first.boundingbox,
  });
}

export function isWithinBbox(report: any, bbox: [number, number, number, number]): boolean {
  const lat = Number(report.lat);
  const lng = Number(report.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isWithinDuplicateWindow(candidate: any, accepted: any, hours: number): boolean {
  const candidateTime = new Date(candidate.submitted_at || 0).getTime();
  const acceptedTime = new Date(accepted.submitted_at || 0).getTime();
  if (!Number.isFinite(candidateTime) || !Number.isFinite(acceptedTime)) return false;
  return Math.abs(candidateTime - acceptedTime) <= hours * 60 * 60 * 1000;
}

export function reportsLookDuplicate(candidate: any, accepted: any, radiusM: number, timeHours: number): boolean {
  if (!isWithinDuplicateWindow(candidate, accepted, timeHours)) return false;
  const candidateLat = Number(candidate.lat);
  const candidateLng = Number(candidate.lng);
  const acceptedLat = Number(accepted.lat);
  const acceptedLng = Number(accepted.lng);
  if (!Number.isFinite(candidateLat) || !Number.isFinite(candidateLng) || !Number.isFinite(acceptedLat) || !Number.isFinite(acceptedLng)) {
    return false;
  }
  if (candidate.location_id && accepted.location_id && String(candidate.location_id) === String(accepted.location_id)) {
    return true;
  }
  return haversineMeters(candidateLat, candidateLng, acceptedLat, acceptedLng) <= radiusM;
}

export function applySitrepScopeAndDedup(params: {
  candidateReports: any[];
  resolvedScope: ResolvedSitrepScope | null;
  moderationSettings: { duplicateRadiusM: number; duplicateTimeHours: number };
  limit?: number;
}): SitrepSelectionResult {
  const { candidateReports, resolvedScope, moderationSettings } = params;
  const limit = params.limit || 50;
  const scopeBbox = resolvedScope?.bbox ? parseBboxString(resolvedScope.bbox) : null;

  let outsideScopeExcluded = 0;
  let scopedReports = candidateReports;
  if (resolvedScope) {
    scopedReports = candidateReports.filter((report) => {
      if (scopeBbox) return isWithinBbox(report, scopeBbox);
      if (resolvedScope.scope_level === 'country' && resolvedScope.country_code) {
        return normalizeCountryCode(report.country_code) === resolvedScope.country_code;
      }
      return true;
    });
    outsideScopeExcluded = candidateReports.length - scopedReports.length;
  }

  const dedupedReports: any[] = [];
  let duplicateReportsExcluded = 0;
  for (const report of scopedReports) {
    const isDuplicate = dedupedReports.some((accepted) =>
      reportsLookDuplicate(report, accepted, moderationSettings.duplicateRadiusM, moderationSettings.duplicateTimeHours)
    );
    if (isDuplicate) {
      duplicateReportsExcluded += 1;
      continue;
    }
    dedupedReports.push(report);
  }

  return {
    reports: dedupedReports.slice(0, limit),
    candidateReportCount: candidateReports.length,
    outsideScopeExcluded,
    duplicateReportsExcluded,
    statusReportsExcluded: null,
  };
}

export function formatList(items: string[], fallback: string): string {
  const clean = items.map((item) => String(item || '').trim()).filter(Boolean);
  return clean.length > 0 ? clean.join(', ') : fallback;
}

export function humanizeNeedKey(value: string): string {
  return String(value || '')
    .replace(/^other:/i, '')
    .replace(/_/g, ' ')
    .trim();
}

export function buildDeterministicSitrep(context: SitrepCompositionContext): string {
  const { stats, reports, resolvedScope, focusArea, moderationSettings, filterSnapshot, minReports } = context;
  const areaName = focusArea || resolvedScope?.resolved_name || 'the selected area';
  const scopeLevel = resolvedScope?.scope_level || 'area';
  const scopeRef = scopeLevel === 'country'
    ? 'the country'
    : scopeLevel === 'city'
      ? 'the city'
      : scopeLevel === 'town'
        ? 'the town'
        : scopeLevel === 'region'
          ? 'the region'
          : 'the selected area';
  const topNeeds = Object.entries(stats.needsCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([need, count]) => `${humanizeNeedKey(need)} (${count})`);
  const verifiedCount = stats.verified || 0;
  const urgentCount = stats.urgent || 0;
  const destroyedCount = stats.destroyed || 0;
  const partialCount = stats.partial || 0;
  const minimalCount = stats.minimal || 0;
  const infraSummary = formatList(stats.infraCategories || [], 'varied infrastructure');
  const crisisSummary = formatList(stats.crisisTypes || [], 'reported crisis impacts');
  const outsideExcluded = filterSnapshot.outside_scope_excluded || 0;
  const duplicateExcluded = filterSnapshot.duplicate_reports_excluded || 0;
  const submittedTimes = reports
    .map((report) => new Date(report.submitted_at || '').getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const earliest = submittedTimes.length ? new Date(submittedTimes[0]).toLocaleString() : null;
  const latest = submittedTimes.length ? new Date(submittedTimes[submittedTimes.length - 1]).toLocaleString() : null;

  const paragraph1 = `${areaName} is the active focus area for this situation report. ${stats.total} in-scope reports were selected across ${scopeRef} after applying the configured geographic boundary and duplicate controls. Of these, ${verifiedCount} are verified and ${urgentCount} are marked urgent.`;
  const paragraph2 = `Reported impacts indicate ${destroyedCount} destroyed sites, ${partialCount} partially damaged sites, and ${minimalCount} minimally damaged sites. The incident set is limited to ${scopeRef} and reflects ${crisisSummary} affecting ${infraSummary}.`;
  const paragraph3 = topNeeds.length > 0
    ? `Priority needs reported within ${scopeRef} are ${topNeeds.join(', ')}. Response planning should prioritize actions inside ${scopeRef}, based on the verified damage pattern and current service disruption indicators.`
    : `Priority needs were not consistently specified across the selected reports. Response planning should prioritize actions inside ${scopeRef}, based on the verified damage pattern and current service disruption indicators.`;
  const paragraph4 = `Selection controls excluded ${outsideExcluded} report${outsideExcluded === 1 ? '' : 's'} outside the chosen location and ${duplicateExcluded} duplicate report${duplicateExcluded === 1 ? '' : 's'} using the configured ${moderationSettings.duplicateRadiusM}m and ${moderationSettings.duplicateTimeHours}h threshold. ${earliest && latest ? `The included reports span from ${earliest} to ${latest}.` : ''}`.trim();
  const paragraph5 = filterSnapshot.low_coverage
    ? `Only ${stats.total} report${stats.total === 1 ? '' : 's'} are currently available inside ${scopeRef}, which is below the standard minimum threshold of ${minReports}. This summary should be treated as an early scoped snapshot until more in-area reports are received.`
    : '';

  return [paragraph1, paragraph2, paragraph3, paragraph4, paragraph5].filter(Boolean).join('\n\n');
}
