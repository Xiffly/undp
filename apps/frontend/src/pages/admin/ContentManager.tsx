import HomeSectionFields from '../../components/content/HomeSectionFields';
import { Alert, StatusChip } from '../../components/content/managerControls';
import { getSectionLabel, parseCtas, parseStatsItems, parseHowSteps, normalizeHomepageSectionDraft, articleDraftSeed } from '../../components/content/managerHelpers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, Copy, Eye, EyeOff, ExternalLink, FileText, Globe, ImagePlus, Newspaper, PlusCircle, RefreshCw, Save, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import LoadingSpinner from '../../components/LoadingSpinner';
import BlockEditor from '../../components/content/BlockEditor';
import BlockRenderer from '../../components/content/BlockRenderer';
import { normalizePresentation } from '../../components/content/contentSchema';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, getLanguageMeta } from '../../config/languages';
import type { BlockNode, HomeCta, NewsArticle, SiteContentEntry } from '../../types';

type TabId = 'home' | 'news';
const PREVIEW_STORAGE_KEY = 'admin_homepage_preview_draft';

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

export default function ContentManager() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('home');
  const [role, setRole] = useState('team_lead');
  const [lang, setLang] = useState(DEFAULT_LANGUAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [sections, setSections] = useState<SiteContentEntry[]>([]);
  const [liveSections, setLiveSections] = useState<SiteContentEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [draftSection, setDraftSection] = useState<SiteContentEntry | null>(null);
  const draftSectionRef = useRef<SiteContentEntry | null>(null);
  const [savingSection, setSavingSection] = useState(false);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState('');
  const [articleDraft, setArticleDraft] = useState<Partial<NewsArticle> | null>(null);
  const [savingArticle, setSavingArticle] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const canPublish = role === 'admin';
  const canDelete = role === 'admin';
  const canCreate = role === 'admin';
  const selectedSection = draftSection;
  const selectedArticle = articleDraft;
  const selectedLanguageMeta = getLanguageMeta(lang);
  const hasUnsavedChanges = !!selectedSection && JSON.stringify(selectedSection) !== JSON.stringify(sections.find((section) => section.key === selectedSection.key));

  function replaceDraftSection(next: SiteContentEntry | null) {
    draftSectionRef.current = next;
    setDraftSection(next);
  }

  const loadHome = useCallback(async (nextKey?: string) => {
    const data = await api.getHomeContent(lang);
    setSections(data.sections || []);
    setLiveSections(data.live_sections || []);
    const keep = nextKey || selectedKey || data.sections?.[0]?.key || '';
    setSelectedKey(keep);
    const current = (data.sections || []).find((section) => section.key === keep);
    replaceDraftSection(current ? JSON.parse(JSON.stringify(current)) : null);
  }, [lang, selectedKey]);

  const loadNews = useCallback(async (nextId?: string) => {
    const data = await api.getNewsArticles(lang);
    setNewsArticles(data.articles || []);
    const keep = nextId || selectedArticleId || data.articles?.[0]?.id || '';
    setSelectedArticleId(keep);
    if (keep) {
      const detail = await api.getNewsArticle(keep, lang);
      setArticleDraft(JSON.parse(JSON.stringify(detail.article)));
    } else {
      setArticleDraft(null);
    }
  }, [lang, selectedArticleId]);

  useEffect(() => {
    const loadId = scheduleTask(() => {
      Promise.all([api.getMe('admin'), api.getHomeContent(lang), api.getNewsArticles(lang)])
        .then(async ([me, homeData, newsData]) => {
          setRole(me.role || 'team_lead');
          setSections(homeData.sections || []);
          setLiveSections(homeData.live_sections || []);
          const firstKey = homeData.sections?.[0]?.key || '';
          setSelectedKey(firstKey);
          replaceDraftSection(firstKey ? JSON.parse(JSON.stringify(homeData.sections.find((section) => section.key === firstKey))) : null);
          setNewsArticles(newsData.articles || []);
          const firstId = newsData.articles?.[0]?.id || '';
          setSelectedArticleId(firstId);
          if (firstId) {
            const detail = await api.getNewsArticle(firstId, lang);
            setArticleDraft(JSON.parse(JSON.stringify(detail.article)));
          }
        })
        .catch((err: unknown) => setError(getApiErrorMessage(err, t('admin.content_manager.load_failed', { defaultValue: 'Failed to load content' }))))
        .finally(() => setLoading(false));
    });
    return () => window.clearTimeout(loadId);
  }, [lang, t]);

  useEffect(() => {
    if (loading) return;
    const loadId = scheduleTask(() => {
      setError('');
      setSuccess('');
      if (tab === 'home') {
        loadHome(selectedKey).catch((err: unknown) => setError(getApiErrorMessage(err, t('admin.content_manager.load_home_failed', { defaultValue: 'Failed to load home content' }))));
      } else {
        loadNews(selectedArticleId).catch((err: unknown) => setError(getApiErrorMessage(err, t('admin.content_manager.load_news_failed', { defaultValue: 'Failed to load news content' }))));
      }
    });
    return () => window.clearTimeout(loadId);
  }, [lang, loadHome, loadNews, loading, selectedArticleId, selectedKey, t, tab]);

  const heroCtas = useMemo(() => selectedSection?.key === 'home.hero' ? parseCtas(selectedSection) : [], [selectedSection]);
  const statsItems = useMemo(() => selectedSection?.key === 'home.stats' ? parseStatsItems(selectedSection) : [], [selectedSection]);
  const howSteps = useMemo(() => selectedSection?.key === 'home.how_it_works' ? parseHowSteps(selectedSection) : [], [selectedSection]);
  const selectedPresentation = useMemo(() => normalizePresentation(selectedSection?.meta_json || {}), [selectedSection]);

  useEffect(() => {
    if (tab !== 'home' || !sections.length) return;
    const previewSections = selectedSection
      ? sections.map((section) => section.key === selectedSection.key ? selectedSection : section)
      : sections;
    localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify({
      lang,
      sections: previewSections,
      saved_at: new Date().toISOString(),
    }));
  }, [tab, lang, sections, selectedSection]);

  function setSectionBlocks(blocks: BlockNode[]) {
    if (!selectedSection) return;
    replaceDraftSection({ ...selectedSection, body_document: blocks });
  }

  function updateCtas(ctas: HomeCta[]) {
    if (!selectedSection) return;
    replaceDraftSection({ ...selectedSection, meta_json: { ...selectedSection.meta_json, ctas } });
  }

  function updateStatsItems(items: Array<{ id: string; label: string; value: string; icon: string }>) {
    if (!selectedSection) return;
    replaceDraftSection({ ...selectedSection, meta_json: { ...selectedSection.meta_json, items } });
  }

  function updateHowSteps(steps: Array<{ id: string; title: string; bullets: string[]; icon: string }>) {
    if (!selectedSection) return;
    replaceDraftSection({ ...selectedSection, meta_json: { ...selectedSection.meta_json, steps } });
  }

  async function persistSectionDraft(section = draftSectionRef.current) {
    if (!section) return null;
    const normalizedSection = normalizeHomepageSectionDraft(section);
    const result = await api.updateHomeSection(normalizedSection.key, normalizedSection, lang);
    setSections(result.sections || []);
    setLiveSections(result.live_sections || []);
    const current = (result.sections || []).find((item) => item.key === normalizedSection.key) || null;
    replaceDraftSection(current ? JSON.parse(JSON.stringify(current)) : null);
    return current;
  }

  async function saveSection() {
    const currentSection = draftSectionRef.current;
    if (!currentSection) return;
    try {
      setSavingSection(true);
      setError('');
      await persistSectionDraft(currentSection);
      setSuccess(t('admin.content_manager.saved_section', {
        defaultValue: 'Saved {{language}} content for {{section}}.',
        language: selectedLanguageMeta.label,
        section: getSectionLabel(currentSection.key, t),
      }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.save_section_failed', { defaultValue: 'Failed to save section' })));
    } finally {
      setSavingSection(false);
    }
  }

  async function reviewSection() {
    const currentSection = draftSectionRef.current;
    if (!currentSection) return;
    try {
      const key = currentSection.key;
      await persistSectionDraft(currentSection);
      await api.reviewHomeSection(key, lang);
      await loadHome(key);
      setSuccess(t('admin.content_manager.review_section_success', {
        defaultValue: 'Sent {{language}} section to review.',
        language: selectedLanguageMeta.label,
      }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.review_section_failed', { defaultValue: 'Failed to send section to review' })));
    }
  }

  async function publishSection() {
    const currentSection = draftSectionRef.current;
    if (!currentSection) return;
    try {
      const key = currentSection.key;
      await persistSectionDraft(currentSection);
      await api.publishHomeSection(key, lang);
      await loadHome(key);
      setSuccess(t('admin.content_manager.publish_section_success', {
        defaultValue: 'Published {{language}} section.',
        language: selectedLanguageMeta.label,
      }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.publish_section_failed', { defaultValue: 'Failed to publish section' })));
    }
  }

  async function publishHomepage() {
    try {
      setError('');
      if (draftSectionRef.current) await persistSectionDraft(draftSectionRef.current);
      const result = await api.publishHomePage(lang);
      setSections(result.sections || []);
      setLiveSections(result.live_sections || []);
      const current = (result.sections || []).find((section) => section.key === selectedKey);
      replaceDraftSection(current ? JSON.parse(JSON.stringify(current)) : null);
      if (result.publish_result?.success) {
        setSuccess(t('admin.content_manager.publish_homepage_success', {
          defaultValue: 'Published homepage ({{language}}).',
          language: selectedLanguageMeta.label,
        }));
        return;
      }
      setError(t('admin.content_manager.publish_homepage_result_failed', { defaultValue: 'Homepage publish failed.' }));
    } catch (err: unknown) {
      const validationErrors = (err as { response?: { data?: { publish_result?: { validation_errors?: Record<string, string[]> } } } })?.response?.data?.publish_result?.validation_errors;
      if (validationErrors) {
        setError(Object.entries(validationErrors).map(([key, messages]) => `${getSectionLabel(key, t)}: ${messages.join(', ')}`).join(' | '));
      } else {
        setError(getApiErrorMessage(err, t('admin.content_manager.publish_homepage_failed', { defaultValue: 'Failed to publish homepage' })));
      }
    }
  }

  async function copySectionFromSource() {
    if (!selectedSection) return;
    try {
      const result = await api.copyHomeSectionFromSource(selectedSection.key, lang);
      setSections(result.sections || []);
      setLiveSections(result.live_sections || []);
      const current = (result.sections || []).find((section) => section.key === selectedSection.key);
      replaceDraftSection(current ? JSON.parse(JSON.stringify(current)) : null);
      setSuccess(t('admin.content_manager.copy_from_english_success', {
        defaultValue: 'Copied English source into {{language}}.',
        language: selectedLanguageMeta.label,
      }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.copy_from_english_failed', { defaultValue: 'Failed to copy from English source' })));
    }
  }

  function cancelSectionChanges() {
    const current = sections.find((section) => section.key === selectedKey);
    if (current) replaceDraftSection(JSON.parse(JSON.stringify(current)));
  }

  async function moveSection(index: number, direction: 'up' | 'down') {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    const next = [...sections];
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    const order = next.map((section, idx) => ({ key: section.key, sort_order: idx + 1 }));
    try {
      const result = await api.reorderHomeSections(order, lang);
      setSections(result.sections || []);
      setLiveSections(result.live_sections || []);
      const current = (result.sections || []).find((section) => section.key === selectedKey);
      replaceDraftSection(current ? JSON.parse(JSON.stringify(current)) : null);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.reorder_sections_failed', { defaultValue: 'Failed to reorder sections' })));
    }
  }

  async function toggleSectionVisibility(section: SiteContentEntry, enabled: boolean) {
    try {
      const result = await api.updateHomeSectionVisibility(section.key, enabled, lang);
      setSections(result.sections || []);
      setLiveSections(result.live_sections || []);
      const current = (result.sections || []).find((item) => item.key === section.key);
      if (selectedKey === section.key) replaceDraftSection(current ? JSON.parse(JSON.stringify(current)) : null);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.update_visibility_failed', { defaultValue: 'Failed to update section visibility' })));
    }
  }

  async function restoreSection(section: SiteContentEntry) {
    try {
      const result = await api.restoreHomeSection(section.key, lang);
      setSections(result.sections || []);
      setLiveSections(result.live_sections || []);
      const current = (result.sections || []).find((item) => item.key === section.key);
      if (selectedKey === section.key) replaceDraftSection(current ? JSON.parse(JSON.stringify(current)) : null);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.restore_section_failed', { defaultValue: 'Failed to restore section' })));
    }
  }

  async function selectArticle(articleId: string) {
    setSelectedArticleId(articleId);
    const detail = await api.getNewsArticle(articleId, lang);
    setArticleDraft(JSON.parse(JSON.stringify(detail.article)));
  }

  async function saveArticle() {
    if (!selectedArticle) return;
    try {
      setSavingArticle(true);
      setError('');
      let result;
      if (selectedArticle.id) {
        result = await api.updateNewsArticle(selectedArticle.id, selectedArticle, lang);
      } else {
        result = await api.createNewsArticle(selectedArticle);
        if (lang !== DEFAULT_LANGUAGE) {
          setLang(DEFAULT_LANGUAGE);
        }
      }
      setArticleDraft(result.article);
      await loadNews(result.article.id);
      setSuccess(t('admin.content_manager.saved_article', {
        defaultValue: 'Saved {{language}} article content.',
        language: getLanguageMeta(lang).label,
      }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.save_article_failed', { defaultValue: 'Failed to save article' })));
    } finally {
      setSavingArticle(false);
    }
  }

  async function persistArticleDraft(article = selectedArticle) {
    if (!article) return null;
    let result;
    if (article.id) {
      result = await api.updateNewsArticle(article.id, article, lang);
    } else {
      result = await api.createNewsArticle(article);
    }
    setArticleDraft(result.article);
    await loadNews(result.article.id);
    return result.article;
  }

  async function reviewArticle() {
    if (!selectedArticle?.id) return;
    try {
      const current = await persistArticleDraft(selectedArticle);
      if (!current?.id) return;
      await api.reviewNewsArticle(current.id, lang);
      await loadNews(current.id);
      setSuccess(t('admin.content_manager.review_article_success', {
        defaultValue: 'Sent {{language}} article to review.',
        language: selectedLanguageMeta.label,
      }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.review_article_failed', { defaultValue: 'Failed to send article to review' })));
    }
  }

  async function publishArticle() {
    if (!selectedArticle) return;
    try {
      const current = await persistArticleDraft(selectedArticle);
      if (!current?.id) return;
      await api.publishNewsArticle(current.id, lang);
      await loadNews(current.id);
      setSuccess(t('admin.content_manager.publish_article_success', {
        defaultValue: 'Published {{language}} article.',
        language: selectedLanguageMeta.label,
      }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.publish_article_failed', { defaultValue: 'Failed to publish article' })));
    }
  }

  async function copyArticleFromSource() {
    if (!selectedArticle?.id) return;
    try {
      await api.copyNewsArticleFromSource(selectedArticle.id, lang);
      await loadNews(selectedArticle.id);
      setSuccess(t('admin.content_manager.copy_from_english_success', {
        defaultValue: 'Copied English source into {{language}}.',
        language: selectedLanguageMeta.label,
      }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.copy_english_source_failed', { defaultValue: 'Failed to copy English source' })));
    }
  }

  async function deleteArticle(article: Partial<NewsArticle>) {
    if (!article.id || !window.confirm(t('admin.content_manager.confirm_delete_article', {
      defaultValue: 'Delete "{{title}}"? This cannot be undone.',
      title: article.title || '',
    }))) return;
    try {
      await api.deleteNewsArticle(article.id);
      setSuccess(t('admin.content_manager.delete_article_success', { defaultValue: 'News article deleted.' }));
      await loadNews('');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.delete_article_failed', { defaultValue: 'Failed to delete article' })));
    }
  }

  async function uploadFeaturedImage(file: File) {
    if (!selectedArticle?.id) return;
    try {
      setUploadingImage(true);
      const result = await api.uploadNewsFeaturedImage(selectedArticle.id, file, lang);
      setArticleDraft(result.article);
      await loadNews(selectedArticle.id);
      setSuccess(t('admin.content_manager.featured_image_uploaded', { defaultValue: 'Featured image uploaded.' }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.content_manager.upload_featured_image_failed', { defaultValue: 'Failed to upload featured image' })));
    } finally {
      setUploadingImage(false);
    }
  }

  function updatePresentation(patch: Record<string, unknown>) {
    if (!selectedSection) return;
    replaceDraftSection({
      ...selectedSection,
      meta_json: {
        ...selectedSection.meta_json,
        presentation: {
          ...(selectedSection.meta_json?.presentation || {}),
          ...patch,
        },
      },
    });
  }

  function openDraftPreview() {
    const previewSections = selectedSection
      ? sections.map((section) => section.key === selectedSection.key ? selectedSection : section)
      : sections;
    localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify({
      lang,
      sections: previewSections,
      saved_at: new Date().toISOString(),
    }));
    window.open('/admin/content/preview', '_blank', 'noopener,noreferrer');
  }

  if (loading) return <LoadingSpinner text={t('admin.content_manager.loading', { defaultValue: 'Loading content manager...' })} />;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.content_manager.title', { defaultValue: 'Content' })}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2">
            <Globe size={16} className="text-gray-400" />
            <select value={lang} onChange={(event) => setLang(event.target.value)} className="bg-transparent text-sm font-medium text-gray-700 focus:outline-none">
              {SUPPORTED_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>{language.flag} {language.label}</option>
              ))}
            </select>
          </div>
          <button onClick={() => tab === 'home' ? loadHome(selectedKey) : loadNews(selectedArticleId)} className="rounded-xl border border-gray-300 p-2 text-gray-500 hover:bg-gray-50">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {error && <div className="mb-4"><Alert tone="error" message={error} /></div>}
      {success && <div className="mb-4"><Alert tone="success" message={success} /></div>}

      <div className="mb-6 flex border-b border-gray-200">
        {[
          { id: 'home' as const, label: t('admin.content_manager.tab_home', { defaultValue: 'Home Page' }), icon: FileText },
          { id: 'news' as const, label: t('admin.content_manager.tab_news', { defaultValue: 'News' }), icon: Newspaper },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium ${tab === id ? 'border-un-blue text-un-blue' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {tab === 'home' && (
        <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{t('admin.content_manager.homepage', { defaultValue: 'Homepage' })}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canPublish && (
                      <button onClick={publishHomepage} className="rounded-xl bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700">
                        {t('admin.content_manager.publish_homepage', { defaultValue: 'Publish Homepage' })}
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                {sections.map((section, index) => {
                  const isSelected = selectedKey === section.key;
                  return (
                    <div key={section.key} className={`rounded-xl border p-3 ${isSelected ? 'border-un-blue bg-un-light/40' : 'border-gray-200'}`}>
                      <button className="w-full text-left" onClick={() => {
                        if (hasUnsavedChanges && selectedKey !== section.key && !window.confirm(t('admin.content_manager.discard_unsaved_section', { defaultValue: 'Discard unsaved changes for the current section?' }))) return;
                        setSelectedKey(section.key);
                        replaceDraftSection(JSON.parse(JSON.stringify(section)));
                      }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900">{getSectionLabel(section.key, t)}</p>
                          </div>
                          <StatusChip status={section.translation_status} stale={section.is_stale} />
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-400">
                          <span>{section.resolved_lang.toUpperCase()}</span>
                        </div>
                      </button>
                      <div className="mt-3 flex items-center gap-1">
                        <button onClick={() => moveSection(index, 'up')} disabled={index === 0 || !canPublish} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30"><ChevronUp size={16} /></button>
                        <button onClick={() => moveSection(index, 'down')} disabled={index === sections.length - 1 || !canPublish} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30"><ChevronDown size={16} /></button>
                        <button onClick={() => toggleSectionVisibility(section, !section.is_enabled)} disabled={!canPublish} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30">{section.is_enabled ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                        {!section.is_enabled && <button onClick={() => restoreSection(section)} disabled={!canPublish} className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-un-blue hover:bg-blue-50 disabled:opacity-30">{t('admin.content_manager.restore', { defaultValue: 'Restore' })}</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {selectedSection && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{getSectionLabel(selectedSection.key, t)}</h2>
                    <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
                      <span>{selectedLanguageMeta.flag} {selectedLanguageMeta.label}</span>
                      <StatusChip status={selectedSection.translation_status} stale={selectedSection.is_stale} />
                      <span className={`rounded-full px-2 py-0.5 text-xs ${hasUnsavedChanges ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                        {hasUnsavedChanges
                          ? t('admin.content_manager.unsaved_changes', { defaultValue: 'Unsaved changes' })
                          : t('admin.content_manager.draft_matches_saved', { defaultValue: 'Draft matches saved' })}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={openDraftPreview} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      <ExternalLink size={14} /> {t('admin.content_manager.open_draft_preview', { defaultValue: 'Open Draft Preview' })}
                    </button>
                    {lang !== DEFAULT_LANGUAGE && (
                      <button onClick={copySectionFromSource} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                        <Copy size={14} /> {t('admin.content_manager.copy_from_english', { defaultValue: 'Copy from English' })}
                      </button>
                    )}
                    <button onClick={() => {
                      const liveSection = liveSections.find((section) => section.key === selectedSection.key);
                      if (liveSection) replaceDraftSection(JSON.parse(JSON.stringify(liveSection)));
                    }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      {t('admin.content_manager.reset_to_live', { defaultValue: 'Reset to Live' })}
                    </button>
                    <button onClick={reviewSection} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
                      <Send size={14} /> {t('admin.content_manager.send_to_review', { defaultValue: 'Send to Review' })}
                    </button>
                    <button onClick={saveSection} disabled={savingSection} className="inline-flex items-center gap-2 rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50">
                      <Save size={16} /> {savingSection
                        ? t('admin.common.saving', { defaultValue: 'Saving...' })
                        : t('admin.content_manager.save_draft', { defaultValue: 'Save Draft' })}
                    </button>
                  </div>
                </div>

                {lang !== DEFAULT_LANGUAGE && selectedSection.source && (
                  <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.content_manager.english_source', { defaultValue: 'English Source' })}</p>
                    <h3 className="text-lg font-semibold text-gray-900">{selectedSection.source.title}</h3>
                    {selectedSection.source.description && <p className="mt-1 text-sm text-gray-500">{selectedSection.source.description}</p>}
                    <div className="mt-3 text-sm text-gray-600">
                      <BlockRenderer blocks={selectedSection.source.body_document || []} />
                    </div>
                  </div>
                )}

                <HomeSectionFields selectedSection={selectedSection} replaceDraftSection={replaceDraftSection} setSectionBlocks={setSectionBlocks} selectedPresentation={selectedPresentation} updatePresentation={updatePresentation} heroCtas={heroCtas} updateCtas={updateCtas} statsItems={statsItems} updateStatsItems={updateStatsItems} howSteps={howSteps} updateHowSteps={updateHowSteps} cancelSectionChanges={cancelSectionChanges} publishSection={publishSection} canPublish={canPublish} />
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'news' && (
        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{t('admin.content_manager.articles', { defaultValue: 'Articles' })}</h2>
              <button onClick={() => { setLang(DEFAULT_LANGUAGE); setSelectedArticleId(''); setArticleDraft(articleDraftSeed()); }} disabled={!canCreate} className="inline-flex items-center gap-1 rounded-lg bg-un-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                <PlusCircle size={14} /> {t('admin.content_manager.new_article', { defaultValue: 'New' })}
              </button>
            </div>
            <div className="space-y-2">
              {newsArticles.map((article) => (
                <button key={article.id} onClick={() => selectArticle(article.id)} className={`w-full rounded-xl border p-3 text-left ${selectedArticleId === article.id ? 'border-un-blue bg-un-light/40' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-gray-900">{article.title}</p>
                    <StatusChip status={article.translation_status} stale={article.is_stale} />
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-400">{article.slug}</p>
                  <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                    <CalendarDays size={12} />
                    <span>{article.published_at ? new Date(article.published_at).toLocaleDateString() : t('admin.content_manager.not_published', { defaultValue: 'Not published' })}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            {!selectedArticle ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">{t('admin.content_manager.select_or_create_article', { defaultValue: 'Select an article or create a new one.' })}</div>
            ) : (
              <>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{selectedArticle.id ? t('admin.content_manager.edit_article', { defaultValue: 'Edit Article' }) : t('admin.content_manager.create_article', { defaultValue: 'Create Article' })}</h2>
                    <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
                      <span>{selectedLanguageMeta.flag} {selectedLanguageMeta.label}</span>
                      {selectedArticle.id && <StatusChip status={selectedArticle.translation_status || 'draft'} stale={selectedArticle.is_stale} />}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {lang !== DEFAULT_LANGUAGE && selectedArticle.id && (
                      <button onClick={copyArticleFromSource} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                        <Copy size={14} /> {t('admin.content_manager.copy_from_english', { defaultValue: 'Copy from English' })}
                      </button>
                    )}
                    {selectedArticle.id && (
                      <>
                        <button onClick={reviewArticle} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
                          <Send size={14} /> {t('admin.content_manager.send_to_review', { defaultValue: 'Send to Review' })}
                        </button>
                        <button onClick={publishArticle} disabled={!canPublish} className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
                          {t('admin.content_manager.publish', { defaultValue: 'Publish' })}
                        </button>
                      </>
                    )}
                    {selectedArticle.id && (
                      <button onClick={() => deleteArticle(selectedArticle)} disabled={!canDelete} className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">
                        {t('admin.content_manager.delete', { defaultValue: 'Delete' })}
                      </button>
                    )}
                  </div>
                </div>

                {lang !== DEFAULT_LANGUAGE && selectedArticle.source && (
                  <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.content_manager.english_source', { defaultValue: 'English Source' })}</p>
                    <h3 className="text-lg font-semibold text-gray-900">{selectedArticle.source.title}</h3>
                    {selectedArticle.source.excerpt && <p className="mt-1 text-sm text-gray-500">{selectedArticle.source.excerpt}</p>}
                    <div className="mt-3 text-sm text-gray-600">
                      <BlockRenderer blocks={selectedArticle.source.body_document || []} />
                    </div>
                  </div>
                )}

                <div className="grid gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_title', { defaultValue: 'Title' })}</label>
                    <input value={selectedArticle.title || ''} onChange={(event) => setArticleDraft((current) => ({ ...(current || {}), title: event.target.value }))} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_localized_slug', { defaultValue: 'Localized Slug' })}</label>
                    <input value={selectedArticle.slug || ''} onChange={(event) => setArticleDraft((current) => ({ ...(current || {}), slug: event.target.value }))} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_excerpt', { defaultValue: 'Excerpt' })}</label>
                    <textarea rows={3} value={selectedArticle.excerpt || ''} onChange={(event) => setArticleDraft((current) => ({ ...(current || {}), excerpt: event.target.value }))} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_structured_body', { defaultValue: 'Structured Body' })}</label>
                    <BlockEditor blocks={selectedArticle.body_document || []} onChange={(blocks) => setArticleDraft((current) => ({ ...(current || {}), body_document: blocks }))} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_seo_title', { defaultValue: 'SEO Title' })}</label>
                      <input value={selectedArticle.seo_title || ''} onChange={(event) => setArticleDraft((current) => ({ ...(current || {}), seo_title: event.target.value }))} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_seo_description', { defaultValue: 'SEO Description' })}</label>
                      <input value={selectedArticle.seo_description || ''} onChange={(event) => setArticleDraft((current) => ({ ...(current || {}), seo_description: event.target.value }))} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
                      <ImagePlus size={16} /> {t('admin.content_manager.shared_featured_image', { defaultValue: 'Shared Featured Image' })}
                    </div>
                    {selectedArticle.featured_image_url && <img src={selectedArticle.featured_image_url} alt={selectedArticle.title || t('admin.content_manager.featured_image_alt', { defaultValue: 'Featured' })} className="mb-3 h-48 w-full rounded-xl object-cover" />}
                    <label className={`inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium ${canPublish ? 'cursor-pointer hover:bg-gray-50' : 'opacity-50'}`}>
                      <ImagePlus size={16} />
                      {uploadingImage
                        ? t('admin.content_manager.uploading', { defaultValue: 'Uploading...' })
                        : t('admin.content_manager.upload_image', { defaultValue: 'Upload Image' })}
                      <input type="file" accept="image/*" disabled={!canPublish || !selectedArticle.id || uploadingImage} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadFeaturedImage(file); }} />
                    </label>
                    {!selectedArticle.id && <p className="mt-2 text-xs text-gray-400">{t('admin.content_manager.save_article_before_upload', { defaultValue: 'Save the article first before uploading a shared featured image.' })}</p>}
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => selectedArticle.id ? selectArticle(selectedArticle.id) : setArticleDraft(articleDraftSeed())} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                    {t('admin.common.cancel', { defaultValue: 'Cancel' })}
                  </button>
                  <button onClick={saveArticle} disabled={savingArticle} className="inline-flex items-center gap-2 rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50">
                    <Save size={16} /> {savingArticle
                      ? t('admin.common.saving', { defaultValue: 'Saving...' })
                      : t('admin.content_manager.save_draft', { defaultValue: 'Save Draft' })}
                  </button>
                </div>

                {!!selectedArticle.body_document?.length && (
                  <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-5" dir={selectedLanguageMeta.dir}>
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">{t('admin.content_manager.preview', { defaultValue: 'Preview' })}</h3>
                    <article className="rounded-2xl bg-white p-5 shadow-sm">
                      <h4 className="text-2xl font-bold text-gray-900">{selectedArticle.title}</h4>
                      {selectedArticle.excerpt && <p className="mt-3 text-base text-gray-600">{selectedArticle.excerpt}</p>}
                      <div className="mt-5 text-sm leading-7 text-gray-700">
                        <BlockRenderer blocks={selectedArticle.body_document || []} />
                      </div>
                    </article>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
