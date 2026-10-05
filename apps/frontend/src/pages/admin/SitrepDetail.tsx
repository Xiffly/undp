import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { ArrowLeft, ExternalLink, FileText, MapPinned, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import LoadingSpinner from '../../components/LoadingSpinner';
import DamageBadge from '../../components/DamageBadge';
import StatusBadge from '../../components/StatusBadge';
import type { Report } from '../../types';
import { getLocationLine, hasReportCoordinates } from '../../utils/reportLocation';

type SitrepStats = {
  total?: number;
  verified?: number;
  urgent?: number;
  destroyed?: number;
  partial?: number;
  minimal?: number;
  crisisTypes?: string[];
  infraCategories?: string[];
  needsCounts?: Record<string, number>;
};

type SitrepFilters = {
  bbox?: string | null;
  crisis_event?: string | null;
  since?: string | null;
  focus_area?: string | null;
  scope?: {
    resolved_name?: string | null;
    scope_level?: string | null;
    country_name?: string | null;
    admin1?: string | null;
    locality?: string | null;
    bbox?: string | null;
  } | null;
  duplicate_radius_m?: number | null;
  duplicate_time_hours?: number | null;
  candidate_report_count?: number | null;
  outside_scope_excluded?: number | null;
  duplicate_reports_excluded?: number | null;
  status_reports_excluded?: number | null;
};

type SitrepSourceReport = (Report & { unavailable?: false }) | { id: string; unavailable: true };

type SitrepDetailResponse = {
  sitrep: {
    id: string;
    generated_at: string;
    report_count: number;
    content: string;
    focus_area?: string | null;
    model: string;
    preview: string;
  };
  stats: SitrepStats;
  filters: SitrepFilters;
  source_report_ids: string[];
  source_reports: SitrepSourceReport[];
};

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

function SourceReportsBounds({ reports }: { reports: Report[] }) {
  const map = useMap();

  useEffect(() => {
    if (reports.length === 0) return;
    const bounds = reports.map((report) => [report.lat as number, report.lng as number] as [number, number]);
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [map, reports]);

  return null;
}

function isUnavailableSourceReport(report: SitrepSourceReport): report is { id: string; unavailable: true } {
  return 'unavailable' in report && report.unavailable === true;
}

function GalleryLightbox({
  items,
  activeIndex,
  onClose,
  onSelect,
}: {
  items: Array<{ photo: string; reportId: string; caption: string; index: number }>;
  activeIndex: number;
  onClose: () => void;
  onSelect: (index: number) => void;
}) {
  const activeItem = items[activeIndex];
  if (!activeItem) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">{activeItem.reportId}</div>
            <div className="text-xs text-gray-500">{activeItem.caption}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        <div className="bg-black px-4 py-4">
          <img src={activeItem.photo} alt={`${activeItem.reportId} photo ${activeItem.index + 1}`} className="max-h-[70vh] w-full rounded-xl object-contain" />
        </div>
        {items.length > 1 && (
          <div className="grid max-h-40 grid-cols-3 gap-2 overflow-y-auto p-4 sm:grid-cols-5">
            {items.map((item, index) => (
              <button
                key={`${item.reportId}-${item.index}`}
                type="button"
                onClick={() => onSelect(index)}
                className={`overflow-hidden rounded-xl border ${index === activeIndex ? 'border-un-blue' : 'border-gray-200'}`}
              >
                <img src={item.photo} alt={`${item.reportId} thumbnail ${item.index + 1}`} className="h-20 w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SitrepDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SitrepDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const response = await api.getSitrepDetail(id) as SitrepDetailResponse;
        setDetail(response);
      } catch (err: unknown) {
        setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('admin.sitrep_detail.load_failed', { defaultValue: 'Failed to load situation report detail.' }));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, t]);

  const availableReports = useMemo(() => (detail?.source_reports || []).filter((report): report is Report => !isUnavailableSourceReport(report)), [detail]);
  const mappableReports = useMemo(() => availableReports.filter(hasReportCoordinates), [availableReports]);

  const galleryItems = useMemo(
    () =>
      availableReports.flatMap((report) =>
        (report.photos || []).map((photo, index) => ({
          photo,
          reportId: report.id,
          caption: report.infra_name || getLocationLine(report),
          index,
        }))
      ),
    [availableReports]
  );
  const topNeeds = useMemo(() => {
    const entries = Object.entries(detail?.stats?.needsCounts || {});
    return entries.sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [detail]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <LoadingSpinner text={t('admin.sitrep_detail.loading', { defaultValue: 'Loading situation report...' })} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error || t('admin.sitrep_detail.not_found', { defaultValue: 'Situation report not found.' })}</div>
        <div className="mt-4">
          <Link to="/admin/reports" className="text-sm font-medium text-un-blue hover:underline">
            {t('admin.sitrep_detail.back_to_reports', { defaultValue: 'Back to Reports' })}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <button type="button" onClick={() => navigate('/admin/reports')} className="inline-flex items-center gap-2 text-sm font-medium text-un-blue hover:underline">
            <ArrowLeft size={16} />
            {t('admin.sitrep_detail.back_to_reports', { defaultValue: 'Back to Reports' })}
          </button>
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-un-blue" />
            <h1 className="text-2xl font-bold text-gray-900">{t('admin.sitrep_detail.title', { defaultValue: 'Situation Report' })}</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-gray-500">
            <span>{new Date(detail.sitrep.generated_at).toLocaleString()}</span>
            <span className="rounded-full bg-un-light px-2 py-0.5 text-xs text-un-dark">
              {t('admin.sitrep_detail.report_count', { count: detail.sitrep.report_count, defaultValue: '{{count}} reports' })}
            </span>
            {detail.sitrep.focus_area && <span>{t('admin.sitrep_detail.focus_area', { area: detail.sitrep.focus_area, defaultValue: 'Focus area: {{area}}' })}</span>}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label={t('admin.sitrep_detail.total_reports', { defaultValue: 'Total reports' })} value={detail.stats.total || detail.sitrep.report_count} />
        <SummaryCard label={t('common.verified', { defaultValue: 'Verified' })} value={detail.stats.verified || 0} />
        <SummaryCard label={t('common.urgent', { defaultValue: 'URGENT' })} value={detail.stats.urgent || 0} />
        <SummaryCard label={t('map.filter_destroyed', { defaultValue: 'Destroyed' })} value={detail.stats.destroyed || 0} />
        <SummaryCard label={t('admin.sitrep_detail.partial_minimal', { defaultValue: 'Partial / Minimal' })} value={`${detail.stats.partial || 0} / ${detail.stats.minimal || 0}`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">{t('admin.sitrep_detail.full_report', { defaultValue: 'Full Situation Report' })}</h2>
          <div className="mt-4 whitespace-pre-line rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm leading-7 text-gray-700">
            {detail.sitrep.content}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">{t('admin.sitrep_detail.snapshot_summary', { defaultValue: 'Snapshot Summary' })}</h2>
          <div className="mt-4 space-y-3 text-sm text-gray-700">
            {detail.stats.crisisTypes && detail.stats.crisisTypes.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.sitrep_detail.crisis_types', { defaultValue: 'Crisis Types' })}</div>
                <div className="mt-1">{detail.stats.crisisTypes.join(', ')}</div>
              </div>
            )}
            {detail.stats.infraCategories && detail.stats.infraCategories.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.sitrep_detail.infrastructure_categories', { defaultValue: 'Infrastructure Categories' })}</div>
                <div className="mt-1">{detail.stats.infraCategories.join(', ')}</div>
              </div>
            )}
            {topNeeds.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.sitrep_detail.top_needs', { defaultValue: 'Top Needs' })}</div>
                <div className="mt-1">{topNeeds.map(([need, count]) => `${need} (${count})`).join(', ')}</div>
              </div>
            )}
            {detail.filters.since && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.sitrep_detail.included_since', { defaultValue: 'Included Since' })}</div>
                <div className="mt-1">{new Date(detail.filters.since).toLocaleString()}</div>
              </div>
            )}
            {detail.filters.scope?.resolved_name && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.sitrep_detail.resolved_scope', { defaultValue: 'Resolved Scope' })}</div>
                <div className="mt-1">{detail.filters.scope.resolved_name}</div>
                <div className="text-xs text-gray-500">
                  {[
                    detail.filters.scope.scope_level,
                    detail.filters.scope.locality,
                    detail.filters.scope.admin1,
                    detail.filters.scope.country_name,
                  ].filter(Boolean).join(' | ')}
                </div>
              </div>
            )}
            {detail.filters.crisis_event && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.sitrep_detail.crisis_event', { defaultValue: 'Crisis Event' })}</div>
                <div className="mt-1">{detail.filters.crisis_event}</div>
              </div>
            )}
            {detail.filters.bbox && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.sitrep_detail.bounding_box', { defaultValue: 'Bounding Box' })}</div>
                <div className="mt-1 break-all">{detail.filters.bbox}</div>
              </div>
            )}
            {(typeof detail.filters.outside_scope_excluded === 'number' || typeof detail.filters.duplicate_reports_excluded === 'number') && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.sitrep_detail.selection_controls', { defaultValue: 'Selection Controls' })}</div>
                <div className="mt-1 text-sm">
                  {typeof detail.filters.candidate_report_count === 'number' && <div>Candidate reports: {detail.filters.candidate_report_count}</div>}
                  {typeof detail.filters.outside_scope_excluded === 'number' && <div>Outside scope excluded: {detail.filters.outside_scope_excluded}</div>}
                  {typeof detail.filters.duplicate_reports_excluded === 'number' && <div>Duplicates excluded: {detail.filters.duplicate_reports_excluded}</div>}
                  {(detail.filters.duplicate_radius_m || detail.filters.duplicate_time_hours) && (
                    <div>
                      Duplicate rule: {detail.filters.duplicate_radius_m || 0}m / {detail.filters.duplicate_time_hours || 0}h
                    </div>
                  )}
                </div>
              </div>
            )}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.sitrep_detail.photo_preview', { defaultValue: 'Photo Preview' })}</div>
              {galleryItems.length === 0 ? (
                <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                  {t('admin.sitrep_detail.no_photo_preview', { defaultValue: 'No source-report photos were available for this situation report.' })}
                </div>
              ) : (
                <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {galleryItems.map((item, index) => (
                    <button
                      key={`${item.reportId}-${item.index}`}
                      type="button"
                      onClick={() => setLightboxIndex(index)}
                      className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-left"
                    >
                      <img src={item.photo} alt={`${item.reportId} preview ${item.index + 1}`} className="h-40 w-full object-cover" />
                      <div className="space-y-1 px-3 py-2 text-xs text-gray-600">
                        <div className="font-semibold text-gray-900">{item.reportId}</div>
                        <div>{item.caption}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {detail.stats.crisisTypes?.length || detail.stats.infraCategories?.length || topNeeds.length || detail.filters.since || detail.filters.crisis_event || detail.filters.bbox || galleryItems.length ? null : (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                {t('admin.sitrep_detail.metadata_only', { defaultValue: 'This sitrep has only basic saved metadata. Regenerate it if you need a richer summary snapshot.' })}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <MapPinned size={18} className="text-un-blue" />
          <h2 className="text-lg font-bold text-gray-900">{t('admin.sitrep_detail.source_reports_map', { defaultValue: 'Source Reports Map' })}</h2>
        </div>
        {mappableReports.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">{t('admin.sitrep_detail.no_source_reports_map', { defaultValue: 'No source reports with current location data are available for this sitrep.' })}</div>
        ) : (
          <div data-testid="sitrep-detail-map" className="overflow-hidden rounded-xl border border-gray-200">
            <MapContainer center={[mappableReports[0].lat as number, mappableReports[0].lng as number]} zoom={11} style={{ height: 360, width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <SourceReportsBounds reports={mappableReports} />
              {mappableReports.map((report) => (
                <Marker key={report.id} position={[report.lat as number, report.lng as number]}>
                  <Popup>
                    <div className="space-y-1 text-xs">
                      <div className="font-semibold text-gray-900">{report.id}</div>
                      <div>{getLocationLine(report)}</div>
                      <div>{report.infra_name || report.infra_category}</div>
                      <div>{t('admin.export.status', { defaultValue: 'Status' })}: {report.status}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">{t('admin.sitrep_detail.source_reports', { defaultValue: 'Source Reports' })}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">{t('admin.sitrep_detail.report', { defaultValue: 'Report' })}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">{t('report.location', { defaultValue: 'Location' })}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">{t('admin.reports.damage', { defaultValue: 'Damage' })}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">{t('admin.export.status', { defaultValue: 'Status' })}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">{t('admin.reports.infrastructure', { defaultValue: 'Infrastructure' })}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">{t('admin.reports.submitted', { defaultValue: 'Submitted' })}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">{t('report.photos', { defaultValue: 'Photos' })}</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-500">{t('admin.reports.action', { defaultValue: 'Action' })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.source_reports.map((report) => {
                if (isUnavailableSourceReport(report)) {
                  return (
                    <tr key={report.id}>
                      <td className="px-3 py-3 font-mono text-xs text-gray-700">{report.id}</td>
                      <td colSpan={6} className="px-3 py-3 text-sm text-gray-500">{t('admin.sitrep_detail.source_report_unavailable', { defaultValue: 'This source report is no longer available.' })}</td>
                      <td className="px-3 py-3" />
                    </tr>
                  );
                }
                return (
                  <tr key={report.id}>
                    <td className="px-3 py-3 font-mono text-xs text-gray-700">{report.id}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{getLocationLine(report)}</td>
                    <td className="px-3 py-3"><DamageBadge level={report.damage_level} /></td>
                    <td className="px-3 py-3"><StatusBadge status={report.status} /></td>
                    <td className="px-3 py-3 text-sm text-gray-600">
                      <div>{report.infra_category || '-'}</div>
                      {report.infra_name && <div className="text-xs text-gray-400">{report.infra_name}</div>}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600">{new Date(report.submitted_at).toLocaleString()}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{report.photo_count || report.photos.length || 0}</td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/reports?reportId=${encodeURIComponent(report.id)}`)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <ExternalLink size={12} />
                        {t('admin.dashboard.review', { defaultValue: 'Review' })}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {lightboxIndex !== null && (
        <GalleryLightbox
          items={galleryItems}
          activeIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onSelect={setLightboxIndex}
        />
      )}
    </div>
  );
}
