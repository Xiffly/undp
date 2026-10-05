import {  } from './managerControls';
import type { HomeCta, NewsArticle, SiteContentEntry } from '../../types';

export function getSectionLabel(key: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const labels: Record<string, string> = {
    'home.hero': t('admin.content_manager.section_hero', { defaultValue: 'Hero' }),
    'home.how_it_works': t('admin.content_manager.section_how_it_works', { defaultValue: 'How It Works' }),
    'home.stats': t('admin.content_manager.section_stats', { defaultValue: 'Stats' }),
    'home.offline': t('admin.content_manager.section_offline', { defaultValue: 'Offline Support' }),
  };
  return labels[key] || key;
}

export function parseCtas(section: SiteContentEntry): HomeCta[] {
  const ctas = section.meta_json?.ctas;
  if (!Array.isArray(ctas)) return [];
  return [...(ctas as HomeCta[])].sort((a, b) => a.sort_order - b.sort_order);
}

export function parseStatsItems(section: SiteContentEntry): Array<{ id: string; label: string; value: string; icon: string }> {
  const items = section.meta_json?.items;
  if (!Array.isArray(items)) return [];
  return items as Array<{ id: string; label: string; value: string; icon: string }>;
}

export function parseHowSteps(section: SiteContentEntry): Array<{ id: string; title: string; bullets: string[]; icon: string }> {
  const steps = section.meta_json?.steps;
  if (!Array.isArray(steps)) return [];
  return steps as Array<{ id: string; title: string; bullets: string[]; icon: string }>;
}

export function usesStructuredBody(sectionKey?: string | null): boolean {
  return sectionKey === 'home.hero' || sectionKey === 'home.offline';
}

export function normalizeHomepageSectionDraft(section: SiteContentEntry): SiteContentEntry {
  if (usesStructuredBody(section.key)) return section;
  return {
    ...section,
    body_document: [],
  };
}

export function articleDraftSeed(): Partial<NewsArticle> {
  return {
    title: '',
    excerpt: '',
    body_document: [{ type: 'paragraph', content: [{ text: '' }], style: { font_size_token: 'base' } }],
    slug: '',
    seo_title: '',
    seo_description: '',
  };
}
