import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import HomePagePreview from '../../components/content/HomePagePreview';
import { buildHomeContentMap, getDefaultHomeContentMap } from '../../components/content/homePreviewData';
import type { SiteContentEntry } from '../../types';
import { api } from '../../api/client';

const PREVIEW_STORAGE_KEY = 'admin_homepage_preview_draft';

type StoredPreview = {
  lang: string;
  sections: SiteContentEntry[];
  saved_at: string;
};

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

export default function ContentPreview() {
  const { t } = useTranslation();
  const [draftSections, setDraftSections] = useState<SiteContentEntry[]>([]);
  const [liveSections, setLiveSections] = useState<SiteContentEntry[]>([]);
  const [lang, setLang] = useState('en');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function loadLive(targetLang: string) {
    try {
      const data = await api.getHomeContent(targetLang);
      setLiveSections(data.live_sections || data.sections || []);
    } catch {
      return;
    }
  }

  useEffect(() => {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as StoredPreview;
      const loadId = scheduleTask(() => {
        setDraftSections(parsed.sections || []);
        setLang(parsed.lang || 'en');
        setSavedAt(parsed.saved_at || null);
        void loadLive(parsed.lang || 'en');
      });
      return () => window.clearTimeout(loadId);
    } catch {
      return;
    }
  }, []);

  const defaultSections = useMemo(() => getDefaultHomeContentMap(t), [t]);
  const draftMap = useMemo(() => buildHomeContentMap(draftSections.length ? draftSections : Object.values(defaultSections), t), [defaultSections, draftSections, t]);
  const liveMap = useMemo(() => buildHomeContentMap(liveSections.length ? liveSections : draftSections, t), [draftSections, liveSections, t]);

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="mx-auto mb-5 flex max-w-7xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t('admin.content_preview.eyebrow', { defaultValue: 'Draft Preview' })}</p>
          <h1 className="text-2xl font-bold text-slate-900">{t('admin.content_preview.title', { defaultValue: 'Homepage preview' })}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('admin.content_preview.subtitle', { defaultValue: 'User-facing rendering of the current admin draft.' })}
            {savedAt ? ` ${t('admin.content_preview.saved_at', { defaultValue: 'Saved {{time}}.', time: new Date(savedAt).toLocaleString() })}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => loadLive(lang)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <RefreshCw size={16} /> {t('admin.content_preview.refresh_live', { defaultValue: 'Refresh live baseline' })}
          </button>
          <a href="/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            <ExternalLink size={16} /> {t('admin.content_preview.open_public_homepage', { defaultValue: 'Open public homepage' })}
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-7xl">
        <HomePagePreview contentMap={draftMap} liveMap={liveMap} showBadges />
      </div>
    </div>
  );
}
