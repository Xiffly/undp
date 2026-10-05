export type TileProvider = 'standard' | 'humanitarian' | 'satellite';

export interface TileStyleMeta {
  key: TileProvider;
  label: string;
  previewSrc: string;
  accentClass: string;
}

export interface TileLayerConfig extends TileStyleMeta {
  url: string;
  attribution: string;
}

const TILE_STYLE_ORDER: TileProvider[] = ['standard', 'humanitarian', 'satellite'];

const TILE_STYLE_META: Record<TileProvider, TileStyleMeta> = {
  standard: {
    key: 'standard',
    label: 'Standard',
    previewSrc: '/map-style-standard.svg',
    accentClass: 'ring-un-blue/30',
  },
  humanitarian: {
    key: 'humanitarian',
    label: 'Humanitarian',
    previewSrc: '/map-style-humanitarian.svg',
    accentClass: 'ring-orange-300/60',
  },
  satellite: {
    key: 'satellite',
    label: 'Satellite',
    previewSrc: '/map-style-satellite.svg',
    accentClass: 'ring-slate-400/50',
  },
};

export function getTileStyles(): TileStyleMeta[] {
  return TILE_STYLE_ORDER.map((provider) => TILE_STYLE_META[provider]);
}

export function getTileLayer(provider: TileProvider, mapboxToken?: string): TileLayerConfig {
  const token = mapboxToken || import.meta.env?.VITE_MAPBOX_TOKEN || '';
  const meta = TILE_STYLE_META[provider];

  switch (provider) {
    case 'humanitarian':
      return {
        ...meta,
        url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, tiles style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a> hosted by OpenStreetMap France',
      };

    case 'satellite':
      if (token) {
        return {
          ...meta,
          url: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/{z}/{x}/{y}?access_token=${token}`,
          attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
        };
      }

      return {
        ...meta,
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
      };

    case 'standard':
    default:
      return {
        ...meta,
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
      };
  }
}
