import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { api } from '../api/client';
import type { FootprintFeature, FootprintFeatureCollection } from '../types';
import { getFeatureCentroid, getFeatureId, getFeatureKey } from '../utils/footprints';

type BuildingSelection = {
  lat: number;
  lng: number;
  properties: FootprintFeature['properties'];
  footprint_set_id: string;
  footprint_feature_id: string;
  footprint_feature_key: string;
};

type BuildingFootprintLayerProps = {
  crisisEventId?: string;
  enabled?: boolean;
  selectedLat?: number;
  selectedLng?: number;
  selectedFootprintSetId?: string;
  selectedFootprintFeatureId?: string;
  selectedFootprintFeatureKey?: string;
  onBuildingSelect?: (selection: BuildingSelection) => void;
  onAvailabilityChange?: (state: { loading: boolean; available: boolean; count: number; error: boolean }) => void;
};

const DEFAULT_STYLE: L.PathOptions = {
  fillColor: '#009edb',
  fillOpacity: 0.12,
  color: '#009edb',
  weight: 1.2,
  opacity: 0.65,
};

const HOVER_STYLE: L.PathOptions = {
  fillOpacity: 0.24,
  weight: 1.8,
};

const SELECTED_STYLE: L.PathOptions = {
  fillColor: '#15803d',
  fillOpacity: 0.36,
  color: '#15803d',
  weight: 2.5,
  opacity: 0.9,
};

function selectionMatchesFeature(
  feature: FootprintFeature,
  selectedFootprintSetId?: string,
  selectedFootprintFeatureId?: string,
  selectedFootprintFeatureKey?: string
): boolean {
  const featureSetId = String(feature.properties?.footprint_set_id || '').trim();
  if (!selectedFootprintSetId || featureSetId !== String(selectedFootprintSetId || '').trim()) return false;
  if (selectedFootprintFeatureId && getFeatureId(feature) === String(selectedFootprintFeatureId).trim()) return true;
  if (selectedFootprintFeatureKey && getFeatureKey(feature) === String(selectedFootprintFeatureKey).trim()) return true;
  return false;
}

function distance(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.sqrt((aLat - bLat) ** 2 + (aLng - bLng) ** 2);
}

export default function BuildingFootprintLayer({
  crisisEventId = 'default',
  enabled = true,
  selectedLat,
  selectedLng,
  selectedFootprintSetId,
  selectedFootprintFeatureId,
  selectedFootprintFeatureKey,
  onBuildingSelect,
  onAvailabilityChange,
}: BuildingFootprintLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const featuresRef = useRef<Array<{ feature: FootprintFeature; centroid: [number, number]; layer: L.Path }>>([]);
  const [collection, setCollection] = useState<FootprintFeatureCollection | null>(null);
  const activeCollection = enabled ? collection : null;

  useEffect(() => {
    if (!enabled) {
      onAvailabilityChange?.({ loading: false, available: false, count: 0, error: false });
      return;
    }

    let cancelled = false;
    onAvailabilityChange?.({ loading: true, available: false, count: 0, error: false });

    api.getPublicFootprints(crisisEventId)
      .then((response) => {
        if (cancelled) return;
        const nextCollection: FootprintFeatureCollection = {
          type: 'FeatureCollection',
          features: Array.isArray(response?.features) ? response.features : [],
        };
        setCollection(nextCollection);
        onAvailabilityChange?.({
          loading: false,
          available: nextCollection.features.length > 0,
          count: nextCollection.features.length,
          error: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCollection({ type: 'FeatureCollection', features: [] });
        onAvailabilityChange?.({ loading: false, available: false, count: 0, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [crisisEventId, enabled, onAvailabilityChange]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    featuresRef.current = [];

    if (!enabled || !activeCollection?.features?.length) return;

    const layer = L.geoJSON(activeCollection, {
      style: () => ({ ...DEFAULT_STYLE }),
      onEachFeature(rawFeature, rawLayer) {
        const feature = rawFeature as FootprintFeature;
        const pathLayer = rawLayer as L.Path;
        const centroid = getFeatureCentroid(feature);
        if (!centroid) return;

        featuresRef.current.push({ feature, centroid, layer: pathLayer });

        pathLayer.on('mouseover', () => {
          pathLayer.setStyle({ ...DEFAULT_STYLE, ...HOVER_STYLE });
        });
        pathLayer.on('mouseout', () => {
          pathLayer.setStyle({ ...DEFAULT_STYLE });
        });
        pathLayer.on('click', () => {
          const footprintSetId = String(feature.properties?.footprint_set_id || '').trim();
          const footprintFeatureId = getFeatureId(feature);
          const footprintFeatureKey = getFeatureKey(feature);
          if (!footprintSetId || (!footprintFeatureId && !footprintFeatureKey) || !onBuildingSelect) return;
          onBuildingSelect({
            lat: centroid[0],
            lng: centroid[1],
            properties: feature.properties || {},
            footprint_set_id: footprintSetId,
            footprint_feature_id: footprintFeatureId,
            footprint_feature_key: footprintFeatureKey,
          });
        });
      },
    });

    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      featuresRef.current = [];
    };
  }, [activeCollection, enabled, map, onBuildingSelect]);

  useEffect(() => {
    if (!enabled || featuresRef.current.length === 0) return;

    let selectedLayer: L.Path | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const entry of featuresRef.current) {
      entry.layer.setStyle({ ...DEFAULT_STYLE });
      if (selectionMatchesFeature(entry.feature, selectedFootprintSetId, selectedFootprintFeatureId, selectedFootprintFeatureKey)) {
        selectedLayer = entry.layer;
        nearestDistance = 0;
        continue;
      }
      if (Number.isFinite(selectedLat) && Number.isFinite(selectedLng)) {
        const nextDistance = distance(selectedLat, selectedLng, entry.centroid[0], entry.centroid[1]);
        if (nextDistance < nearestDistance) {
          nearestDistance = nextDistance;
          selectedLayer = entry.layer;
        }
      }
    }

    if (selectedLayer && nearestDistance < 0.0025) {
      selectedLayer.setStyle({ ...SELECTED_STYLE });
    }
  }, [
    enabled,
    selectedFootprintFeatureId,
    selectedFootprintFeatureKey,
    selectedFootprintSetId,
    selectedLat,
    selectedLng,
  ]);

  return null;
}
