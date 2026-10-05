import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import BlockRenderer from '../components/content/BlockRenderer';
import type { NewsArticle } from '../types';
import { useSeo } from '../seo/useSeo';

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export default function NewsDetail() {
  const { slug = '' } = useParams();
  const { i18n, t } = useTranslation();
  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useSeo({
    title: article?.seo_title || article?.title || t('news.article_meta_title', { defaultValue: 'News Article' }),
    description: article?.seo_description || article?.excerpt || t('news.article_meta_description', {
      defaultValue: 'Published crisis response update from the platform newsroom.',
    }),
    canonicalPath: `/news/${slug}`,
    type: 'article',
  });

  useEffect(() => {
    const loadId = window.setTimeout(() => {
      setLoading(true);
      api.getPublicNewsArticle(slug)
        .then((data) => setArticle(data.article))
        .catch((err: unknown) => setError(getApiErrorMessage(err, t('news.load_article_error', { defaultValue: 'Failed to load article' }))))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(loadId);
  }, [slug, i18n.resolvedLanguage, t]);

  if (loading) return <LoadingSpinner text={t('news.loading_article', { defaultValue: 'Loading article...' })} />;

  if (!article) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-lg font-semibold text-gray-900">{t('news.article_not_found', { defaultValue: 'Article not found' })}</p>
          <p className="mt-2 text-sm text-gray-500">{error || t('news.article_unavailable', { defaultValue: 'This news article is no longer available.' })}</p>
          <Link to="/news" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white">
            <ArrowLeft size={16} /> {t('news.back_to_news', { defaultValue: 'Back to News' })}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <Link to="/news" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-un-blue hover:underline">
          <ArrowLeft size={16} /> {t('news.back_to_news', { defaultValue: 'Back to News' })}
        </Link>
        <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {article.featured_image_url && (
            <div className="max-h-[26rem] overflow-hidden bg-gray-100">
              <img src={article.featured_image_url} alt={article.title} className="h-full w-full object-cover" />
            </div>
          )}
          <div className="p-6 md:p-8">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <CalendarDays size={14} />
              <span>{article.published_at ? new Date(article.published_at).toLocaleString() : t('news.draft_badge', { defaultValue: 'Draft' })}</span>
              {article.fallback && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{t('news.english_fallback', { defaultValue: 'English fallback' })}</span>}
            </div>
            <h1 className="text-3xl font-bold text-gray-900">{article.title}</h1>
            {article.excerpt && <p className="mt-4 text-lg text-gray-600">{article.excerpt}</p>}
            <div className="mt-6 text-sm leading-7 text-gray-700">
              <BlockRenderer blocks={article.body_document || []} />
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
