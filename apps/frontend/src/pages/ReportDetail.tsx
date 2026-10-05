import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { ThumbsUp, Share2, ArrowLeft, Clock, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { FootprintFeatureCollection, Report } from '../types';
import DamageBadge from '../components/DamageBadge';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import { formatChoiceFallback, formatPressingNeedLabel } from '../utils/reportPresentation';
import { formatReportCoordinates, getBuildingLabel, getLocalizedAddress, hasReportCoordinates } from '../utils/reportLocation';
import { buildFeatureCollection, selectMatchingFootprints } from '../utils/footprints';
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

const DAMAGE_COLORS: Record<string, string> = { destroyed: '#ef4135', partial: '#f5a623', minimal: '#27ae60' };

function timeAgo(t: (key: string, options?: Record<string, unknown>) => string, d: string) {
  const seconds = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return t('report.time_seconds_ago', { count: seconds, defaultValue: '{{count}}s ago' });
  if (seconds < 3600) return t('report.time_minutes_ago', { count: Math.floor(seconds / 60), defaultValue: '{{count}}m ago' });
  if (seconds < 86400) return t('report.time_hours_ago', { count: Math.floor(seconds / 3600), defaultValue: '{{count}}h ago' });
  return t('report.time_days_ago', { count: Math.floor(seconds / 86400), defaultValue: '{{count}}d ago' });
}

function AiStatusBadge({ report }: { report: Report }) {
  const { t } = useTranslation();
  if (!report.ai_classification_status) return null;
  const style = report.ai_classification_status === 'completed'
    ? 'bg-emerald-100 text-emerald-700'
    : report.ai_classification_status === 'failed'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-sky-100 text-sky-700';
  const label = report.ai_classification_status === 'completed'
    ? t('report.ai_ready', { defaultValue: 'Completed' })
    : report.ai_classification_status === 'failed'
      ? t('report.ai_review', { defaultValue: 'AI Review' })
      : t('report.ai_pending', { defaultValue: 'Pending AI' });
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${style}`}>{label}</span>;
}

export default function ReportDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [footprints, setFootprints] = useState<FootprintFeatureCollection | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmState, setConfirmState] = useState<'idle' | 'confirmed' | 'already'>('idle');

  useSeo({
    title: report?.infra_name || report?.building_label || t('report.meta_title', { defaultValue: 'Crisis Report' }),
    description: report?.localized?.description || report?.description || t('report.meta_description', {
      defaultValue: 'Community-submitted crisis damage report detail.',
    }),
    canonicalPath: `/reports/${id || ''}`,
    index: false,
    follow: false,
  });

  useEffect(() => {
    if (!id) return;
    api.getReport(id).then(setReport).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    api.getPublicFootprints('default').then(setFootprints).catch(() => setFootprints(null));
  }, []);

  const handleConfirm = async () => {
    if (!id || confirmed) return;
    const response = await api.confirmReport(id);
    if (response?.status === 'already_confirmed') {
      setConfirmState('already');
      setConfirmed(true);
      if (report && typeof response.community_confirms === 'number') {
        setReport({ ...report, community_confirms: response.community_confirms });
      }
      return;
    }
    setConfirmState('confirmed');
    setConfirmed(true);
    if (report) {
      const nextCount = typeof response?.community_confirms === 'number'
        ? response.community_confirms
        : report.community_confirms + 1;
      setReport({ ...report, community_confirms: nextCount });
    }
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: t('report.share_title', {
          id,
          defaultValue: 'Crisis Report {{id}}',
        }),
        url: window.location.href,
      });
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  };

  if (loading) return <LoadingSpinner text={t('report.loading')} />;
  if (!report) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500 mb-4">{t('report.not_found')}</p>
        <Link to="/" className="text-un-blue hover:underline flex items-center justify-center gap-1">
          <ArrowLeft size={16} /> {t('common.back_to_map')}
        </Link>
      </div>
    );
  }

  const color = DAMAGE_COLORS[report.damage_level] || '#888';
  const localizedDescription = report.localized?.description || report.description;
  const localizedAddress = getLocalizedAddress(report);
  const buildingLabel = getBuildingLabel(report);
  const localizedInfraName = report.localized?.infra_name || report.infra_name;
  const selectedFootprints = buildFeatureCollection(selectMatchingFootprints(footprints, [report]));

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Link to="/" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-un-blue mb-4 transition-colors">
        <ArrowLeft size={16} /> {t('common.back_to_map')}
      </Link>

      <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <span className="font-mono text-xs text-gray-400">{report.id}</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              <DamageBadge level={report.damage_level} />
              <StatusBadge status={report.status} />
              <AiStatusBadge report={report} />
              {report.is_urgent && (
                <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-semibold">{t('common.urgent')}</span>
              )}
            </div>
          </div>
          <button onClick={handleShare} className="p-2 hover:bg-gray-100 rounded-xl text-gray-500 transition-colors" title={t('report.share')}>
            <Share2 size={18} />
          </button>
        </div>

        <h1 className="text-lg font-bold text-gray-900 mb-1">
          {report.infra_category
            ? `${t(`infra.${report.infra_category}`, { defaultValue: report.infra_category })} ${t('report.infrastructure_suffix')}`
            : t('report.infrastructure_damage')}
          {localizedInfraName && ` - ${localizedInfraName}`}
        </h1>

        {buildingLabel && (
          <p className="text-sm text-gray-600 mb-1">{t('report.building', { defaultValue: 'Building' })}: {buildingLabel}</p>
        )}
        {localizedAddress && (
          <p className="text-sm text-gray-600 mb-2">{t('report.location')}: {localizedAddress}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1"><Clock size={12} /> {timeAgo(t, report.submitted_at)}</span>
          <span className="flex items-center gap-1"><Wifi size={12} /> {t('report.via_channel', { channel: t(`common.channel_${report.channel}`, { defaultValue: report.channel }) })}</span>
          {report.crisis_type && <span>{t(`crisis_types.${report.crisis_type}`, { defaultValue: report.crisis_type })}</span>}
        </div>
      </div>

      {report.photos?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('report.photos')}</h2>
          <img src={report.photos[imgIdx]} alt="" className="w-full h-56 object-cover rounded-xl mb-2" />
          {report.photos.length > 1 && (
            <div className="flex gap-2">
              {report.photos.map((photo, index) => (
                <img
                  key={index}
                  src={photo}
                  alt=""
                  onClick={() => setImgIdx(index)}
                  className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-opacity ${
                    index === imgIdx ? 'ring-2 ring-un-blue opacity-100' : 'opacity-60 hover:opacity-90'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {localizedDescription && (
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('report.description')}</h2>
          <p className="text-sm text-gray-700 leading-relaxed">{localizedDescription}</p>
        </div>
      )}

      {report.ai_classification_status && report.ai_classification?.reasoning && (
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('report.ai_damage_review', { defaultValue: 'AI Damage Review' })}</h2>
          <div className="flex items-center gap-2 mb-2">
            <AiStatusBadge report={report} />
          </div>
          <p className="text-sm text-gray-700">{report.ai_classification.reasoning}</p>
        </div>
      )}

      {(report.electricity_condition || report.health_services || (Array.isArray(report.pressing_needs) && report.pressing_needs.length > 0)) && (
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('report.community_impact')}</h2>
          <div className="space-y-2 text-sm">
            {report.electricity_condition && (
              <div className="flex gap-2">
                <span className="text-gray-400 w-28 flex-shrink-0">{t('report.electricity')}</span>
                <span className="text-gray-700">{t(`electricity.${report.electricity_condition}`, { defaultValue: formatChoiceFallback(report.electricity_condition) })}</span>
              </div>
            )}
            {report.health_services && (
              <div className="flex gap-2">
                <span className="text-gray-400 w-28 flex-shrink-0">{t('report.health')}</span>
                <span className="text-gray-700">{t(`health.${report.health_services}`, { defaultValue: formatChoiceFallback(report.health_services) })}</span>
              </div>
            )}
            {Array.isArray(report.pressing_needs) && report.pressing_needs.length > 0 && (
              <div className="flex gap-2">
                <span className="text-gray-400 w-28 flex-shrink-0">{t('report.needs')}</span>
                <div className="flex flex-wrap gap-1">
                  {report.pressing_needs.map((need) => (
                    <span key={need} className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full">
                      {need.startsWith('other:')
                        ? formatPressingNeedLabel(need)
                        : t(`needs.${need}`, { defaultValue: formatPressingNeedLabel(need) })}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {report.has_debris && report.has_debris !== 'unknown' && (
              <div className="flex gap-2">
                <span className="text-gray-400 w-28 flex-shrink-0">{t('report.debris')}</span>
                <span className="text-gray-700">{t(`submit.debris_${report.has_debris}`, { defaultValue: report.has_debris })}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {hasReportCoordinates(report) && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('report.location')}</h2>
          <div className="h-48 rounded-xl overflow-hidden">
            <MapContainer center={[report.lat as number, report.lng as number]} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false} dragging={false} scrollWheelZoom={false}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              />
              {selectedFootprints.features.length > 0 && (
                <GeoJSON
                  key={`${report.id}-${selectedFootprints.features.length}`}
                  data={selectedFootprints}
                  style={() => ({
                    color,
                    fillColor: color,
                    fillOpacity: 0.22,
                    weight: 3,
                    opacity: 0.95,
                  })}
                />
              )}
              <CircleMarker center={[report.lat as number, report.lng as number]} radius={10} pathOptions={{ color: 'white', fillColor: color, fillOpacity: 0.9, weight: 2 }} />
            </MapContainer>
          </div>
          <p className="text-xs text-gray-400 mt-2 font-mono">{formatReportCoordinates(report, 6)}</p>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('report.community_verification')}</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold text-gray-900">{report.community_confirms}</p>
            <p className="text-xs text-gray-500">{t('report.community_confirmations')}</p>
          </div>
          <button
            onClick={handleConfirm}
            disabled={confirmed}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              confirmed ? 'bg-green-100 text-green-700 cursor-default' : 'bg-un-blue text-white hover:bg-blue-600 active:scale-95'
            }`}
          >
            <ThumbsUp size={16} />
            {confirmState === 'already'
              ? t('report.already_confirmed')
              : confirmed
                ? t('report.confirmed')
                : t('report.confirm_report')}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          {t('report.confirmation_hint')}
        </p>
      </div>
    </div>
  );
}
