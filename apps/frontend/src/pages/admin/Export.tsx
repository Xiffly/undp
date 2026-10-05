import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Download, FileText, Map, Table, Loader2, Printer, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { SUPPORTED_LANGUAGES } from '../../config/languages';

export default function Export() {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState({ status: 'verified', damage_level: 'all', since: '' });
  const [format, setFormat] = useState<'geojson' | 'json' | 'csv' | 'kml' | 'pdf'>('geojson');
  const [count, setCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const currentLanguage = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const [translationTargetOverride, setTranslationTargetOverride] = useState<string | null>(null);
  const translationTarget = translationTargetOverride || currentLanguage;

  const getApiErrorMessage = (error: unknown, fallback: string) => (
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error
      || (error instanceof Error ? error.message : fallback)
  );

  const fetchCount = useCallback(async () => {
    setLoadingCount(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.damage_level !== 'all') params.damage_level = filters.damage_level;
      if (filters.since) params.since = filters.since;
      const { count: nextCount } = await api.getExportCount(params);
      setCount(nextCount);
    } catch (err: unknown) {
      setCount(null);
      if (axios.isAxiosError(err) && !err.response) {
        setError(t('admin.export.api_unavailable', { defaultValue: 'Export API is unavailable. Check that the backend is running.' }));
      } else {
        setError(getApiErrorMessage(err, t('admin.export.count_failed', { defaultValue: 'Failed to load export count.' })));
      }
    } finally {
      setLoadingCount(false);
    }
  }, [filters, t]);

  useEffect(() => {
    const fetchId = window.setTimeout(() => {
      fetchCount().catch(() => {});
    }, 0);
    return () => window.clearTimeout(fetchId);
  }, [fetchCount]);

  const handleExport = async () => {
    setError('');

    if (count === 0) {
      setError(t('admin.export.no_match_error', { defaultValue: 'No matching reports to export for the selected filters.' }));
      return;
    }

    const params: Record<string, string> = { format, target_lang: translationTarget };
    if (filters.status !== 'all') params.status = filters.status;
    if (filters.damage_level !== 'all') params.damage_level = filters.damage_level;
    if (filters.since) params.since = filters.since;

    setExporting(true);
    try {
      if (format === 'pdf') {
        const query = new URLSearchParams(params).toString();
        window.open(`/api/pdf?${query}`, '_blank');
      } else {
        await api.exportData(params);
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && !err.response) {
        setError(t('admin.export.api_unavailable', { defaultValue: 'Export API is unavailable. Check that the backend is running.' }));
      } else {
        setError(getApiErrorMessage(err, t('admin.export.export_failed', { defaultValue: 'Export failed.' })));
      }
    } finally {
      setExporting(false);
    }
  };

  const formats = [
    { key: 'geojson', label: 'GeoJSON', icon: Map, desc: 'For QGIS, ArcGIS, Mapbox, web mapping' },
    { key: 'json', label: 'JSON', icon: FileText, desc: 'Raw interoperable API data format' },
    { key: 'csv', label: 'CSV', icon: Table, desc: 'For Excel, Google Sheets, Power BI' },
    { key: 'kml', label: 'KML', icon: Map, desc: 'For Google Earth, OCHA tools' },
    { key: 'pdf', label: 'PDF Report', icon: FileText, desc: 'Printable crisis assessment report with charts' },
  ] as const;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-5 text-2xl font-bold text-gray-900">{t('admin.export.title', { defaultValue: 'Export Data' })}</h1>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-gray-800">{t('admin.export.filter_records', { defaultValue: 'Filter Records' })}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">{t('admin.export.status', { defaultValue: 'Status' })}</label>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            >
              <option value="all">{t('admin.export.all_status', { defaultValue: 'All Status' })}</option>
              <option value="verified">{t('admin.export.verified_only', { defaultValue: 'Verified only' })}</option>
              <option value="pending">{t('common.pending', { defaultValue: 'Pending' })}</option>
              <option value="flagged">{t('common.flagged', { defaultValue: 'Flagged' })}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">{t('admin.export.damage_level', { defaultValue: 'Damage Level' })}</label>
            <select
              value={filters.damage_level}
              onChange={(event) => setFilters((current) => ({ ...current, damage_level: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            >
              <option value="all">{t('admin.export.all_damage', { defaultValue: 'All Damage' })}</option>
              <option value="destroyed">{t('map.filter_destroyed', { defaultValue: 'Destroyed' })}</option>
              <option value="partial">{t('map.filter_partial', { defaultValue: 'Partial' })}</option>
              <option value="minimal">{t('map.filter_minimal', { defaultValue: 'Minimal' })}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">{t('admin.export.since_date', { defaultValue: 'Since Date' })}</label>
            <input
              type="date"
              value={filters.since}
              onChange={(event) => setFilters((current) => ({ ...current, since: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm">
          <Languages size={14} className="text-gray-400" />
          <span className="text-gray-500">{t('admin.export.translation_target', { defaultValue: 'Translated content language' })}</span>
          <select
            value={translationTarget}
            onChange={(event) => setTranslationTargetOverride(event.target.value === currentLanguage ? null : event.target.value)}
            className="bg-transparent text-sm focus:outline-none"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeLabel}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-gray-800">{t('admin.export.format', { defaultValue: 'Export Format' })}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {formats.map(({ key, label, icon: Icon, desc }) => (
            <button
              key={key}
              onClick={() => setFormat(key)}
              className={`flex flex-col items-center rounded-xl border-2 p-3 text-center transition-all ${
                format === key
                  ? 'border-un-blue bg-un-blue/5 text-un-blue'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <Icon className="mb-1 h-6 w-6" />
              <span className="text-sm font-semibold">
                {key === 'pdf' ? t('admin.export.pdf_report', { defaultValue: label }) : label}
              </span>
              <span className="mt-1 text-xs leading-tight text-gray-500">
                {t(`admin.export.${key}_desc`, { defaultValue: desc })}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-white p-5 shadow-sm">
        <div className="text-sm text-gray-600">
          {loadingCount ? (
            <span className="flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> {t('admin.export.count_loading', { defaultValue: 'Counting...' })}</span>
          ) : count !== null ? (
            <span>
              {count === 1
                ? t('admin.export.count_match_one', { defaultValue: '1 report matches your filters' })
                : t('admin.export.count_match_other', { count, defaultValue: '{{count}} reports match your filters' })}
            </span>
          ) : null}
        </div>
        <button
          onClick={handleExport}
          disabled={count === 0 || loadingCount || exporting}
          className="flex items-center gap-2 rounded-xl bg-un-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-un-blue/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {exporting ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {t('admin.export.preparing', { defaultValue: 'Preparing export...' })}</>
          ) : format === 'pdf' ? (
            <><Printer className="h-4 w-4" /> {t('admin.export.open_pdf_report', { defaultValue: 'Open PDF Report' })}</>
          ) : (
            <><Download className="h-4 w-4" /> {t('admin.export.export_file', { format: format.toUpperCase(), defaultValue: 'Export {{format}}' })}</>
          )}
        </button>
      </div>

      {format === 'pdf' && (
        <p className="mt-3 text-center text-xs text-gray-500">
          {t('admin.export.pdf_hint', { defaultValue: "The report will open in a new tab. Use your browser's Print -> Save as PDF to download." })}
        </p>
      )}
    </div>
  );
}
