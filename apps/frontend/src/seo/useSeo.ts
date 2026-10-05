import { useEffect } from 'react';
import { buildRobotsDirective, getCanonicalUrl, joinTitle, seoConfig } from './config';

type SeoOptions = {
  title?: string;
  description?: string;
  canonicalPath?: string;
  index?: boolean;
  follow?: boolean;
  type?: 'website' | 'article';
};

function upsertMeta(selector: string, attributes: Record<string, string>, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    Object.entries(attributes).forEach(([key, value]) => element?.setAttribute(key, value));
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function upsertLink(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  if (!element) {
    element = document.createElement('link');
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => element?.setAttribute(key, value));
}

export function useSeo(options: SeoOptions = {}) {
  const {
    title,
    description = seoConfig.defaultDescription,
    canonicalPath = typeof window !== 'undefined' ? window.location.pathname : '/',
    index = true,
    follow = true,
    type = 'website',
  } = options;

  useEffect(() => {
    const canonicalUrl = getCanonicalUrl(canonicalPath);
    const robots = buildRobotsDirective(index, follow);
    const titleText = joinTitle(title);

    document.title = titleText;
    upsertMeta('meta[name="description"]', { name: 'description' }, description);
    upsertMeta('meta[name="robots"]', { name: 'robots' }, robots);
    upsertMeta('meta[name="googlebot"]', { name: 'googlebot' }, robots);
    upsertMeta('meta[property="og:title"]', { property: 'og:title' }, titleText);
    upsertMeta('meta[property="og:description"]', { property: 'og:description' }, description);
    upsertMeta('meta[property="og:url"]', { property: 'og:url' }, canonicalUrl);
    upsertMeta('meta[property="og:type"]', { property: 'og:type' }, type);
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name' }, seoConfig.siteName);
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary');
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, titleText);
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, description);
    upsertLink('link[rel="canonical"]', { rel: 'canonical', href: canonicalUrl });
  }, [canonicalPath, description, follow, index, title, type]);
}
