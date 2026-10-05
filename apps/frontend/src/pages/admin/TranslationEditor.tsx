import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  RefreshCw,
  Save,
  Wand2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import LoadingSpinner from '../../components/LoadingSpinner';
import { SUPPORTED_LANGUAGES } from '../../config/languages';
import i18n, { bumpI18nResourceVersion } from '../../i18n';

type TranslationStatus = {
  lang: string;
  exists: boolean;
  keyCount: number;
  translatedCount: number;
  staleCount: number;
  missingCount: number;
  attentionCount: number;
  hasStaleTranslations: boolean;
  hasMissingTranslations: boolean;
};

type ToastMessage = {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
};

type RowFeedback = {
  tone: 'success' | 'error' | 'info';
  message: string;
};

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce((acc: Record<string, string>, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      Object.assign(acc, flatten(v as Record<string, unknown>, key));
    } else {
      acc[key] = String(v ?? '');
    }
    return acc;
  }, {});
}

function unflatten(flat: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let cur: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i += 1) {
      cur[parts[i]] = (cur[parts[i]] as Record<string, unknown> | undefined) || {};
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
  return result;
}

function TranslationRow({
  rowKey,
  masterValue,
  value,
  isDirty,
  isStale,
  isMissing,
  canTranslate,
  isSaving,
  isTranslating,
  feedback,
  onChange,
  onSave,
  onTranslate,
}: {
  rowKey: string;
  masterValue: string;
  value: string;
  isDirty: boolean;
  isStale: boolean;
  isMissing: boolean;
  canTranslate: boolean;
  isSaving: boolean;
  isTranslating: boolean;
  feedback?: RowFeedback | null;
  onChange: (key: string, val: string) => void;
  onSave: (key: string) => void;
  onTranslate: (key: string) => void;
}) {
  const { t } = useTranslation();
  const rows = Math.max(1, Math.ceil(Math.max(value.length, masterValue.length, 20) / 55));

  return (
    <div className={`grid grid-cols-2 gap-3 border-b py-2 last:border-0 ${
      isMissing ? 'border-blue-100 bg-blue-50/30' : isStale ? 'border-amber-100 bg-amber-50/30' : 'border-gray-50'
    }`}>
      <div>
        <p className="mb-1 font-mono text-xs text-gray-400">{rowKey.split('.').slice(1).join('.')}</p>
        <p className="rounded-lg bg-gray-50 px-2 py-1.5 text-sm leading-snug text-gray-600">{masterValue || ''}</p>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <textarea
            value={value}
            onChange={(event) => onChange(rowKey, event.target.value)}
            rows={rows}
            className={`min-w-0 flex-1 resize-none rounded-lg border px-2 py-1.5 text-sm leading-snug focus:border-un-blue focus:outline-none focus:ring-1 focus:ring-un-blue/30 ${
              feedback?.tone === 'error' ? 'border-red-300 bg-red-50/40' : 'border-gray-200'
            }`}
          />
          <div className="flex shrink-0 items-start gap-1 pt-1">
            <button
              type="button"
              onClick={() => onSave(rowKey)}
              disabled={isSaving || isTranslating}
              title={isDirty
                ? t('admin.translation_editor.save_key_title_dirty', { defaultValue: 'Save this translation key' })
                : t('admin.translation_editor.save_key_title', { defaultValue: 'Save this key' })}
              className={`rounded-lg border p-2 transition-colors ${
                isDirty
                  ? 'border-un-blue/30 bg-un-light text-un-blue hover:bg-blue-100'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            </button>
            {canTranslate && (
              <button
                type="button"
                onClick={() => onTranslate(rowKey)}
                disabled={isSaving || isTranslating}
                title={t('admin.translation_editor.draft_key_title', { defaultValue: 'Draft translation with OpenRouter' })}
                className={`rounded-lg border bg-white p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  feedback?.tone === 'error'
                    ? 'border-red-200 text-red-600 hover:bg-red-50'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {isTranslating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              </button>
            )}
          </div>
        </div>
        {isMissing && <p className="mt-1 text-xs font-medium text-blue-700">{t('admin.translation_editor.needs_translation', { defaultValue: 'Needs translation.' })}</p>}
        {!isMissing && isStale && <p className="mt-1 text-xs font-medium text-amber-700">{t('admin.translation_editor.outdated_notice', { defaultValue: 'Outdated after the latest English change.' })}</p>}
        {feedback && (
          <p
            className={`mt-1 text-xs ${
              feedback.tone === 'error'
                ? 'text-red-600'
                : feedback.tone === 'success'
                  ? 'text-green-600'
                  : 'text-blue-600'
            }`}
          >
            {feedback.message}
          </p>
        )}
      </div>
    </div>
  );
}

function SectionGroup({
  sectionKey,
  sectionLabel,
  keys,
  enFlat,
  flat,
  savedFlat,
  selectedLang,
  staleKeys,
  missingKeys,
  savingKeys,
  translatingKeys,
  rowFeedback,
  onChange,
  onSaveKey,
  onTranslateKey,
}: {
  sectionKey: string;
  sectionLabel: string;
  keys: string[];
  enFlat: Record<string, string>;
  flat: Record<string, string>;
  savedFlat: Record<string, string>;
  selectedLang: string;
  staleKeys: Set<string>;
  missingKeys: Set<string>;
  savingKeys: Record<string, boolean>;
  translatingKeys: Record<string, boolean>;
  rowFeedback: Record<string, RowFeedback | undefined>;
  onChange: (key: string, val: string) => void;
  onSaveKey: (key: string) => void;
  onTranslateKey: (key: string) => void;
}) {
  const [open, setOpen] = useState(sectionKey === 'nav' || sectionKey === 'submit');
  const changed = keys.filter((key) => flat[key] && flat[key] !== enFlat[key]).length;
  const { t } = useTranslation();

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-gray-200">
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full bg-gray-50 px-4 py-3 text-left hover:bg-gray-100"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          <span className="text-sm font-semibold text-gray-700">{sectionLabel}</span>
          {sectionLabel !== sectionKey && <span className="font-mono text-xs text-gray-400">{sectionKey}</span>}
          <span className="text-xs text-gray-400">{t('admin.translation_editor.key_count', { defaultValue: '{{count}} keys', count: keys.length })}</span>
          {changed > 0 && <span className="rounded-full bg-green-100 px-1.5 text-xs text-green-700">{t('admin.translation_editor.section_translated_count', { defaultValue: '{{count}} translated', count: changed })}</span>}
        </div>
      </button>
      {open && (
        <div className="p-4">
          <div className="mb-2 grid grid-cols-2 gap-3 border-b border-gray-100 pb-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('admin.translation_editor.column_master', { defaultValue: 'English (master)' })}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('admin.translation_editor.column_translation', { defaultValue: 'Translation' })}</p>
          </div>
          {keys.map((key) => (
            <TranslationRow
              key={key}
              rowKey={key}
              masterValue={enFlat[key] || ''}
              value={flat[key] || ''}
              isDirty={(flat[key] || '') !== (savedFlat[key] || '')}
              isStale={staleKeys.has(key)}
              isMissing={missingKeys.has(key)}
              canTranslate={selectedLang !== 'en'}
              isSaving={Boolean(savingKeys[key])}
              isTranslating={Boolean(translatingKeys[key])}
              feedback={rowFeedback[key]}
              onChange={onChange}
              onSave={onSaveKey}
              onTranslate={onTranslateKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TranslationEditor() {
  const { t } = useTranslation();
  const [selectedLang, setSelectedLang] = useState('en');
  const [enFlat, setEnFlat] = useState<Record<string, string>>({});
  const [flat, setFlat] = useState<Record<string, string>>({});
  const [savedFlat, setSavedFlat] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [autoTranslating, setAutoTranslating] = useState(false);
  const [status, setStatus] = useState<TranslationStatus[]>([]);
  const [staleKeys, setStaleKeys] = useState<string[]>([]);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const [translatingKeys, setTranslatingKeys] = useState<Record<string, boolean>>({});
  const [rowFeedback, setRowFeedback] = useState<Record<string, RowFeedback | undefined>>({});
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((tone: ToastMessage['tone'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const getAutoTranslateErrorMessage = useCallback((err: unknown, fallback: string) => (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback
  ), []);

  const getSectionLabel = useCallback((section: string) => {
    const labels: Record<string, string> = {
      nav: t('admin.translation_editor.sections.nav', { defaultValue: 'Navigation' }),
      submit: t('admin.translation_editor.sections.submit', { defaultValue: 'Submit Form' }),
      confirmation: t('admin.translation_editor.sections.confirmation', { defaultValue: 'Confirmation' }),
      map: t('admin.translation_editor.sections.map', { defaultValue: 'Map' }),
      report: t('admin.translation_editor.sections.report', { defaultValue: 'Report Detail' }),
      auth_public: t('admin.translation_editor.sections.auth_public', { defaultValue: 'Authentication' }),
      account: t('admin.translation_editor.sections.account', { defaultValue: 'Account' }),
      queue: t('admin.translation_editor.sections.queue', { defaultValue: 'My Queue' }),
      public_home: t('admin.translation_editor.sections.public_home', { defaultValue: 'Homepage Fallback' }),
      news: t('admin.translation_editor.sections.news', { defaultValue: 'News' }),
      consent: t('admin.translation_editor.sections.consent', { defaultValue: 'Consent Banner' }),
      admin: t('admin.translation_editor.sections.admin', { defaultValue: 'Admin UI' }),
      common: t('admin.translation_editor.sections.common', { defaultValue: 'Common' }),
      crisis_types: t('admin.translation_editor.sections.crisis_types', { defaultValue: 'Crisis Types' }),
    };
    return labels[section] || section;
  }, [t]);

  const refreshRuntimeTranslations = useCallback(async (lang: string) => {
    bumpI18nResourceVersion();
    await i18n.reloadResources([lang], ['translation']);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.getTranslationStatus() as { languages: TranslationStatus[] };
      setStatus(data.languages);
    } catch {
      return;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setSaved(false);
    try {
      const [enRaw, langRaw] = await Promise.all([
        api.getTranslations('en'),
        api.getTranslations(selectedLang),
      ]);
      const englishFlat = flatten(enRaw.locale);
      const localeFlat = flatten(selectedLang === 'en' ? enRaw.locale : langRaw.locale);
      const projectedFlat = Object.fromEntries(
        Object.keys(englishFlat).map((key) => [key, selectedLang === 'en' ? englishFlat[key] : (localeFlat[key] ?? '')])
      );
      setEnFlat(englishFlat);
      setFlat(projectedFlat);
      setSavedFlat(projectedFlat);
      setStaleKeys(selectedLang === 'en' ? [] : (langRaw.staleKeys || []));
      setMissingKeys(selectedLang === 'en' ? [] : (langRaw.missingKeys || []));
      setRowFeedback({});
    } catch {
      pushToast('error', t('admin.translation_editor.load_failed', { defaultValue: 'Failed to load translation file. Check that the API is running.' }));
    } finally {
      setLoading(false);
    }
  }, [pushToast, selectedLang, t]);

  useEffect(() => {
    load();
    fetchStatus();
  }, [load, fetchStatus]);

  const handleChange = (key: string, val: string) => {
    setFlat((current) => ({ ...current, [key]: val }));
    setRowFeedback((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.saveTranslations(selectedLang, unflatten(flat));
      setSavedFlat(flat);
      setSaved(true);
      setStaleKeys([]);
      setMissingKeys([]);
      await refreshRuntimeTranslations(selectedLang);
      await fetchStatus();
      pushToast('success', t('admin.translation_editor.saved_lang', { defaultValue: '{{lang}} translations saved.', lang: selectedLang.toUpperCase() }));
      window.setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      pushToast('error', getAutoTranslateErrorMessage(err, t('admin.translation_editor.save_failed', { defaultValue: 'Failed to save translations.' })));
    } finally {
      setSaving(false);
    }
  };

  const saveKey = async (key: string) => {
    setSavingKeys((current) => ({ ...current, [key]: true }));
    try {
      const result = await api.saveTranslationKey(selectedLang, key, flat[key] || '');
      setFlat((current) => ({ ...current, [key]: result.value }));
      setSavedFlat((current) => ({ ...current, [key]: result.value }));
      setStaleKeys((current) => current.filter((item) => item !== key));
      setMissingKeys((current) => current.filter((item) => item !== key));
      if (selectedLang === 'en') {
        setEnFlat((current) => ({ ...current, [key]: result.value }));
      }
      setRowFeedback((current) => ({ ...current, [key]: { tone: 'success', message: t('admin.translation_editor.row_saved', { defaultValue: 'Saved.' }) } }));
      await refreshRuntimeTranslations(selectedLang);
      await fetchStatus();
      pushToast('success', t('admin.translation_editor.saved_key', { defaultValue: 'Saved {{key}}.', key }));
    } catch (err: unknown) {
      setRowFeedback((current) => ({
        ...current,
        [key]: { tone: 'error', message: (err as { response?: { data?: { detail?: string; error?: string } } })?.response?.data?.detail || getAutoTranslateErrorMessage(err, t('admin.translation_editor.row_save_failed', { defaultValue: 'Save failed.' })) },
      }));
      pushToast('error', (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || getAutoTranslateErrorMessage(err, t('admin.translation_editor.save_key_failed', { defaultValue: 'Failed to save {{key}}.', key })));
    } finally {
      setSavingKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const autoTranslate = async () => {
    if (selectedLang === 'en') return;
    setAutoTranslating(true);
    try {
      const result = await api.runAutoTranslate(selectedLang);
      pushToast('success', t('admin.translation_editor.draft_completed', { defaultValue: 'OpenRouter draft completed: {{updated}}/{{total}} strings updated with {{model}}.', updated: result.updated, total: result.total, model: result.model }));
      await load();
      await fetchStatus();
    } catch (err: unknown) {
      pushToast('error', getAutoTranslateErrorMessage(err, t('admin.translation_editor.draft_unavailable', { defaultValue: 'AI translation is currently unavailable. Please try again later.' })));
    } finally {
      setAutoTranslating(false);
    }
  };

  const autoTranslateKey = async (key: string) => {
    if (selectedLang === 'en') return;
    setTranslatingKeys((current) => ({ ...current, [key]: true }));
    try {
      const previousValue = flat[key] || '';
      const result = await api.runAutoTranslateKey(selectedLang, key);
      if (!String(result.value || '').trim()) {
        setRowFeedback((current) => ({
          ...current,
          [key]: { tone: 'error', message: t('admin.translation_editor.draft_empty_feedback', { defaultValue: 'Translation returned an empty value. Check the API response and try again.' }) },
        }));
        pushToast('error', t('admin.translation_editor.draft_empty', { defaultValue: 'Translation for {{key}} came back empty.', key }));
        return;
      }
      setFlat((current) => ({ ...current, [key]: result.value }));
      const unchanged = result.value === previousValue;
      setRowFeedback((current) => ({
        ...current,
        [key]: unchanged
          ? { tone: 'info', message: t('admin.translation_editor.draft_no_change_feedback', { defaultValue: 'No visible change from {{model}}. Review the source string or try again.', model: result.model }) }
          : { tone: 'success', message: t('admin.translation_editor.draft_success_feedback', { defaultValue: 'Drafted with {{model}}. Review, then save.', model: result.model }) },
      }));
      pushToast(unchanged ? 'info' : 'success', unchanged
        ? t('admin.translation_editor.draft_no_change', { defaultValue: '{{model}} returned no visible change for {{key}}.', model: result.model, key })
        : t('admin.translation_editor.draft_success', { defaultValue: 'Drafted {{key}} with {{model}}. Review and save when ready.', key, model: result.model }));
    } catch (err: unknown) {
      setRowFeedback((current) => ({
        ...current,
        [key]: {
          tone: 'error',
          message: getAutoTranslateErrorMessage(err, t('admin.translation_editor.draft_unavailable', { defaultValue: 'AI translation is currently unavailable. Please try again later.' })),
        },
      }));
      pushToast('error', getAutoTranslateErrorMessage(err, t('admin.translation_editor.draft_key_failed', { defaultValue: 'Failed to draft {{key}}.', key })));
    } finally {
      setTranslatingKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const allKeys = Object.keys(enFlat);
  const sections = useMemo(() => Array.from(new Set(allKeys.map((key) => key.split('.')[0]))), [allKeys]);
  const filterKey = (key: string) => !search
    || key.toLowerCase().includes(search.toLowerCase())
    || (enFlat[key] || '').toLowerCase().includes(search.toLowerCase())
    || (flat[key] || '').toLowerCase().includes(search.toLowerCase());

  const totalKeys = allKeys.length;
  const translatedKeys = allKeys.filter((key) => flat[key] && flat[key] !== enFlat[key]).length;
  const coverage = totalKeys > 0 ? Math.round((translatedKeys / totalKeys) * 100) : 0;
  const selectedLanguage = SUPPORTED_LANGUAGES.find((lang) => lang.code === selectedLang);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.translation_editor.title', { defaultValue: 'Translation Editor' })}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {t('admin.translation_editor.subtitle_prefix', { defaultValue: 'Edit UI translations for all 6 UN languages.' })} <strong>{t('admin.translation_editor.subtitle_emphasis', { defaultValue: 'English is the master' })}</strong> {t('admin.translation_editor.subtitle_suffix', { defaultValue: 'and powers the source strings.' })}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {SUPPORTED_LANGUAGES.map((lang) => {
          const state = status.find((item) => item.lang === lang.code);
          return (
            <button
              key={lang.code}
              onClick={() => setSelectedLang(lang.code)}
              className={`rounded-xl border p-2.5 text-center transition-all ${
                selectedLang === lang.code ? 'border-un-blue bg-un-light shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="mb-0.5 text-2xl">{lang.flag}</div>
              <div className="text-xs font-semibold text-gray-800">{lang.label}</div>
              {lang.master
                ? <div className="mt-0.5 text-xs font-medium text-un-blue">{t('admin.translation_editor.master_badge', { defaultValue: 'Master' })}</div>
                : <div className="mt-0.5 text-xs text-gray-400">{
                  state?.attentionCount
                    ? t('admin.translation_editor.needs_attention_count', { defaultValue: '{{count}} needs attention', count: state.attentionCount })
                    : t('admin.translation_editor.key_count', { defaultValue: '{{count}} keys', count: state?.keyCount ?? '-' })
                }</div>}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <Globe size={18} className="shrink-0 text-un-blue" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-800">
              {selectedLanguage?.flag} {selectedLanguage?.label}
              {selectedLang === 'en' && <span className="ml-2 text-xs font-normal text-blue-500">{t('admin.translation_editor.master_source_hint', { defaultValue: '<- Master source' })}</span>}
            </p>
          </div>
          {selectedLang !== 'en' && totalKeys > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-un-blue transition-all" style={{ width: `${coverage}%` }} />
              </div>
              <span className="whitespace-nowrap text-xs text-gray-500">{coverage}% ({translatedKeys}/{totalKeys})</span>
            </div>
          )}
        </div>
        <button
          onClick={save}
          disabled={saving || loading}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle size={14} /> : <Save size={14} />}
          {saving ? t('admin.translation_editor.saving', { defaultValue: 'Saving...' }) : saved ? t('admin.translation_editor.saved', { defaultValue: 'Saved!' }) : t('admin.translation_editor.save', { defaultValue: 'Save' })}
        </button>
        {selectedLang !== 'en' && (
          <button
            onClick={autoTranslate}
            disabled={autoTranslating || saving || loading}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {autoTranslating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {autoTranslating ? t('admin.translation_editor.drafting', { defaultValue: 'Drafting...' }) : t('admin.translation_editor.draft_via_openrouter', { defaultValue: 'Draft via OpenRouter' })}
          </button>
        )}
      </div>

      {selectedLang === 'en' && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {t('admin.translation_editor.master_notice_prefix', { defaultValue: 'You are editing the ' })}<strong>{t('admin.translation_editor.master_notice_emphasis', { defaultValue: 'master English source' })}</strong>{t('admin.translation_editor.master_notice_suffix', { defaultValue: '. Save English first, then update the remaining languages.' })}
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('admin.translation_editor.search_placeholder', { defaultValue: 'Search by key or text...' })}
        className="mb-4 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
      />

      {loading ? <LoadingSpinner text={t('admin.translation_editor.loading', { defaultValue: 'Loading translations...' })} /> : (
        sections
          .filter((section) => {
            const sectionKeys = allKeys.filter((key) => key.startsWith(`${section}.`));
            return sectionKeys.some(filterKey);
          })
          .map((section) => {
            const sectionKeys = allKeys.filter((key) => key.startsWith(`${section}.`) && filterKey(key));
            if (!sectionKeys.length) return null;
            return (
              <SectionGroup
                key={section}
                sectionKey={section}
                sectionLabel={getSectionLabel(section)}
                keys={sectionKeys}
                enFlat={enFlat}
                flat={flat}
                savedFlat={savedFlat}
                selectedLang={selectedLang}
                staleKeys={new Set(staleKeys)}
                missingKeys={new Set(missingKeys)}
                savingKeys={savingKeys}
                translatingKeys={translatingKeys}
                rowFeedback={rowFeedback}
                onChange={handleChange}
                onSaveKey={saveKey}
                onTranslateKey={autoTranslateKey}
              />
            );
          })
      )}

      <div className="fixed bottom-6 right-6 z-40">
        <button
          onClick={save}
          disabled={saving || loading || saved}
          className={`flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold shadow-lg transition-all ${
            saved ? 'bg-green-500 text-white' : 'bg-un-blue text-white hover:bg-blue-600'
          } disabled:opacity-60`}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <CheckCircle size={16} /> : <Save size={16} />}
          {saving ? t('admin.translation_editor.saving', { defaultValue: 'Saving...' }) : saved ? t('admin.translation_editor.saved', { defaultValue: 'Saved!' }) : t('admin.translation_editor.save_changes', { defaultValue: 'Save Changes' })}
        </button>
      </div>

      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2">
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
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
