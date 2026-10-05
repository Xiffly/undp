import type { FootprintFeature, FootprintFeatureCollection, Report } from '../types';

export type FootprintSelection = Pick<
  Report,
  'footprint_set_id' | 'footprint_feature_id' | 'footprint_feature_key' | 'lat' | 'lng'
>;

function averageRingCentroid(ring: number[][]): [number, number] | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  const lats = ring.map((coordinate) => coordinate[1]).filter((value) => Number.isFinite(value));
  const lngs = ring.map((coordinate) => coordinate[0]).filter((value) => Number.isFinite(value));
  if (lats.length === 0 || lngs.length === 0) return null;
  return [
    lats.reduce((sum, value) => sum + value, 0) / lats.length,
    lngs.reduce((sum, value) => sum + value, 0) / lngs.length,
  ];
}

export function getFeatureCentroid(feature: FootprintFeature): [number, number] | null {
  try {
    if (feature.geometry.type === 'Polygon') {
      return averageRingCentroid(feature.geometry.coordinates[0]);
    }
    if (feature.geometry.type === 'MultiPolygon') {
      return averageRingCentroid(feature.geometry.coordinates[0]?.[0] || []);
    }
  } catch {
    return null;
  }
  return null;
}

export function getFeatureId(feature: FootprintFeature): string {
  const properties = feature.properties || {};
  return String(properties.feature_id || feature.id || '').trim();
}

export function getFeatureKey(feature: FootprintFeature): string {
  const properties = feature.properties || {};
  return String(properties.feature_key || '').trim();
}

export function getSelectionIdentity(selection?: Partial<FootprintSelection> | null): string {
  return [
    String(selection?.footprint_set_id || '').trim(),
    String(selection?.footprint_feature_id || '').trim(),
    String(selection?.footprint_feature_key || '').trim(),
  ].join('|');
}

export function matchesFootprintSelection(
  feature: FootprintFeature,
  selection?: Partial<FootprintSelection> | null
): boolean {
  if (!selection?.footprint_set_id) return false;
  const featureSetId = String(feature.properties?.footprint_set_id || '').trim();
  if (!featureSetId || featureSetId !== String(selection.footprint_set_id || '').trim()) return false;

  const selectedFeatureId = String(selection.footprint_feature_id || '').trim();
  const selectedFeatureKey = String(selection.footprint_feature_key || '').trim();
  if (selectedFeatureId && getFeatureId(feature) === selectedFeatureId) return true;
  if (selectedFeatureKey && getFeatureKey(feature) === selectedFeatureKey) return true;
  return false;
}

function distance(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.sqrt((aLat - bLat) ** 2 + (aLng - bLng) ** 2);
}

export function selectMatchingFootprints(
  collection: FootprintFeatureCollection | null | undefined,
  selections: Array<Partial<FootprintSelection> | null | undefined>
): FootprintFeature[] {
  if (!collection?.features?.length) return [];

  const exactMatches = new Map<string, FootprintFeature>();
  const unmatchedSelections: Array<Partial<FootprintSelection>> = [];

  for (const selection of selections) {
    if (!selection) continue;
    const identity = getSelectionIdentity(selection);
    if (identity !== '||') {
      const exact = collection.features.find((feature) => matchesFootprintSelection(feature, selection));
      if (exact) {
        exactMatches.set(identity, exact);
        continue;
      }
    }
    unmatchedSelections.push(selection);
  }

  for (const selection of unmatchedSelections) {
    if (!selection.footprint_set_id || !Number.isFinite(selection.lat) || !Number.isFinite(selection.lng)) continue;
    const withinSet = collection.features.filter(
      (feature) => String(feature.properties?.footprint_set_id || '').trim() === String(selection.footprint_set_id || '').trim()
    );
    let nearest: FootprintFeature | null = null;
    let minDistance = Number.POSITIVE_INFINITY;
    for (const feature of withinSet) {
      const centroid = getFeatureCentroid(feature);
      if (!centroid) continue;
      const nextDistance = distance(selection.lat as number, selection.lng as number, centroid[0], centroid[1]);
      if (nextDistance < minDistance) {
        minDistance = nextDistance;
        nearest = feature;
      }
    }
    if (nearest && minDistance < 0.002) {
      exactMatches.set(getSelectionIdentity(selection), nearest);
    }
  }

  return Array.from(exactMatches.values());
}

export function buildFeatureCollection(features: FootprintFeature[]): FootprintFeatureCollection {
  return {
    type: 'FeatureCollection',
    features,
  };
}

export function getFootprintLabel(feature: FootprintFeature): string {
  return getFootprintLabelFromProperties(feature.properties || {});
}

export function getFootprintLabelFromProperties(properties: Record<string, unknown>): string {
  const candidates = [
    properties.name,
    properties.display_name,
    properties.address,
    properties['addr:full'],
    properties['addr:housename'],
    properties['addr:street'],
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (normalized) return normalized;
  }
  const setName = String(properties.footprint_set_name || '').trim();
  return setName ? `${setName} building` : '';
}
