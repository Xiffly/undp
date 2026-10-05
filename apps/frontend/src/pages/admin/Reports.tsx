import { ReportModal, AiStatusBadge, TranslationStatusBadge } from '../../components/reports/ReportModal';
import { scheduleTask, CRISIS_TYPE_KEYS, CRISIS_TYPE_LABELS, ELEC_LABELS, HEALTH_LABELS } from '../../components/reports/presentation';
import { compareSitrepLogsDescending, getApiErrorMessage, canTriggerClassification, getClassificationBlockedMessage, SitrepLog } from '../../components/reports/reportHelpers';
import { useCallback, useEffect, useState } from 'react';

import L from 'leaflet';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, FileText, Languages, Loader2, RefreshCw, Search, Settings2, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { Report } from '../../types';
import DamageBadge from '../../components/DamageBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import StatusBadge from '../../components/StatusBadge';
import { getLanguageMeta, SUPPORTED_LANGUAGES } from '../../config/languages';
import { formatRelativeTime } from '../../utils/relativeTime';
import { formatChoiceFallback } from '../../utils/reportPresentation';

type LeafletIconDefaults = typeof L.Icon.Default.prototype & {
  _getIconUrl?: () => string;
};

delete (L.Icon.Default.prototype as LeafletIconDefaults)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface AiStatus {
  features?: {
    sitrep?: boolean;
  };
}

interface SitrepResult {
  id?: string;
  success: boolean;
  sitrep: string;
  stats: { total?: number; destroyed?: number; partial?: number; minimal?: number; urgent?: number };
  model: string;
  report_count: number;
  focus_area?: string | null;
  filters?: {
    scope?: {
      scope_level?: string | null;
      resolved_name?: string | null;
    } | null;
    outside_scope_excluded?: number | null;
    duplicate_reports_excluded?: number | null;
  } | null;
}

type ToastMessage = {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
};

function ReportDedupSettingsModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [featureDuplicateDetect, setFeatureDuplicateDetect] = useState(true);
  const [duplicateRadiusM, setDuplicateRadiusM] = useState(100);
  const [duplicateTimeHours, setDuplicateTimeHours] = useState(24);
  const [abuseMaxReportsPerHour, setAbuseMaxReportsPerHour] = useState(8);
  const [abuseMaxReportsPerDay, setAbuseMaxReportsPerDay] = useState(25);
  const [abuseRepeatWindowMinutes, setAbuseRepeatWindowMinutes] = useState(30);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError('');
        const response = await api.getReportSettings();
        const settings = response.settings || {};
        setFeatureDuplicateDetect(settings.feature_duplicate_detect !== 'false');
        setDuplicateRadiusM(Number.parseInt(settings.duplicate_radius_m || '100', 10));
        setDuplicateTimeHours(Number.parseInt(settings.duplicate_time_hours || '24', 10));
        setAbuseMaxReportsPerHour(Number.parseInt(settings.abuse_max_reports_per_hour || '8', 10));
        setAbuseMaxReportsPerDay(Number.parseInt(settings.abuse_max_reports_per_day || '25', 10));
        setAbuseRepeatWindowMinutes(Number.parseInt(settings.abuse_repeat_window_minutes || '30', 10));
      } catch (err: unknown) {
        setError(getApiErrorMessage(err, t('admin.reports.report_settings_load_failed', { defaultValue: 'Failed to load report moderation settings.' })));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  const save = async () => {
    try {
      setSaving(true);
      setError('');
      await api.saveReportSettings({
        feature_duplicate_detect: String(featureDuplicateDetect),
        duplicate_radius_m: String(duplicateRadiusM),
        duplicate_time_hours: String(duplicateTimeHours),
        abuse_max_reports_per_hour: String(abuseMaxReportsPerHour),
        abuse_max_reports_per_day: String(abuseMaxReportsPerDay),
        abuse_repeat_window_minutes: String(abuseRepeatWindowMinutes),
      });
      onClose();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.reports.report_settings_save_failed', { defaultValue: 'Failed to save report moderation settings.' })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl bg-white" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('admin.reports.settings_title', { defaultValue: 'Report Settings' })}</h2>
            <p className="text-sm text-gray-500">{t('admin.reports.settings_subtitle', { defaultValue: 'Single source of truth for duplicate detection and over-reporting controls.' })}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {loading ? (
            <LoadingSpinner text={t('admin.settings.loading', { defaultValue: 'Loading settings...' })} />
          ) : (
            <>
              <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <input type="checkbox" checked={featureDuplicateDetect} onChange={(event) => setFeatureDuplicateDetect(event.target.checked)} />
                <span>
                  <span className="block font-semibold text-gray-800">{t('admin.reports.automatic_duplicate_detection', { defaultValue: 'Automatic duplicate detection' })}</span>
                  <span className="block text-xs text-gray-500">{t('admin.reports.automatic_duplicate_detection_help', { defaultValue: 'Used by both report intake and the admin duplicate scan.' })}</span>
                </span>
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.duplicate_radius_m', { defaultValue: 'Duplicate radius (meters)' })}</span>
                  <input type="number" min={1} value={duplicateRadiusM} onChange={(event) => setDuplicateRadiusM(Number(event.target.value) || 1)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.duplicate_time_hours', { defaultValue: 'Duplicate time window (hours)' })}</span>
                  <input type="number" min={1} value={duplicateTimeHours} onChange={(event) => setDuplicateTimeHours(Number(event.target.value) || 1)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.max_reports_per_hour', { defaultValue: 'Max reports per hour' })}</span>
                  <input type="number" min={1} value={abuseMaxReportsPerHour} onChange={(event) => setAbuseMaxReportsPerHour(Number(event.target.value) || 1)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.max_reports_per_day', { defaultValue: 'Max reports per day' })}</span>
                  <input type="number" min={1} value={abuseMaxReportsPerDay} onChange={(event) => setAbuseMaxReportsPerDay(Number(event.target.value) || 1)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.repeat_window_minutes', { defaultValue: 'Repeat window (minutes)' })}</span>
                  <input type="number" min={1} value={abuseRepeatWindowMinutes} onChange={(event) => setAbuseRepeatWindowMinutes(Number(event.target.value) || 1)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
                </label>
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
                {t('admin.reports.settings_hint', { defaultValue: 'These settings control automatic duplicate marking, location clustering for incoming reports, and repeated submission heuristics.' })}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            {t('admin.common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button type="button" onClick={save} disabled={loading || saving} className="rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60">
            {saving ? t('admin.common.saving', { defaultValue: 'Saving...' }) : t('admin.reports.save_settings', { defaultValue: 'Save Settings' })}
          </button>
        </div>
      </div>
    </div>
  );
}

function SitrepSettingsModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [featureSitrep, setFeatureSitrep] = useState(true);
  const [sitrepMinReports, setSitrepMinReports] = useState(3);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError('');
        const response = await api.getAiSettings();
        const settings = response.settings || {};
        setFeatureSitrep(settings.feature_sitrep !== 'false');
        setSitrepMinReports(Number.parseInt(settings.sitrep_min_reports || '3', 10));
      } catch (err: unknown) {
        setError(getApiErrorMessage(err, t('admin.reports.sitrep_settings_load_failed', { defaultValue: 'Failed to load situation report settings.' })));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  const save = async () => {
    try {
      setSaving(true);
      setError('');
      await api.saveAiSettings({
        feature_sitrep: String(featureSitrep),
        sitrep_min_reports: String(sitrepMinReports),
      });
      onClose();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.reports.sitrep_settings_save_failed', { defaultValue: 'Failed to save situation report settings.' })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl bg-white" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('admin.reports.sitrep_settings_title', { defaultValue: 'Situation Report Settings' })}</h2>
            <p className="text-sm text-gray-500">{t('admin.reports.sitrep_settings_subtitle', { defaultValue: 'Configure when situation reports are available and how many reports they require.' })}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {loading ? (
            <LoadingSpinner text={t('admin.settings.loading', { defaultValue: 'Loading settings...' })} />
          ) : (
            <>
              <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <input type="checkbox" checked={featureSitrep} onChange={(event) => setFeatureSitrep(event.target.checked)} />
                <span>
                  <span className="block font-semibold text-gray-800">{t('admin.reports.enable_sitrep', { defaultValue: 'Enable situation reports' })}</span>
                  <span className="block text-xs text-gray-500">{t('admin.reports.enable_sitrep_help', { defaultValue: 'Controls whether the sitrep generator can run from the Reports page.' })}</span>
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.reports.minimum_reports', { defaultValue: 'Minimum reports' })}</span>
                <input type="number" min={1} max={10} value={sitrepMinReports} onChange={(event) => setSitrepMinReports(Number(event.target.value) || 1)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
              </label>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            {t('admin.common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button type="button" onClick={save} disabled={loading || saving} className="rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60">
            {saving ? t('admin.common.saving', { defaultValue: 'Saving...' }) : t('admin.reports.save_settings', { defaultValue: 'Save Settings' })}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Reports() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSitrepSettings, setShowSitrepSettings] = useState(false);
  const [filters, setFilters] = useState({
    status: 'all',
    damage_level: 'all',
    crisis_type: 'all',
    search: '',
    page: 0,
  });
  const uiLanguage = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const [translationTargetOverride, setTranslationTargetOverride] = useState<string | null>(null);
  const translationTarget = translationTargetOverride || uiLanguage;
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [sitrepFocusArea, setSitrepFocusArea] = useState('');
  const [sitrepSince, setSitrepSince] = useState('');
  const [sitrepGenerating, setSitrepGenerating] = useState(false);
  const [sitrepError, setSitrepError] = useState('');
  const [sitrepHistory, setSitrepHistory] = useState<SitrepLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [classifyingReportIds, setClassifyingReportIds] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pageSize = 20;
  const CLASSIFICATION_POLL_MS = 1500;
  const CLASSIFICATION_POLL_TIMEOUT_MS = 90000;

  const pushToast = useCallback((tone: ToastMessage['tone'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    const statusId = scheduleTask(() => {
      loadSitrepStatus();
    });
    const historyId = scheduleTask(() => {
      loadSitrepHistory();
    });
    return () => {
      window.clearTimeout(statusId);
      window.clearTimeout(historyId);
    };
  }, []);

  useEffect(() => {
    if (location.pathname === '/admin/reports') {
      loadSitrepHistory();
    }
  }, [location.pathname]);

  useEffect(() => {
    const refreshHistory = () => {
      if (document.visibilityState === 'visible' && location.pathname === '/admin/reports') {
        loadSitrepHistory();
      }
    };
    window.addEventListener('focus', refreshHistory);
    document.addEventListener('visibilitychange', refreshHistory);
    return () => {
      window.removeEventListener('focus', refreshHistory);
      document.removeEventListener('visibilitychange', refreshHistory);
    };
  }, [location.pathname]);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {
        limit: String(pageSize),
        offset: String(filters.page * pageSize),
        target_lang: translationTarget,
      };
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.damage_level !== 'all') params.damage_level = filters.damage_level;
      if (filters.crisis_type !== 'all') params.crisis_type = filters.crisis_type;
      const data = await api.getAdminReports(params);
      setReports(data.reports);
      setTotal(data.total);
    } catch (err: unknown) {
      setReports([]);
      setTotal(0);
      setError(getApiErrorMessage(err, t('admin.reports.load_error', { defaultValue: 'Failed to load reports.' })));
    } finally {
      setLoading(false);
    }
  }, [filters, t, translationTarget]);

  useEffect(() => {
    const fetchId = scheduleTask(() => {
      fetchReports().catch(() => {});
    });
    return () => window.clearTimeout(fetchId);
  }, [fetchReports]);

  function setClassificationBusy(reportId: string, busy: boolean) {
    setClassifyingReportIds((current) => {
      if (busy) return { ...current, [reportId]: true };
      const next = { ...current };
      delete next[reportId];
      return next;
    });
  }

  function isClassificationBusy(reportId: string) {
    return Boolean(classifyingReportIds[reportId]);
  }

  async function waitForClassificationCompletion(reportId: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < CLASSIFICATION_POLL_TIMEOUT_MS) {
      const status = await api.getClassificationStatus(reportId);
      if (status.status === 'completed') return;
      if (status.status === 'failed_terminal') {
        throw new Error(
          status.job?.last_error_message
          || t('admin.reports.ai_classify_failed', { defaultValue: 'AI classification failed.' })
        );
      }
      await new Promise((resolve) => window.setTimeout(resolve, CLASSIFICATION_POLL_MS));
    }
    throw new Error(t('admin.reports.ai_classify_still_running', { defaultValue: 'AI classification is still running. Refresh the page or click again if it later fails.' }));
  }

  async function loadSitrepStatus() {
    try {
      const status = await api.getAiStatus() as AiStatus;
      setAiStatus(status);
    } catch {
      return;
    }
  }

  async function loadSitrepHistory() {
    try {
      setHistoryLoading(true);
      setHistoryError('');
      const response = await api.getSitrepHistory() as { logs: SitrepLog[] };
      const sorted = [...(response.logs || [])].sort(compareSitrepLogsDescending);
      setSitrepHistory(sorted);
    } catch (err: unknown) {
      setHistoryError(getApiErrorMessage(err, 'Failed to load situation report history.'));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function generateSitrep() {
    try {
      setSitrepGenerating(true);
      setSitrepError('');
      const params: Record<string, string> = {};
      if (sitrepFocusArea.trim()) params.focus_area = sitrepFocusArea.trim();
      if (sitrepSince.trim()) params.since = sitrepSince.trim();
      const response = await api.generateSitrep(params) as SitrepResult;
      await loadSitrepHistory();
      if (response.id) {
        navigate(`/admin/reports/sitreps/${response.id}`);
        return;
      }
      setSitrepError('Situation report was generated but could not be opened from history.');
    } catch (err: unknown) {
      setSitrepError(getApiErrorMessage(err, 'Failed to generate situation report.'));
    } finally {
      setSitrepGenerating(false);
    }
  }

  async function triggerClassification(reportId: string) {
    if (isClassificationBusy(reportId)) return;
    try {
      setClassificationBusy(reportId, true);
      setError('');
      const response = await api.classifyDamage(reportId) as { status?: string };
      if (response.status !== 'completed') {
        pushToast('info', t('admin.reports.ai_classify_running', { defaultValue: 'AI classification is processing for this report.' }));
        await waitForClassificationCompletion(reportId);
        pushToast('success', t('admin.reports.ai_classify_completed', { defaultValue: 'AI classification completed.' }));
      } else {
        pushToast('success', t('admin.reports.ai_classify_completed', { defaultValue: 'AI classification completed.' }));
      }
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('admin.reports.ai_classify_failed', { defaultValue: 'AI classification failed.' }));
      setError(message);
      pushToast('error', message);
    } finally {
      setClassificationBusy(reportId, false);
      await fetchReports();
    }
  }

  function openSitrepDetail(id?: string | null) {
    if (!id) return;
    navigate(`/admin/reports/sitreps/${id}`);
  }

  function openReportModal(report: Report) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('reportId', report.id);
    setSearchParams(nextParams, { replace: true });
  }

  function closeReportModal() {
    if (!searchParams.get('reportId')) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('reportId');
    setSearchParams(nextParams, { replace: true });
  }

  const filtered = filters.search
    ? reports.filter((report) =>
        report.id.toLowerCase().includes(filters.search.toLowerCase()) ||
        (report.building_label || '').toLowerCase().includes(filters.search.toLowerCase()) ||
        (report.address_text || '').toLowerCase().includes(filters.search.toLowerCase()) ||
        (report.translations?.[translationTarget]?.address_text || '').toLowerCase().includes(filters.search.toLowerCase()) ||
        (report.description || '').toLowerCase().includes(filters.search.toLowerCase()) ||
        (report.translations?.[translationTarget]?.description || '').toLowerCase().includes(filters.search.toLowerCase()) ||
        (report.translations?.[translationTarget]?.infra_name || '').toLowerCase().includes(filters.search.toLowerCase()) ||
        (report.infra_name || '').toLowerCase().includes(filters.search.toLowerCase())
      )
    : reports;
  const selectedReportId = searchParams.get('reportId') || null;

  const totalPages = Math.ceil(total / pageSize);
  const sitrepEnabled = aiStatus?.features?.sitrep !== false;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.reports.title', { defaultValue: 'Reports' })}</h1>
          <p className="text-sm text-gray-500">{t('admin.reports.total_records', { defaultValue: '{{count}} total records', count: total })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowSettings(true)} className="flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Settings2 size={16} />
            {t('admin.reports.settings_button', { defaultValue: 'Settings' })}
          </button>
          <button type="button" onClick={fetchReports} className="rounded-xl p-2 hover:bg-gray-100">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="pointer-events-none fixed right-4 top-20 z-[460] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg ${
              toast.tone === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : toast.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">{toast.message}</div>
              <button
                type="button"
                onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
                className="rounded p-0.5 opacity-70 hover:opacity-100"
                aria-label={t('common.close', { defaultValue: 'Close' })}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button type="button" onClick={() => setShowSitrepSettings(true)} className="flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Settings2 size={16} />
              {t('admin.reports.settings_button', { defaultValue: 'Settings' })}
            </button>
            <div>
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-un-blue" />
                <h2 className="text-lg font-bold text-gray-900">{t('admin.reports.sitrep_title', { defaultValue: 'Situation Reports' })}</h2>
              </div>
              <p className="mt-1 text-sm text-gray-500">{t('admin.reports.sitrep_subtitle', { defaultValue: 'Generate and review field briefing summaries from current report data.' })}</p>
            </div>
          </div>
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${sitrepEnabled ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-gray-200 bg-gray-100 text-gray-500'}`}>
            {sitrepEnabled
              ? t('admin.reports.status_active', { defaultValue: 'Active' })
              : t('admin.reports.status_disabled', { defaultValue: 'Disabled' })}
          </span>
        </div>

        {!sitrepEnabled && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            {t('admin.reports.sitrep_disabled', { defaultValue: 'Situation reports are disabled in section settings.' })}
          </div>
        )}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-900">{t('admin.reports.generate_sitrep_title', { defaultValue: 'Generate Situation Report' })}</h3>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">{t('admin.reports.focus_area_optional', { defaultValue: 'Focus Area (optional)' })}</label>
              <input type="text" value={sitrepFocusArea} onChange={(event) => setSitrepFocusArea(event.target.value)} placeholder={t('admin.reports.focus_area_placeholder', { defaultValue: "e.g. Northern Sana'a, District 7" })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">{t('admin.reports.include_since_optional', { defaultValue: 'Include reports since (optional)' })}</label>
              <input type="datetime-local" value={sitrepSince} onChange={(event) => setSitrepSince(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" />
            </div>
            <button onClick={generateSitrep} disabled={sitrepGenerating || !sitrepEnabled} className="flex w-full items-center justify-center gap-2 rounded-xl bg-un-blue py-3 font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-60">
              {sitrepGenerating
                ? <><Loader2 className="h-5 w-5 animate-spin" />{t('admin.reports.generating', { defaultValue: 'Generating...' })}</>
                : t('admin.reports.generate_sitrep', { defaultValue: 'Generate Sitrep' })}
            </button>
            {sitrepError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{sitrepError}</div>}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('admin.reports.previous_sitreps', { defaultValue: 'Previous Sitreps' })}</h3>
            {historyLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
            ) : historyError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{historyError}</div>
            ) : sitrepHistory.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">{t('admin.reports.no_previous_sitreps', { defaultValue: 'No previous sitreps found.' })}</p>
            ) : (
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {sitrepHistory.map((log) => (
                  <button
                    key={log.id}
                    type="button"
                    onClick={() => openSitrepDetail(log.id)}
                    className="block w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-left text-xs text-gray-600 transition-colors hover:border-un-blue/40 hover:bg-un-blue/5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{new Date(log.generated_at).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 text-gray-700">
                      {t('admin.reports.sitrep_history_summary', {
                        defaultValue: '{{area}} - {{count}} reports',
                        area: log.focus_area || t('admin.reports.all_areas', { defaultValue: 'All areas' }),
                        count: log.report_count,
                      })}
                    </div>
                    <div className="mt-2 italic text-gray-500">{log.preview}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-2 rounded-xl bg-white p-3 shadow-sm md:grid-cols-2 xl:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] xl:items-center">
        <div className="flex w-full items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm xl:w-auto">
          <Languages size={14} className="text-gray-400" />
          <select
            value={translationTarget}
            onChange={(event) => setTranslationTargetOverride(event.target.value === uiLanguage ? null : event.target.value)}
            className="min-w-0 bg-transparent text-sm focus:outline-none"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeLabel}
              </option>
            ))}
          </select>
        </div>
        <div className="relative min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t('admin.reports.search_placeholder', { defaultValue: 'Search ID, location, name...' })}
            value={filters.search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value, page: 0 }))}
            className="w-full rounded-xl border border-gray-300 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
          />
        </div>
        <select
          value={filters.status}
          onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value, page: 0 }))}
          className="w-full min-w-0 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none xl:min-w-[140px]"
        >
          <option value="all">{t('admin.reports.all_status', { defaultValue: 'All Status' })}</option>
          <option value="pending">{t('map.filter_pending', { defaultValue: 'Pending' })}</option>
          <option value="verified">{t('map.filter_verified', { defaultValue: 'Verified' })}</option>
          <option value="flagged">{t('map.filter_flagged', { defaultValue: 'Flagged' })}</option>
          <option value="duplicate">{t('common.duplicate', { defaultValue: 'Duplicate' })}</option>
          <option value="rejected">{t('common.rejected', { defaultValue: 'Rejected' })}</option>
        </select>
        <select
          value={filters.damage_level}
          onChange={(event) => setFilters((current) => ({ ...current, damage_level: event.target.value, page: 0 }))}
          className="w-full min-w-0 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none xl:min-w-[160px]"
        >
          <option value="all">{t('admin.reports.all_damage', { defaultValue: 'All Damage' })}</option>
          <option value="destroyed">{t('map.filter_destroyed', { defaultValue: 'Destroyed' })}</option>
          <option value="partial">{t('map.filter_partial', { defaultValue: 'Partial' })}</option>
          <option value="minimal">{t('map.filter_minimal', { defaultValue: 'Minimal' })}</option>
        </select>
        <select
          value={filters.crisis_type}
          onChange={(event) => setFilters((current) => ({ ...current, crisis_type: event.target.value, page: 0 }))}
          className="w-full min-w-0 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none xl:min-w-[190px]"
        >
          <option value="all">{t('admin.reports.all_crisis_types', { defaultValue: 'All Crisis Types' })}</option>
          <option value="earthquake">{t('crisis_types.earthquake', { defaultValue: 'Earthquake' })}</option>
          <option value="flood">{t('crisis_types.flood', { defaultValue: 'Flood' })}</option>
          <option value="conflict">{t('crisis_types.conflict', { defaultValue: 'Conflict' })}</option>
          <option value="hurricane">{t('crisis_types.hurricane', { defaultValue: 'Hurricane' })}</option>
          <option value="wildfire">{t('crisis_types.wildfire', { defaultValue: 'Wildfire' })}</option>
          <option value="explosion">{t('crisis_types.explosion', { defaultValue: 'Explosion' })}</option>
          <option value="tsunami">{t('crisis_types.tsunami', { defaultValue: 'Tsunami' })}</option>
          <option value="civil_unrest">{t('crisis_types.civil_unrest', { defaultValue: 'Civil Unrest' })}</option>
          <option value="chemical">{t('crisis_types.chemical', { defaultValue: 'Chemical' })}</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        {loading ? (
          <LoadingSpinner text={t('admin.reports.loading', { defaultValue: 'Loading reports...' })} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 whitespace-nowrap">{t('admin.reports.column_id', { defaultValue: 'ID' })}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 whitespace-nowrap">{t('admin.reports.crisis', { defaultValue: 'Crisis' })}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 whitespace-nowrap">{t('admin.reports.infrastructure', { defaultValue: 'Infrastructure' })}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 whitespace-nowrap">{t('admin.reports.damage', { defaultValue: 'Damage' })}</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 whitespace-nowrap md:table-cell">{t('report.electricity', { defaultValue: 'Electricity' })}</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 whitespace-nowrap lg:table-cell">{t('report.health', { defaultValue: 'Health' })}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 whitespace-nowrap">{t('map.status_label', { defaultValue: 'Status' })}</th>
                  <th className="hidden w-[180px] px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 whitespace-nowrap xl:table-cell">{t('admin.reports.ai_status', { defaultValue: 'AI status' })}</th>
                  <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500 whitespace-nowrap md:table-cell">{t('admin.reports.when', { defaultValue: 'When' })}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500 whitespace-nowrap">{t('admin.reports.action', { defaultValue: 'Action' })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((report) => (
                  <tr key={report.id} className={`hover:bg-gray-50 ${report.is_urgent ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-gray-700">{report.id}</p>
                      {report.is_urgent && <span className="text-xs font-bold text-red-600">{t('common.urgent', { defaultValue: 'URGENT' })}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-700">
                        {report.crisis_type ? t(CRISIS_TYPE_KEYS[report.crisis_type] || '', { defaultValue: CRISIS_TYPE_LABELS[report.crisis_type] || report.crisis_type }) : '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-gray-700">
                        {report.infra_category ? t(`infra.${report.infra_category}`, { defaultValue: report.infra_category }) : '-'}
                      </p>
                      {report.infra_name && <p className="max-w-[120px] truncate text-xs text-gray-400">{report.infra_name}</p>}
                      {report.translations?.[translationTarget]?.infra_name && report.translations[translationTarget].infra_name !== report.infra_name && (
                        <p className="max-w-[120px] truncate text-[11px] text-un-blue">
                          {getLanguageMeta(translationTarget).code.toUpperCase()}: {report.translations[translationTarget].infra_name}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {report.source_language && (
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600">
                            {report.source_language}
                          </span>
                        )}
                        <TranslationStatusBadge report={report} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <DamageBadge level={report.damage_level} />
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <span className="text-xs text-gray-600">
                        {report.electricity_condition ? t(`electricity.${report.electricity_condition}`, { defaultValue: ELEC_LABELS[report.electricity_condition] || formatChoiceFallback(report.electricity_condition) }) : '-'}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className="text-xs text-gray-600">
                        {report.health_services ? t(`health.${report.health_services}`, { defaultValue: HEALTH_LABELS[report.health_services] || formatChoiceFallback(report.health_services) }) : '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={report.status} />
                    </td>
                    <td className="hidden w-[180px] px-4 py-3 xl:table-cell">
                      <AiStatusBadge report={report} />
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-gray-400 md:table-cell">{formatRelativeTime(t, report.submitted_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {report.ai_classification_status && (
                        <div className="mb-1 flex justify-end xl:hidden">
                          <AiStatusBadge report={report} />
                        </div>
                      )}
                      {!canTriggerClassification(report) && Number(report.photo_count || 0) > 0 && report.ai_media_eligibility && report.ai_media_eligibility !== 'eligible' && (
                        <p className="mb-1 text-right text-[11px] font-medium text-amber-700">
                          {getClassificationBlockedMessage(report, t)}
                        </p>
                      )}
                      <div className="flex items-center justify-end gap-1">
                        {canTriggerClassification(report) && (
                          <button
                            type="button"
                            aria-label={t('admin.reports.classify_report_aria', { defaultValue: 'Run AI classification for report {{id}}', id: report.id })}
                            title={t('admin.reports.classify_report', { defaultValue: 'Run AI classification' })}
                            onClick={() => triggerClassification(report.id)}
                            disabled={isClassificationBusy(report.id)}
                            className="rounded-lg p-1.5 text-un-blue hover:bg-un-blue/10 disabled:opacity-50"
                          >
                            {isClassificationBusy(report.id) ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={t('admin.reports.view_report_aria', { defaultValue: 'View report {{id}}', id: report.id })}
                          onClick={() => openReportModal(report)}
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
                        >
                          <Eye size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400">
                      <AlertTriangle size={24} className="mx-auto mb-2 opacity-40" />
                      {t('admin.reports.no_match', { defaultValue: 'No reports match the current filters.' })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">
              {t('admin.common.pagination', { defaultValue: 'Page {{page}} of {{total}}', page: filters.page + 1, total: totalPages })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
                disabled={filters.page === 0}
                className="rounded-lg p-1.5 hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
                disabled={filters.page >= totalPages - 1}
                className="rounded-lg p-1.5 hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedReportId && <ReportModal key={selectedReportId} reportId={selectedReportId} translationTarget={translationTarget} onClose={closeReportModal} onAction={fetchReports} />}
      {showSettings && <ReportDedupSettingsModal onClose={() => setShowSettings(false)} />}
      {showSitrepSettings && <SitrepSettingsModal onClose={() => { setShowSitrepSettings(false); loadSitrepStatus(); }} />}
    </div>
  );
}
