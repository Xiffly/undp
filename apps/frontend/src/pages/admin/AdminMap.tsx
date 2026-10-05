import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { RefreshCw, Filter, CheckCircle, Flag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type ReportMapStats } from '../../api/client';
import { FootprintFeatureCollection, Report } from '../../types';
import DamageBadge from '../../components/DamageBadge';
import MapTileSelector from '../../components/MapTileSelector';
import StatusBadge from '../../components/StatusBadge';
import { getTileLayer, type TileProvider } from '../../components/mapTiles';
import { getBuildingLabel, getLocalizedAddress, hasReportCoordinates } from '../../utils/reportLocation';
import { buildFeatureCollection, selectMatchingFootprints } from '../../utils/footprints';
import { formatRelativeTime } from '../../utils/relativeTime';

type LeafletIconDefaults = typeof L.Icon.Default.prototype & {
  _getIconUrl?: () => string;
};

delete (L.Icon.Default.prototype as LeafletIconDefaults)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DAMAGE_COLORS: Record<string, string> = { destroyed: '#ef4135', partial: '#f5a623', minimal: '#27ae60' };
const STATUS_COLORS: Record<string, string> = { verified: '#27ae60', pending: '#f5a623', flagged: '#ef4135', duplicate: '#999' };

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

export default function AdminMap() {
  const { t, i18n } = useTranslation();
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
  const [filters, setFilters] = useState({ damage_level: 'all', status: 'all', colorBy: 'damage' });
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [footprints, setFootprints] = useState<FootprintFeatureCollection | null>(null);
  const [tileProvider, setTileProvider] = useState<TileProvider>('standard');
  const reviewLanguage = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const tile = getTileLayer(tileProvider);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '500' };
      if (filters.damage_level !== 'all') params.damage_level = filters.damage_level;
      if (filters.status !== 'all') params.status = filters.status;
      const [dataResult, statsResult] = await Promise.allSettled([
        api.getAdminReports(params),
        api.getAdminReportStats(params),
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
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const fetchId = scheduleTask(() => {
      fetch().catch(() => {});
    });
    return () => window.clearTimeout(fetchId);
  }, [fetch]);

  useEffect(() => {
    api.getPublicFootprints('default').then(setFootprints).catch(() => setFootprints(null));
  }, []);

  const handleAction = async (id: string, action: 'verified' | 'flagged') => {
    setActionLoading(id);
    try {
      await api.updateReport(id, { status: action });
      await fetch();
    } finally {
      setActionLoading(null);
    }
  };

  const getColor = (report: Report) => (
    filters.colorBy === 'status'
      ? STATUS_COLORS[report.status] || '#999'
      : DAMAGE_COLORS[report.damage_level] || '#999'
  );

  const highlightedFootprints = buildFeatureCollection(
    selectMatchingFootprints(
      footprints,
      reports.filter((report) => report.footprint_set_id && (report.footprint_feature_id || report.footprint_feature_key))
    )
  );
  const mappableReports = reports.filter(hasReportCoordinates);

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 z-10">
        <span className="text-sm font-semibold text-gray-700">{stats.total} {t('map.reports_count')}</span>
        <button onClick={fetch} className="p-1.5 hover:bg-gray-100 rounded-lg">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
        <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
          <Filter size={14} /> {t('map.filters')}
        </button>
        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <select
              value={filters.damage_level}
              onChange={(event) => setFilters((current) => ({ ...current, damage_level: event.target.value }))}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
            >
              <option value="all">{t('map.filter_damage')}</option>
              <option value="destroyed">{t('map.filter_destroyed')}</option>
              <option value="partial">{t('map.filter_partial')}</option>
              <option value="minimal">{t('map.filter_minimal')}</option>
            </select>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
            >
              <option value="all">{t('map.filter_status')}</option>
              <option value="pending">{t('map.filter_pending')}</option>
              <option value="verified">{t('map.filter_verified')}</option>
              <option value="flagged">{t('map.filter_flagged')}</option>
            </select>
            <select
              value={filters.colorBy}
              onChange={(event) => setFilters((current) => ({ ...current, colorBy: event.target.value }))}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
            >
              <option value="damage">{t('map.color_by_damage')}</option>
              <option value="status">{t('map.color_by_status')}</option>
            </select>
            <div className="ml-0 flex flex-wrap items-center gap-3 text-xs text-gray-600 xl:ml-2">
              <span className="font-semibold">{stats.total} {t('map.reports_count')}</span>
              {stats.urgent > 0 && <span className="text-red-600 font-bold">{stats.urgent} {t('map.urgent')}</span>}
              <span className="flex items-center gap-1 text-red-600"><span className="w-2.5 h-2.5 rounded-full bg-[#ef4135] inline-block" />{stats.destroyed}</span>
              <span className="flex items-center gap-1 text-orange-600"><span className="w-2.5 h-2.5 rounded-full bg-[#f5a623] inline-block" />{stats.partial}</span>
              <span className="flex items-center gap-1 text-green-600"><span className="w-2.5 h-2.5 rounded-full bg-[#27ae60] inline-block" />{stats.minimal}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 relative">
        <MapContainer center={[15.35, 44.2]} zoom={8} style={{ height: '100%', width: '100%' }}>
          <TileLayer key={tile.key} url={tile.url} attribution={tile.attribution} />
          {highlightedFootprints.features.length > 0 && (
            <GeoJSON
              key={`admin-footprints-${highlightedFootprints.features.length}`}
              data={highlightedFootprints}
              style={() => ({
                color: '#0f766e',
                fillColor: '#14b8a6',
                fillOpacity: 0.18,
                weight: 2.25,
                opacity: 0.85,
              })}
            />
          )}
          {mappableReports.map((report) => (
            <CircleMarker
              key={report.id}
              center={[report.lat as number, report.lng as number]}
              radius={report.damage_level === 'destroyed' ? 11 : report.damage_level === 'partial' ? 9 : 7}
              fillColor={getColor(report)}
              color="white"
              weight={2}
              fillOpacity={0.9}
            >
              <Popup maxWidth={280} minWidth={240}>
                <div className="p-1 space-y-2">
                  {report.photos?.[0] && (
                    <img src={report.photos[0]} alt="" className="w-full h-28 object-cover rounded-lg" />
                  )}
                  <div className="flex gap-1.5 flex-wrap">
                    <DamageBadge level={report.damage_level} />
                    <StatusBadge status={report.status} />
                    {report.is_urgent && <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-semibold">{t('common.urgent', { defaultValue: 'URGENT' })}</span>}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-900">{report.infra_types?.join(', ')}</p>
                    {getBuildingLabel(report) && <p className="text-xs text-gray-500">{t('admin.admin_map.building_label', { defaultValue: 'Building' })}: {getBuildingLabel(report)}</p>}
                    {getLocalizedAddress(report) && <p className="text-xs text-gray-500">{t('admin.admin_map.location_label', { defaultValue: 'Location' })}: {getLocalizedAddress(report)}</p>}
                    {(report.translations?.[reviewLanguage]?.description || report.description) && <p className="text-xs text-gray-600 mt-1">{report.translations?.[reviewLanguage]?.description || report.description}</p>}
                    <p className="text-xs text-gray-400 mt-1">
                      {t('admin.admin_map.submitted_meta', {
                        defaultValue: '{{time}} | {{channel}}',
                        time: formatRelativeTime(t, report.submitted_at),
                        channel: report.channel,
                      })}
                    </p>
                  </div>
                  {report.status === 'pending' && (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleAction(report.id, 'verified')}
                        disabled={actionLoading === report.id}
                        className="flex-1 flex items-center justify-center gap-1 bg-green-500 text-white text-xs py-1.5 rounded-lg font-medium hover:bg-green-600"
                      >
                        <CheckCircle size={12} /> {t('map.filter_verified')}
                      </button>
                      <button
                        onClick={() => handleAction(report.id, 'flagged')}
                        disabled={actionLoading === report.id}
                        className="flex-1 flex items-center justify-center gap-1 bg-orange-400 text-white text-xs py-1.5 rounded-lg font-medium hover:bg-orange-500"
                      >
                        <Flag size={12} /> {t('map.filter_flagged')}
                      </button>
                    </div>
                  )}
                  <p className="text-xs font-mono text-gray-400">{report.id}</p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>

        <div className="absolute bottom-14 right-4 z-[400] pointer-events-auto sm:bottom-12">
          <MapTileSelector value={tileProvider} onChange={setTileProvider} />
        </div>

        <div className="absolute bottom-4 left-4 bg-white rounded-xl shadow-md px-3 py-2 z-10 text-xs">
          {filters.colorBy === 'damage' ? (
            <>
              <p className="font-semibold text-gray-700 mb-1.5">{t('map.legend_title')}</p>
              {[['#ef4135', t('map.filter_destroyed')], ['#f5a623', t('map.filter_partial')], ['#27ae60', t('map.filter_minimal')]].map(([color, label]) => (
                <div key={label} className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                  <span className="text-gray-600">{label}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="font-semibold text-gray-700 mb-1.5">{t('map.status_label')}</p>
              {[['#27ae60', t('map.filter_verified')], ['#f5a623', t('map.filter_pending')], ['#ef4135', t('map.filter_flagged')]].map(([color, label]) => (
                <div key={label} className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                  <span className="text-gray-600">{label}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
