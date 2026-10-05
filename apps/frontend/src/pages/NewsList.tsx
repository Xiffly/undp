import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import type { NewsArticle } from '../types';
import { useSeo } from '../seo/useSeo';

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export default function NewsList() {
  const { i18n, t } = useTranslation();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useSeo({
    title: t('news.meta_title', { defaultValue: 'News and Field Updates' }),
    description: t('news.meta_description', {
      defaultValue: 'Published field updates, response notices, and crisis communications from the platform team.',
    }),
    canonicalPath: '/news',
  });

  useEffect(() => {
    const loadId = window.setTimeout(() => {
      setLoading(true);
      api.getPublicNewsArticles()
        .then((data) => setArticles(data.articles || []))
        .catch((err: unknown) => setError(getApiErrorMessage(err, t('news.load_error', { defaultValue: 'Failed to load news' }))))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(loadId);
  }, [i18n.resolvedLanguage, t]);

  if (loading) return <LoadingSpinner text={t('news.loading', { defaultValue: 'Loading news...' })} />;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t('news.title', { defaultValue: 'News' })}</h1>
          <p className="mt-2 text-sm text-gray-500">{t('news.subtitle', { defaultValue: 'Updates and field communications published by the crisis response team.' })}</p>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {!articles.length && !error ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center text-gray-500">{t('news.empty', { defaultValue: 'No published news articles yet.' })}</div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {articles.map((article) => (
              <Link key={article.id} to={`/news/${article.slug}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                {article.featured_image_url && (
                  <div className="h-52 overflow-hidden bg-gray-100">
                    <img src={article.featured_image_url} alt={article.title} className="h-full w-full object-cover" />
                  </div>
                )}
                <div className="p-5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <CalendarDays size={14} />
                      <span>{article.published_at ? new Date(article.published_at).toLocaleDateString() : t('news.draft_badge', { defaultValue: 'Draft' })}</span>
                    </div>
                    {article.fallback && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{t('news.english_fallback', { defaultValue: 'English fallback' })}</span>}
                  </div>
                  <h2 className="text-xl font-semibold text-gray-900">{article.title}</h2>
                  {article.excerpt && <p className="mt-3 text-sm leading-relaxed text-gray-600">{article.excerpt}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
