const translationPollStepsMs = [2000, 4000, 8000, 12000, 15000];
import { scheduleTask, getAiStatusLabel, CRISIS_TYPE_KEYS, CRISIS_TYPE_LABELS, ELEC_LABELS, HEALTH_LABELS } from './presentation';
import { getApiErrorMessage, toDraftCoordinate, hasDraftCoordinates, hasAnyTargetTranslation } from './reportHelpers';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { CheckCircle, Flag, RefreshCw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { Report } from '../../types';
import DamageBadge from '../DamageBadge';
import LoadingSpinner from '../LoadingSpinner';
import StatusBadge from '../StatusBadge';
import { getLanguageMeta } from '../../config/languages';
import { formatChoiceFallback, formatMediaStateLabel, formatPressingNeedLabel, stripAiModelPrefix } from '../../utils/reportPresentation';

export type LocationDraft = {
  lat: number;
  lng: number;
  building_label: string;
  address_text: string;
  location_capture_mode: string;
};

function formatCaptureMode(
  t: (key: string, options?: Record<string, unknown>) => string,
  mode?: string | null,
) {
  if (mode === 'manual_coordinates') return t('admin.reports.capture_method_manual_coordinates', { defaultValue: 'Manual coordinates' });
  if (mode === 'gps') return t('admin.reports.capture_method_gps', { defaultValue: 'GPS' });
  if (mode === 'map') return t('admin.reports.capture_method_map', { defaultValue: 'Map pin' });
  if (mode === 'search') return t('admin.reports.capture_method_search', { defaultValue: 'Address search' });
  if (mode === 'footprint') return t('admin.reports.capture_method_footprint', { defaultValue: 'Building footprint' });
  return t('queue.unknown', { defaultValue: 'Unknown' });
}

export function ReviewLocationMarker({
  lat,
  lng,
  onChange,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(event) {
      onChange(event.latlng.lat, event.latlng.lng);
    },
  });

  if (!hasDraftCoordinates(lat, lng)) return null;

  return (
    <Marker
      position={[lat, lng]}
      draggable
      eventHandlers={{
        dragend: (event) => {
          const marker = event.target;
          const next = marker.getLatLng();
          onChange(next.lat, next.lng);
        },
      }}
    />
  );
}

export function ReviewMapFlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();

  useEffect(() => {
    if (!hasDraftCoordinates(lat, lng)) return;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
  }, [lat, lng, map]);

  return null;
}

export function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-32 flex-shrink-0 text-gray-400">{label}</span>
      <span className="font-medium text-gray-700">{value}</span>
    </div>
  );
}

export function TranslationStatusBadge({ report }: { report: Report }) {
  const { t } = useTranslation();
  if (!report.translation_status) return null;
  const style =
    report.translation_status === 'completed'
      ? 'bg-emerald-100 text-emerald-700'
      : report.translation_status === 'failed'
        ? 'bg-amber-100 text-amber-700'
        : report.translation_status === 'not_needed'
          ? 'bg-slate-100 text-slate-700'
          : 'bg-sky-100 text-sky-700';
  const label =
    report.translation_status === 'completed'
      ? t('admin.reports.translation_ready', { defaultValue: 'Translation Ready' })
      : report.translation_status === 'failed'
        ? t('admin.reports.translation_review', { defaultValue: 'Translation Review' })
        : report.translation_status === 'not_needed'
          ? t('admin.reports.translation_original', { defaultValue: 'Original Only' })
          : t('admin.reports.translation_pending', { defaultValue: 'Translation Pending' });
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>{label}</span>;
}

export function BilingualValue({
  original,
  translated,
  translatedLabel,
}: {
  original?: string | null;
  translated?: string | null;
  translatedLabel: string;
}) {
  if (!original && !translated) return null;
  return (
    <div className="space-y-1">
      {original && <p className="text-sm text-gray-700">{original}</p>}
      {translated && translated !== original && (
        <p className="text-xs text-un-blue">{translatedLabel}: {translated}</p>
      )}
    </div>
  );
}

export function AiStatusBadge({ report }: { report: Report }) {
  const { t } = useTranslation();
  if (!report.ai_classification_status) return null;

  const style =
    report.ai_classification_status === 'completed'
      ? 'bg-emerald-100 text-emerald-700'
      : report.ai_classification_status === 'failed'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-sky-100 text-sky-700';

  const label =
    report.ai_classification_status === 'completed'
      ? t('report.ai_ready', { defaultValue: 'Completed' })
      : report.ai_classification_status === 'failed'
        ? t('admin.reports.ai_failed', { defaultValue: 'AI Failed' })
        : t('report.ai_pending', { defaultValue: 'Pending AI' });

  return <span className={`inline-flex max-w-full items-center justify-center whitespace-normal break-words rounded-full px-2 py-0.5 text-center text-xs font-semibold leading-tight ${style}`}>{label}</span>;
}

export function ReportModal({
  reportId,
  onClose,
  onAction,
  translationTarget,
}: {
  reportId: string;
  onClose: () => void;
  onAction: () => void | Promise<void>;
  translationTarget: string;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState('');
  const [currentReport, setCurrentReport] = useState<Report | null>(null);
  const [notes, setNotes] = useState('');
  const [imgIdx, setImgIdx] = useState(0);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>({
    lat: 0,
    lng: 0,
    building_label: '',
    address_text: '',
    location_capture_mode: 'unknown',
  });
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationLookupLoading, setLocationLookupLoading] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [locationSuccess, setLocationSuccess] = useState('');
  const [translationPollExpired, setTranslationPollExpired] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(typeof document === 'undefined' ? true : !document.hidden);
  const pollAttemptRef = useRef(0);
  const pollStartedAtRef = useRef<number | null>(null);
  const translationLabel = getLanguageMeta(translationTarget).code.toUpperCase();
  const translationPollTimeoutMs = 90000;


  const syncDraftsFromReport = useCallback((nextReport: Report) => {
    setNotes(stripAiModelPrefix(nextReport.internal_notes));
    setLocationDraft({
      lat: toDraftCoordinate(nextReport.lat),
      lng: toDraftCoordinate(nextReport.lng),
      building_label: nextReport.building_label || '',
      address_text: nextReport.address_text || '',
      location_capture_mode: nextReport.location_capture_mode || 'unknown',
    });
    setImgIdx((current) => {
      const maxIndex = Math.max((nextReport.photos?.length || 1) - 1, 0);
      return Math.min(current, maxIndex);
    });
  }, []);

  const loadReport = useCallback(async (options?: { preserveDrafts?: boolean }) => {
    setReportError('');
    setReportLoading(true);
    try {
      const nextReport = await api.getAdminReport(reportId, { target_lang: translationTarget });
      setCurrentReport(nextReport);
      setTranslationPollExpired(false);
      if (!options?.preserveDrafts) {
        syncDraftsFromReport(nextReport);
      }
    } catch (error: unknown) {
      setReportError(getApiErrorMessage(error, t('admin.reports.load_failed', { defaultValue: 'Failed to load report.' })));
    } finally {
      setReportLoading(false);
    }
  }, [reportId, syncDraftsFromReport, t, translationTarget]);

  useEffect(() => {
    pollAttemptRef.current = 0;
    pollStartedAtRef.current = null;
    const loadId = scheduleTask(() => {
      loadReport().catch(() => {});
    });
    return () => window.clearTimeout(loadId);
  }, [loadReport]);

  useEffect(() => {
    const handleVisibility = () => setIsDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!currentReport || currentReport.translation_status !== 'pending') {
      pollAttemptRef.current = 0;
      pollStartedAtRef.current = null;
      return;
    }
    if (translationPollExpired || !isDocumentVisible) return;

    const startedAt = pollStartedAtRef.current ?? Date.now();
    pollStartedAtRef.current = startedAt;
    if ((Date.now() - startedAt) >= translationPollTimeoutMs) {
      setTranslationPollExpired(true);
      return;
    }

    const hasPartialTranslation = hasAnyTargetTranslation(currentReport, translationTarget);
    const delay = hasPartialTranslation
      ? translationPollStepsMs[0]
      : translationPollStepsMs[Math.min(pollAttemptRef.current, translationPollStepsMs.length - 1)];
    const timeoutId = window.setTimeout(async () => {
      pollAttemptRef.current = hasPartialTranslation ? 0 : pollAttemptRef.current + 1;
      try {
        const nextReport = await api.getAdminReport(reportId, { target_lang: translationTarget });
        setCurrentReport(nextReport);
      } catch {
        // Poll failures are transient; the next attempt can retry while the modal stays open.
      }
    }, delay);

    return () => window.clearTimeout(timeoutId);
  }, [currentReport, isDocumentVisible, reportId, translationPollExpired, translationTarget]);

  const doAction = async (action: 'verified' | 'flagged' | 'duplicate' | 'rejected') => {
    if (!currentReport) return;
    setLoading(true);
    try {
      await api.updateReport(currentReport.id, { status: action, internal_notes: notes });
      await Promise.resolve(onAction());
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const doDelete = async () => {
    if (!currentReport) return;
    if (!confirm(t('admin.reports.confirm_delete', { defaultValue: 'Delete this report? This cannot be undone.' }))) return;
    setLoading(true);
    try {
      await api.deleteReport(currentReport.id);
      await Promise.resolve(onAction());
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const lookupAddress = async () => {
    if (!currentReport) return;
    try {
      setLocationLookupLoading(true);
      setLocationError('');
      setLocationSuccess('');
      const response = await api.reverseGeocodeReportLocation({
        lat: locationDraft.lat,
        lng: locationDraft.lng,
      });
      if (response.address_text) {
        setLocationDraft((current) => ({ ...current, address_text: response.address_text || '' }));
        setLocationSuccess(t('admin.reports.location_lookup_completed', { defaultValue: 'Address lookup completed. Review the result before saving.' }));
      } else {
        setLocationSuccess(t('admin.reports.location_lookup_no_result', { defaultValue: 'Lookup completed, but no nearby address was returned.' }));
      }
    } catch (error: unknown) {
      setLocationError(getApiErrorMessage(error, t('admin.reports.location_lookup_failed', { defaultValue: 'Failed to lookup address.' })));
    } finally {
      setLocationLookupLoading(false);
    }
  };

  const saveLocation = async () => {
    if (!currentReport) return;
    try {
      setLocationSaving(true);
      setLocationError('');
      setLocationSuccess('');
      const updated = await api.updateReport(currentReport.id, {
        ...(hasDraftCoordinates(locationDraft.lat, locationDraft.lng)
          ? { lat: locationDraft.lat, lng: locationDraft.lng }
          : {}),
        building_label: locationDraft.building_label,
        address_text: locationDraft.address_text,
        location_capture_mode: locationDraft.location_capture_mode,
      }) as Report;
      setCurrentReport(updated);
      setLocationDraft({
        lat: toDraftCoordinate(updated.lat),
        lng: toDraftCoordinate(updated.lng),
        building_label: updated.building_label || '',
        address_text: updated.address_text || '',
        location_capture_mode: updated.location_capture_mode || 'unknown',
      });
      await Promise.resolve(onAction());
      setLocationSuccess(t('admin.reports.location_saved', { defaultValue: 'Location saved.' }));
    } catch (error: unknown) {
      setLocationError(getApiErrorMessage(error, t('admin.reports.location_save_failed', { defaultValue: 'Failed to save location.' })));
    } finally {
      setLocationSaving(false);
    }
  };

  const needs = Array.isArray(currentReport?.pressing_needs) ? currentReport.pressing_needs : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <span className="font-mono text-sm text-gray-500">{currentReport?.id || reportId}</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {currentReport && <DamageBadge level={currentReport.damage_level} />}
              {currentReport && <StatusBadge status={currentReport.status} />}
              {currentReport && <AiStatusBadge report={currentReport} />}
              {currentReport && <TranslationStatusBadge report={currentReport} />}
              {currentReport?.source_language && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 uppercase">
                  {currentReport.source_language}
                </span>
              )}
              {currentReport?.is_urgent && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                  {t('common.urgent', { defaultValue: 'URGENT' })}
                </span>
              )}
              {currentReport?.translation_status === 'pending' && (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                  {isDocumentVisible
                    ? t('admin.reports.translation_live_checking', { defaultValue: 'Checking translation status...' })
                    : t('admin.reports.translation_paused_hidden', { defaultValue: 'Translation check paused in background tab' })}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadReport().catch(() => {})}
              disabled={reportLoading}
              className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50"
              aria-label={t('map.refresh', { defaultValue: 'Refresh' })}
            >
              <RefreshCw size={16} className={reportLoading ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={onClose} className="rounded-xl p-2 hover:bg-gray-100">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {reportError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{reportError}</div>}
          {translationPollExpired && currentReport?.translation_status === 'pending' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {t('admin.reports.translation_check_expired', { defaultValue: 'Automatic translation checks paused. Use refresh to check again.' })}
            </div>
          )}
          {reportLoading && !currentReport ? (
            <LoadingSpinner text={t('admin.reports.loading', { defaultValue: 'Loading reports...' })} />
          ) : currentReport ? (
            <>
              {currentReport.photos?.length > 0 && (
                <div>
                  <img src={currentReport.photos[imgIdx]} alt="" className="mb-2 h-48 w-full rounded-xl object-cover" />
                  {currentReport.photos.length > 1 && (
                    <div className="flex gap-1.5">
                      {currentReport.photos.map((_, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setImgIdx(index)}
                          className={`h-2 w-2 rounded-full ${index === imgIdx ? 'bg-un-blue' : 'bg-gray-300'}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{t('admin.reports.location_review', { defaultValue: 'Location Review' })}</h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-600">
                    {formatCaptureMode(t, locationDraft.location_capture_mode)}
                  </span>
                </div>

                {locationError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{locationError}</div>}
                {locationSuccess && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{locationSuccess}</div>}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.building_label', { defaultValue: 'Building label' })}</span>
                    <input
                      type="text"
                      value={locationDraft.building_label}
                      onChange={(event) => setLocationDraft((current) => ({ ...current, building_label: event.target.value }))}
                      placeholder={t('admin.reports.building_label_placeholder', { defaultValue: 'Dataset building name or structure label' })}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.location_description', { defaultValue: 'Location description' })}</span>
                    <input
                      type="text"
                      value={locationDraft.address_text}
                      onChange={(event) => setLocationDraft((current) => ({ ...current, address_text: event.target.value }))}
                      placeholder={t('admin.reports.location_description_placeholder', { defaultValue: 'Address, landmark, access notes, or place description' })}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                    />
                    {currentReport.translations?.[translationTarget]?.address_text && currentReport.translations?.[translationTarget]?.address_text !== currentReport.address_text && (
                      <p className="mt-1 text-xs text-un-blue">{translationLabel}: {currentReport.translations?.[translationTarget]?.address_text}</p>
                    )}
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.latitude', { defaultValue: 'Latitude' })}</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={locationDraft.lat}
                      onChange={(event) => setLocationDraft((current) => ({ ...current, lat: Number(event.target.value), location_capture_mode: 'manual_coordinates' }))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.longitude', { defaultValue: 'Longitude' })}</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={locationDraft.lng}
                      onChange={(event) => setLocationDraft((current) => ({ ...current, lng: Number(event.target.value), location_capture_mode: 'manual_coordinates' }))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.capture_method', { defaultValue: 'Capture Method' })}</span>
                    <select
                      value={locationDraft.location_capture_mode}
                      onChange={(event) => setLocationDraft((current) => ({ ...current, location_capture_mode: event.target.value }))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                    >
                      {['gps', 'map', 'search', 'footprint', 'manual_coordinates', 'unknown'].map((mode) => (
                        <option key={mode} value={mode}>{formatCaptureMode(t, mode)}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <MapContainer center={hasDraftCoordinates(locationDraft.lat, locationDraft.lng) ? [locationDraft.lat, locationDraft.lng] : [15.35, 44.2]} zoom={hasDraftCoordinates(locationDraft.lat, locationDraft.lng) ? 14 : 6} style={{ height: 220, width: '100%' }}>
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    />
                    <ReviewMapFlyTo lat={locationDraft.lat} lng={locationDraft.lng} />
                    <ReviewLocationMarker
                      lat={locationDraft.lat}
                      lng={locationDraft.lng}
                      onChange={(lat, lng) => setLocationDraft((current) => ({ ...current, lat, lng, location_capture_mode: 'map' }))}
                    />
                  </MapContainer>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={lookupAddress}
                    disabled={locationLookupLoading}
                    className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white disabled:opacity-60"
                  >
                    {locationLookupLoading
                      ? t('admin.reports.looking_up', { defaultValue: 'Looking up...' })
                      : t('admin.reports.lookup_address', { defaultValue: 'Lookup Address' })}
                  </button>
                  <button
                    type="button"
                    onClick={saveLocation}
                    disabled={locationSaving}
                    className="rounded-xl bg-un-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
                  >
                    {locationSaving
                      ? t('admin.reports.save_location_loading', { defaultValue: 'Saving...' })
                      : t('admin.reports.save_location', { defaultValue: 'Save Location' })}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <InfoRow label={t('report.building', { defaultValue: 'Building' })} value={currentReport.building_label || ''} />
                <InfoRow label={t('report.location', { defaultValue: 'Location' })} value={currentReport.address_text || ''} />
                <InfoRow
                  label={t('admin.reports.crisis_type', { defaultValue: 'Crisis Type' })}
                  value={currentReport.crisis_type ? t(CRISIS_TYPE_KEYS[currentReport.crisis_type] || '', { defaultValue: CRISIS_TYPE_LABELS[currentReport.crisis_type] || currentReport.crisis_type }) : ''}
                />
                <InfoRow
                  label={t('admin.reports.category', { defaultValue: 'Category' })}
                  value={currentReport.infra_category ? t(`infra.${currentReport.infra_category}`, { defaultValue: currentReport.infra_category }) : ''}
                />
                <div className="flex gap-2 text-sm">
                  <span className="w-32 flex-shrink-0 text-gray-400">{t('admin.reports.name', { defaultValue: 'Name' })}</span>
                  <BilingualValue
                    original={currentReport.infra_name}
                    translated={currentReport.translations?.[translationTarget]?.infra_name}
                    translatedLabel={translationLabel}
                  />
                </div>
                <InfoRow
                  label={t('report.debris', { defaultValue: 'Debris' })}
                  value={currentReport.has_debris ? t(`submit.debris_${currentReport.has_debris}`, { defaultValue: currentReport.has_debris }) : ''}
                />
                <InfoRow label={t('admin.reports.submitted', { defaultValue: 'Submitted' })} value={new Date(currentReport.submitted_at).toLocaleString()} />
                <InfoRow
                  label={t('admin.reports.channel', { defaultValue: 'Channel' })}
                  value={t(`common.channel_${currentReport.channel}`, { defaultValue: currentReport.channel })}
                />
                <InfoRow label={t('admin.reports.confirms', { defaultValue: 'Confirms' })} value={String(currentReport.community_confirms)} />
                <InfoRow label={t('admin.reports.photo_count', { defaultValue: 'Photos attached' })} value={String(currentReport.photo_count ?? currentReport.photos?.length ?? 0)} />
                <InfoRow label={t('admin.reports.media_state', { defaultValue: 'Media state' })} value={formatMediaStateLabel(currentReport.media_state)} />
                <InfoRow label={t('admin.reports.ai_status', { defaultValue: 'AI status' })} value={getAiStatusLabel(currentReport, t)} />
                <InfoRow label={t('admin.reports.source_language', { defaultValue: 'Source language' })} value={currentReport.source_language?.toUpperCase()} />
                <InfoRow
                  label={t('admin.reports.translation_status', { defaultValue: 'Translation' })}
                  value={currentReport.translation_status ? (
                    currentReport.translation_status === 'completed'
                      ? t('admin.reports.translation_ready', { defaultValue: 'Translation Ready' })
                      : currentReport.translation_status === 'failed'
                        ? t('admin.reports.translation_review', { defaultValue: 'Translation Review' })
                        : currentReport.translation_status === 'not_needed'
                          ? t('admin.reports.translation_original', { defaultValue: 'Original Only' })
                          : t('admin.reports.translation_pending', { defaultValue: 'Translation Pending' })
                  ) : ''}
                />
              </div>

              <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-un-dark">
                  {t('admin.reports.community_impact', { defaultValue: 'Community Impact Assessment' })}
                </p>
                <InfoRow
                  label={t('report.electricity', { defaultValue: 'Electricity' })}
                  value={currentReport.electricity_condition ? t(`electricity.${currentReport.electricity_condition}`, { defaultValue: ELEC_LABELS[currentReport.electricity_condition] || formatChoiceFallback(currentReport.electricity_condition) }) : ''}
                />
                <InfoRow
                  label={t('report.health', { defaultValue: 'Health' })}
                  value={currentReport.health_services ? t(`health.${currentReport.health_services}`, { defaultValue: HEALTH_LABELS[currentReport.health_services] || formatChoiceFallback(currentReport.health_services) }) : ''}
                />
                {needs.length > 0 && (
                  <div className="flex gap-2 text-sm">
                    <span className="w-32 flex-shrink-0 text-gray-400">{t('report.needs', { defaultValue: 'Needs' })}</span>
                    <div className="flex flex-wrap gap-1">
                      {needs.map((need) => (
                        <span key={need} className="rounded-md bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700">
                          {need.startsWith('other:') ? formatPressingNeedLabel(need) : t(`needs.${need}`, { defaultValue: formatPressingNeedLabel(need) })}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {currentReport.description && (
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="mb-1 text-xs font-semibold text-gray-400">{t('report.description', { defaultValue: 'Description' })}</p>
                  <BilingualValue
                    original={currentReport.description}
                    translated={currentReport.translations?.[translationTarget]?.description}
                    translatedLabel={translationLabel}
                  />
                </div>
              )}

              {currentReport.ai_classification?.reasoning && (
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="mb-1 text-xs font-semibold text-gray-400">{t('report.ai_damage_review', { defaultValue: 'AI Damage Review' })}</p>
                  <p className="text-sm text-gray-700">{currentReport.ai_classification.reasoning}</p>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">
                  {t('admin.reports.internal_notes', { defaultValue: 'Internal Notes (team only)' })}
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="w-full resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                  placeholder={t('admin.reports.internal_notes_placeholder', { defaultValue: 'Add notes visible only to the admin team...' })}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => doAction('verified')}
                  disabled={loading}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-500 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-60"
                >
                  <CheckCircle size={14} />
                  {t('admin.common.verify', { defaultValue: 'Verify' })}
                </button>
                <button
                  type="button"
                  onClick={() => doAction('flagged')}
                  disabled={loading}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-500 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-60"
                >
                  <Flag size={14} />
                  {t('admin.common.flag', { defaultValue: 'Flag' })}
                </button>
                <button
                  type="button"
                  onClick={() => doAction('duplicate')}
                  disabled={loading}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-500 py-2 text-sm font-medium text-white hover:bg-gray-600 disabled:opacity-60"
                >
                  {t('common.duplicate', { defaultValue: 'Duplicate' })}
                </button>
                <button
                  type="button"
                  onClick={() => doAction('rejected')}
                  disabled={loading}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {t('common.rejected', { defaultValue: 'Rejected' })}
                </button>
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={loading}
                  className="rounded-xl border border-red-200 p-2 text-red-500 hover:bg-red-50"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
