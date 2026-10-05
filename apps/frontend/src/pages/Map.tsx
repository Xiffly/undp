import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import { Search, X, SlidersHorizontal, RefreshCw, Plus, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type ReportMapStats } from '../api/client';
import { Report } from '../types';
import DamageBadge from '../components/DamageBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import MapTileSelector from '../components/MapTileSelector';
import { getTileLayer } from '../components/mapTiles';
import { getBuildingLabel, getLocalizedAddress, hasReportCoordinates } from '../utils/reportLocation';
import type { TileProvider } from '../components/mapTiles';
import { useSeo } from '../seo/useSeo';

type LeafletIconDefaults = typeof L.Icon.Default.prototype & {
  _getIconUrl?: () => string;
};

delete (L.Icon.Default.prototype as LeafletIconDefaults)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DAMAGE_COLORS: Record<string, string> = {
  destroyed: '#ef4135', partial: '#f5a623', minimal: '#27ae60',
};
type ViewportState = 'idle' | 'moving' | 'waiting_for_tiles';
type TileLoadState = 'loading' | 'ready' | 'error';

interface GeoResult {
  display_name: string;
  lat: string;
  lon: string;
  type: string;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

function MapController({
  flyTo,
  onSearchMoveStart,
}: {
  flyTo: [number, number, number] | null;
  onSearchMoveStart: () => void;
}) {
  const map = useMap();
  const prev = useRef<string>('');
  useEffect(() => {
    if (!flyTo) return;
    const key = flyTo.join(',');
    if (key === prev.current) return;
    prev.current = key;
    onSearchMoveStart();
    map.flyTo([flyTo[0], flyTo[1]], flyTo[2], { duration: 1.2 });
  }, [flyTo, map, onSearchMoveStart]);
  return null;
}

function MapLifecycleBridge({
  tileProvider,
  onMapReady,
  onSearchMoveEnd,
  searchMoveToken,
}: {
  tileProvider: TileProvider;
  onMapReady: (map: L.Map) => void;
  onSearchMoveEnd: (map: L.Map) => void;
  searchMoveToken: number;
}) {
  const map = useMap();
  const pendingSearchMoveRef = useRef(false);
  const lastSearchMoveTokenRef = useRef(0);

  useMapEvents({
    moveend: () => {
      if (!pendingSearchMoveRef.current) return;
      pendingSearchMoveRef.current = false;
      onSearchMoveEnd(map);
    },
  });

  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  useEffect(() => {
    if (searchMoveToken === 0 || searchMoveToken === lastSearchMoveTokenRef.current) return;
    lastSearchMoveTokenRef.current = searchMoveToken;
    pendingSearchMoveRef.current = true;
  }, [searchMoveToken]);

  useEffect(() => {
    let timeoutId: number | null = null;
    const invalidate = () => map.invalidateSize({ pan: false });
    const animationFrame = window.requestAnimationFrame(() => {
      invalidate();
      timeoutId = window.setTimeout(invalidate, 180);
    });

    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(invalidate);
    });
    observer.observe(container);
    window.addEventListener('resize', invalidate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (timeoutId) window.clearTimeout(timeoutId);
      observer.disconnect();
      window.removeEventListener('resize', invalidate);
    };
  }, [map, tileProvider]);

  return null;
}

function TrackedTileLayer({
  tile,
  onStateChange,
}: {
  tile: ReturnType<typeof getTileLayer>;
  onStateChange: (state: TileLoadState) => void;
}) {
  useEffect(() => {
    onStateChange('loading');
  }, [tile.key, onStateChange]);

  return (
    <TileLayer
      key={tile.key}
      url={tile.url}
      attribution={tile.attribution}
      eventHandlers={{
        loading: () => onStateChange('loading'),
        load: () => onStateChange('ready'),
        tileerror: () => onStateChange('error'),
      }}
    />
  );
}

function ZoomControls({ map }: { map: L.Map | null }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => map?.zoomIn()}
        disabled={!map}
        className="flex h-11 w-11 items-center justify-center text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
      >
        <Plus size={18} />
      </button>
      <div className="h-px bg-gray-200" />
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => map?.zoomOut()}
        disabled={!map}
        className="flex h-11 w-11 items-center justify-center text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
      >
        <Minus size={18} />
      </button>
    </div>
  );
}

function ViewportMarkers({ reports, t }: { reports: Report[]; t: (key: string, options?: Record<string, unknown>) => string }) {
  const map = useMap();
  const [, setBoundsVersion] = useState(0);

  useMapEvents({
    moveend: () => setBoundsVersion((value) => value + 1),
    zoomend: () => setBoundsVersion((value) => value + 1),
  });

  const visibleBounds = map.getBounds().pad(0.2);
  const visible = reports.filter((report) => hasReportCoordinates(report) && visibleBounds.contains([Number(report.lat), Number(report.lng)]));

  return (
    <>
      {visible.map(r => (
        <CircleMarker
          key={r.id}
          center={[Number(r.lat), Number(r.lng)]}
          radius={r.damage_level === 'destroyed' ? 10 : r.damage_level === 'partial' ? 8 : 6}
          pathOptions={{
            fillColor: DAMAGE_COLORS[r.damage_level] || '#999',
            color: r.is_urgent ? '#ff0000' : '#fff',
            weight: r.is_urgent ? 2.5 : 1,
            fillOpacity: 0.85,
            opacity: 1,
          }}
        >
          <Popup maxWidth={280} autoPan={false}>
            <div className="p-1 min-w-[200px]">
              <div className="flex gap-1 mb-2 flex-wrap">
                <DamageBadge level={r.damage_level} />
                {r.is_urgent && <span className="text-red-600 text-xs font-bold">{t('common.urgent')}</span>}
              </div>
              <p className="text-xs text-gray-500 font-mono mb-1">{r.id}</p>
              {getBuildingLabel(r) && (
                <p className="text-sm font-medium text-gray-700 mb-1">{t('report.building')}: {getBuildingLabel(r)}</p>
              )}
              {getLocalizedAddress(r) && (
                <p className="text-sm font-medium text-gray-700 mb-1">{t('report.location')}: {getLocalizedAddress(r)}</p>
              )}
              <p className="text-xs text-gray-500 mb-1">
                {r.infra_category || (Array.isArray(r.infra_types) ? r.infra_types.join(', ') : String(r.infra_types || ''))}
                {r.crisis_type && <span className="ml-2 text-gray-400">| {r.crisis_type}</span>}
              </p>
              {r.description && (
                <p className="text-xs text-gray-600 mb-2 italic leading-relaxed">
                  {String(r.description).substring(0, 140)}{String(r.description).length > 140 ? '...' : ''}
                </p>
              )}
              {Array.isArray(r.photos) && r.photos.length > 0 && (
                <div className="flex gap-1 mb-2">
                  {r.photos.slice(0, 2).map((p, i) => (
                    <img key={i} src={p} alt="" className="w-16 h-12 object-cover rounded border border-gray-200" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ))}
                  {r.photos.length > 2 && <div className="w-16 h-12 bg-gray-100 rounded border border-gray-200 flex items-center justify-center text-xs text-gray-500">+{r.photos.length - 2}</div>}
                </div>
              )}
              <Link to={`/reports/${r.id}`} className="text-xs text-un-blue font-semibold hover:underline">
                {t('map.view_report')}
              </Link>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}

function LocationSearch({ onSelect, t }: { onSelect: (lat: number, lon: number, zoom: number) => void; t: (key: string, options?: Record<string, unknown>) => string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=0`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data: GeoResult[] = await res.json();
      setResults(data);
      setOpen(data.length > 0);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 380);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = (r: GeoResult) => {
    const zoom = r.type === 'country' ? 6 : ['state', 'region', 'province', 'county'].includes(r.type) ? 8 : ['city', 'town', 'municipality'].includes(r.type) ? 11 : 13;
    onSelect(parseFloat(r.lat), parseFloat(r.lon), zoom);
    setQuery(r.display_name.split(',')[0]);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative w-full max-w-xs">
      <div className="flex items-center bg-white border border-gray-200 rounded-xl shadow overflow-hidden focus-within:ring-2 focus-within:ring-un-blue/40 focus-within:border-un-blue transition-all">
        <Search size={14} className="ml-2.5 text-gray-400 flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={t('map.search_placeholder')}
          className="flex-1 px-2 py-2 text-sm bg-transparent focus:outline-none placeholder:text-gray-400 min-w-0"
        />
        {loading && <div className="mr-2.5 w-3.5 h-3.5 border-2 border-un-blue/40 border-t-un-blue rounded-full animate-spin flex-shrink-0" />}
        {query && !loading && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }} className="mr-2 text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={13} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-[1000] overflow-hidden max-h-60 overflow-y-auto">
          {results.map((r, i) => (
            <button key={i} onClick={() => pick(r)} className="w-full text-left px-3 py-2.5 text-sm hover:bg-un-light transition-colors border-b border-gray-50 last:border-0">
              <div className="font-medium text-gray-800 truncate">{r.display_name.split(',')[0]}</div>
              <div className="text-gray-400 text-xs truncate">{r.display_name.split(',').slice(1, 3).join(',')}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  const { t } = useTranslation();
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<ReportMapStats>({
    total: 0,
    destroyed: 0,
    partial: 0,
    minimal: 0,
    urgent: 0,
    pending: 0,
    verified: 0,
    flagged: 0,
    duplicate: 0,
    rejected: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tileProvider, setTileProvider] = useState<TileProvider>('standard');
  const [filters, setFilters] = useState({ damage_level: 'all', status: 'all' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [flyTo, setFlyTo] = useState<[number, number, number] | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [viewportState, setViewportState] = useState<ViewportState>('waiting_for_tiles');
  const [tileLoadState, setTileLoadState] = useState<TileLoadState>('loading');
  const [searchMoveToken, setSearchMoveToken] = useState(0);
  const [pollNonce, setPollNonce] = useState(0);
  const [pollFailureCount, setPollFailureCount] = useState(0);
  const fallbackTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useSeo({
    title: t('map.meta_title', { defaultValue: 'Crisis Damage Map' }),
    description: t('map.meta_description', {
      defaultValue: 'Explore mapped crisis damage reports, urgency markers, and verified community updates.',
    }),
    canonicalPath: '/map',
  });

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string> = { limit: '2000' };
      if (filters.damage_level !== 'all') params.damage_level = filters.damage_level;
      if (filters.status !== 'all') params.status = filters.status;
      const [dataResult, statsResult] = await Promise.allSettled([
        api.getReports(params),
        api.getReportStats(params),
      ]);

      if (dataResult.status !== 'fulfilled') {
        throw dataResult.reason;
      }

      const nextReports = Array.isArray(dataResult.value.reports) ? dataResult.value.reports : [];
      setReports(nextReports);

      if (statsResult.status === 'fulfilled') {
        setStats(statsResult.value);
      } else {
        setStats({
          total: nextReports.length,
          destroyed: nextReports.filter((r) => r.damage_level === 'destroyed').length,
          partial: nextReports.filter((r) => r.damage_level === 'partial').length,
          minimal: nextReports.filter((r) => r.damage_level === 'minimal').length,
          urgent: nextReports.filter((r) => r.is_urgent).length,
          pending: nextReports.filter((r) => r.status === 'pending').length,
          verified: nextReports.filter((r) => r.status === 'verified').length,
          flagged: nextReports.filter((r) => r.status === 'flagged').length,
          duplicate: nextReports.filter((r) => r.status === 'duplicate').length,
          rejected: nextReports.filter((r) => r.status === 'rejected').length,
        });
      }

      setPollFailureCount(0);
    } catch (error: unknown) {
      setLoadError(getApiErrorMessage(error, t('map.load_error', { defaultValue: 'Unable to load reports.' })));
      setPollFailureCount((count) => count + 1);
      console.error('Failed to load map reports:', error);
    } finally { setLoading(false); }
  }, [filters, t]);

  useEffect(() => {
    const fetchId = scheduleTask(() => {
      fetchReports().catch(() => {});
    });
    return () => window.clearTimeout(fetchId);
  }, [fetchReports, pollNonce]);

  useEffect(() => {
    if (document.visibilityState === 'hidden') return;

    const delayMs = loadError
      ? Math.min(30000 * Math.max(2, pollFailureCount), 5 * 60 * 1000)
      : 30000;

    const timeout = window.setTimeout(() => {
      fetchReports();
    }, delayMs);

    return () => window.clearTimeout(timeout);
  }, [fetchReports, loadError, pollFailureCount, pollNonce]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      setPollNonce((value) => value + 1);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const viewportId = scheduleTask(() => {
      setViewportState('waiting_for_tiles');
    });
    return () => window.clearTimeout(viewportId);
  }, [tileProvider]);

  useEffect(() => {
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (viewportState === 'idle') return;

    fallbackTimerRef.current = window.setTimeout(() => {
      setViewportState('idle');
      fallbackTimerRef.current = null;
    }, 3200);

    return () => {
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [viewportState]);

  useEffect(() => {
    if (viewportState === 'idle') return;
    if (tileLoadState === 'loading') return;
    const idleId = scheduleTask(() => {
      setViewportState('idle');
    });
    return () => window.clearTimeout(idleId);
  }, [tileLoadState, viewportState]);

  const handleSearchMoveStart = useCallback(() => {
    setSearchMoveToken((value) => value + 1);
    setViewportState('moving');
  }, []);

  const handleSearchMoveEnd = useCallback((map: L.Map) => {
    window.requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      setViewportState(tileLoadState === 'loading' ? 'waiting_for_tiles' : 'idle');
    });
  }, [tileLoadState]);

  const handleTileStateChange = useCallback((state: TileLoadState) => {
    setTileLoadState(state);
  }, []);

  const tile = getTileLayer(tileProvider);
  const activeFilters = (filters.damage_level !== 'all' ? 1 : 0) + (filters.status !== 'all' ? 1 : 0);
  const mapUpdating = viewportState !== 'idle';
  const hasTruncatedResults = stats.total > reports.length;

  return (
    <div className="fixed inset-0 top-14" style={{ bottom: 0 }}>
      <div className="absolute top-0 left-0 z-[450] pointer-events-none">
        <div className="flex items-start gap-2 p-2.5 pointer-events-auto">
          <LocationSearch onSelect={(lat, lon, zoom) => setFlyTo([lat, lon, zoom])} t={t} />

          <button
            onClick={() => setFiltersOpen(o => !o)}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium shadow transition-all bg-white flex-shrink-0 ${
              filtersOpen || activeFilters > 0
                ? 'border-un-blue text-un-blue bg-un-light'
                : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">{t('map.filters')}</span>
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-un-blue text-white text-[10px] rounded-full flex items-center justify-center font-bold leading-none">
                {activeFilters}
              </span>
            )}
          </button>

          <button
            onClick={fetchReports}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium shadow bg-white text-gray-600 hover:border-gray-300 disabled:opacity-50 transition-all flex-shrink-0"
            title={t('map.refresh')}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {filtersOpen && (
          <div className="mx-2.5 w-[min(22rem,calc(100vw-1.25rem))] rounded-2xl border border-gray-200 bg-white p-4 shadow-lg pointer-events-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{t('map.filters')}</p>
                <p className="text-xs text-gray-500">
                  {hasTruncatedResults
                    ? t('map.showing_subset', { defaultValue: 'Showing the latest {{shown}} on map.', shown: reports.length })
                    : t('map.showing_all', { defaultValue: 'All matching reports are visible on the map.' })}
                </p>
              </div>
              {activeFilters > 0 && (
                <button
                  onClick={() => setFilters({ damage_level: 'all', status: 'all' })}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition-all hover:bg-red-50"
                >
                  {t('map.clear')}
                </button>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('map.legend_title')}</label>
                <select value={filters.damage_level} onChange={e => setFilters(f => ({ ...f, damage_level: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30">
                  <option value="all">{t('map.filter_damage')}</option>
                  <option value="destroyed">{t('map.filter_destroyed')}</option>
                  <option value="partial">{t('map.filter_partial')}</option>
                  <option value="minimal">{t('map.filter_minimal')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{t('map.status_label')}</label>
                <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30">
                  <option value="all">{t('map.filter_status')}</option>
                  <option value="verified">{t('map.filter_verified')}</option>
                  <option value="pending">{t('map.filter_pending')}</option>
                  <option value="flagged">{t('map.filter_flagged')}</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-600">
              <span className="font-semibold">{stats.total} {t('map.reports_count')}</span>
              {stats.urgent > 0 && <span className="text-red-600 font-bold">{stats.urgent} {t('map.urgent')}</span>}
              <span className="flex items-center gap-1 text-red-600"><span className="w-2.5 h-2.5 rounded-full bg-[#ef4135] inline-block" />{stats.destroyed}</span>
              <span className="flex items-center gap-1 text-orange-600"><span className="w-2.5 h-2.5 rounded-full bg-[#f5a623] inline-block" />{stats.partial}</span>
              <span className="flex items-center gap-1 text-green-600"><span className="w-2.5 h-2.5 rounded-full bg-[#27ae60] inline-block" />{stats.minimal}</span>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/50 pointer-events-none">
          <LoadingSpinner text={t('map.loading_reports', { defaultValue: 'Loading reports...' })} />
        </div>
      )}

      {!loading && mapUpdating && (
        <div className="absolute left-1/2 top-[5.2rem] z-[430] -translate-x-1/2 pointer-events-none">
          <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-lg backdrop-blur-sm">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-un-blue/35 border-t-un-blue" />
            <span>{t('common.loading')}</span>
          </div>
        </div>
      )}

      {!loading && loadError && (
        <div className="absolute left-1/2 top-[5.2rem] z-[431] -translate-x-1/2 px-3">
          <div className="rounded-2xl border border-red-200 bg-white/95 px-4 py-2 text-sm text-red-700 shadow-lg backdrop-blur-sm">
            {loadError}
          </div>
        </div>
      )}

      <MapContainer
        center={[20, 15]}
        zoom={3}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        preferCanvas={true}
      >
        <TrackedTileLayer tile={tile} onStateChange={handleTileStateChange} />
        <MapLifecycleBridge tileProvider={tileProvider} onMapReady={setMapInstance} onSearchMoveEnd={handleSearchMoveEnd} searchMoveToken={searchMoveToken} />
        <MapController flyTo={flyTo} onSearchMoveStart={handleSearchMoveStart} />
        <ViewportMarkers reports={reports} t={t} />
      </MapContainer>

      <div className="absolute right-4 top-[4.5rem] z-[420] pointer-events-auto md:hidden">
        <ZoomControls map={mapInstance} />
      </div>

      <div className="absolute right-4 top-4 z-[420] pointer-events-auto hidden md:block">
        <ZoomControls map={mapInstance} />
      </div>

      <div className="absolute bottom-14 right-4 z-[400] pointer-events-auto sm:bottom-12">
        <MapTileSelector value={tileProvider} onChange={setTileProvider} />
      </div>

      <div className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur-sm rounded-xl px-3 py-2.5 shadow text-xs">
        <p className="font-bold text-gray-700 mb-1.5 uppercase tracking-wide" style={{ fontSize: '10px' }}>{t('map.legend_title')}</p>
        {[["#ef4135", t('map.filter_destroyed')], ["#f5a623", t('map.filter_partial')], ["#27ae60", t('map.filter_minimal')]].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5 mb-1">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c }} />
            <span className="text-gray-600">{l}</span>
          </div>
        ))}
        <div className="border-t border-gray-100 mt-1 pt-1">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-3 h-3 rounded-full flex-shrink-0 border-2 border-red-500 bg-gray-300" />
            <span className="text-gray-600">{t('common.urgent')}</span>
          </div>
          <div className="text-gray-500 mt-1 space-y-0.5" style={{ fontSize: '10px' }}>
            <div className="font-semibold text-gray-700">{stats.total} {t('map.reports_count')}</div>
            {stats.urgent > 0 && <div className="text-red-600 font-semibold">{stats.urgent} {t('map.urgent')}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
