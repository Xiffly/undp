const DEFAULT_SITE_URL = 'https://crisis-platform.com';
const DEFAULT_SITE_NAME = 'UNDP Crisis Reporter';
const DEFAULT_DESCRIPTION = 'Report crisis damage in your community. Help response teams act faster with verified field information.';
const STRICT_NOINDEX_DIRECTIVE = 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, max-snippet:0, max-image-preview:none, max-video-preview:0';

function normalizeSiteUrl(value: string | undefined) {
  const candidate = (value || DEFAULT_SITE_URL).trim() || DEFAULT_SITE_URL;
  return candidate.replace(/\/+$/, '');
}

export const seoConfig = {
  siteUrl: normalizeSiteUrl(import.meta.env.VITE_SITE_URL),
  siteName: (import.meta.env.VITE_SITE_NAME || DEFAULT_SITE_NAME).trim() || DEFAULT_SITE_NAME,
  defaultDescription: (import.meta.env.VITE_SITE_DESCRIPTION || DEFAULT_DESCRIPTION).trim() || DEFAULT_DESCRIPTION,
  allowIndexing: import.meta.env.VITE_SEO_ALLOW_INDEXING === 'true',
  blockAiCrawlers: import.meta.env.VITE_SEO_BLOCK_AI !== 'false',
  strictNoindexDirective: STRICT_NOINDEX_DIRECTIVE,
};

export function joinTitle(pageTitle?: string) {
  if (!pageTitle) return seoConfig.siteName;
  return `${pageTitle} | ${seoConfig.siteName}`;
}

export function getCanonicalUrl(pathname = '/') {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const cleanPath = normalizedPath === '/' ? '/' : normalizedPath.replace(/\/+$/, '');
  return `${seoConfig.siteUrl}${cleanPath}`;
}

export function buildRobotsDirective(index = true, follow = true) {
  if (!seoConfig.allowIndexing || !index) {
    return seoConfig.strictNoindexDirective;
  }

  const base = [index ? 'index' : 'noindex', follow ? 'follow' : 'nofollow'];
  return `${base.join(', ')}, max-snippet:-1, max-image-preview:large, max-video-preview:-1`;
}
