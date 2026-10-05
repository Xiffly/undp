import { validateBodyDocument, normalizeBlocks, normalizeSectionPresentation, documentToLegacyText, textToDocument, BlockNode, CONTAINER_WIDTH_TOKENS, BACKGROUND_VARIANT_TOKENS, PADDING_TOKENS } from '../content/documents';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { authMiddleware, requireRole, type AuthenticatedRequest } from '../middleware/auth';
import { buildMediaUrl, deleteMediaKeys, isAllowedPublicImageMimeType, MediaValidationError, saveMediaFile } from '../media';
import { execute, queryAll, queryOne } from '../dbRuntime';
import { sanitizeHomeHeroMeta } from '../utils/homeHeroCtas';
import { DEFAULT_LANGUAGE, isSupportedLanguage, SUPPORTED_LANGUAGE_CODES } from '../utils/languages';
import { hasTextCorruption } from '../utils/textCorruption';

const router = express.Router();
const publicRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedPublicImageMimeType(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, GIF, and AVIF images are allowed'));
  },
});

type ContentStatus = 'draft' | 'review' | 'published';

type SiteContentEntryRow = {
  id: string;
  key: string;
  title: string;
  description?: string | null;
  body?: string | null;
  meta_json?: unknown;
  is_enabled: boolean;
  sort_order: number;
  is_system: boolean;
  content_revision: number;
  created_at?: string;
  updated_at?: string;
};

type SiteContentTranslationRow = {
  id: string;
  entry_id: string;
  language_code: string;
  title: string;
  description?: string | null;
  body_document?: unknown;
  meta_json?: unknown;
  status: ContentStatus;
  published_at?: string | null;
  source_version: number;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

type NewsArticleRow = {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  body?: string | null;
  featured_image_key?: string | null;
  featured_image_url?: string | null;
  status: 'draft' | 'published';
  published_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  content_revision: number;
  created_at?: string;
  updated_at?: string;
};

type NewsArticleTranslationRow = {
  id: string;
  article_id: string;
  language_code: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  body_document?: unknown;
  seo_title?: string | null;
  seo_description?: string | null;
  status: ContentStatus;
  published_at?: string | null;
  source_version: number;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

type HomeCta = {
  id: string;
  label: string;
  href: string;
  variant?: string;
  enabled: boolean;
  sort_order: number;
};

const HOMEPAGE_SECTION_KEYS = ['home.hero', 'home.how_it_works', 'home.stats', 'home.offline'];

function normalizeLang(value?: string | null): string {
  const raw = String(value || DEFAULT_LANGUAGE).toLowerCase();
  return raw.split('-')[0];
}

function requireSupportedLanguage(res: Response, lang: string): boolean {
  if (!isSupportedLanguage(lang)) {
    res.status(400).json({ error: 'Unsupported language', supported_languages: SUPPORTED_LANGUAGE_CODES });
    return false;
  }
  return true;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === 'object') return value as T;
  return fallback;
}

function emptyDocument(): BlockNode[] {
  return [];
}

function validateLocalizedHomeMeta(meta: Record<string, unknown>, key: string): string | null {
  const presentation = normalizeSectionPresentation(meta);
  if (!CONTAINER_WIDTH_TOKENS.has(String(presentation.container_width_token || 'default'))) return 'Unsupported container width token';
  if (!BACKGROUND_VARIANT_TOKENS.has(String(presentation.background_variant_token || 'default'))) return 'Unsupported background variant token';
  if (!PADDING_TOKENS.has(String(presentation.padding_token || 'normal'))) return 'Unsupported padding token';
  if (key === 'home.how_it_works') {
    const steps = Array.isArray(meta.steps) ? meta.steps as Array<{ title?: string; bullets?: string[]; icon?: string }> : [];
    if (!steps.length) return 'How it works requires at least one step';
    for (const [index, step] of steps.entries()) {
      if (!String(step?.title || '').trim()) return `How it works step ${index + 1} requires a title`;
      if (!Array.isArray(step?.bullets) || !step.bullets.length || step.bullets.some((bullet) => !String(bullet || '').trim())) {
        return `How it works step ${index + 1} requires bullets`;
      }
    }
  }
  if (key === 'home.stats') {
    const items = Array.isArray(meta.items) ? meta.items as Array<{ label?: string; value?: string }> : [];
    if (!items.length) return 'Stats requires at least one item';
    for (const [index, item] of items.entries()) {
      if (!String(item?.label || '').trim() || !String(item?.value || '').trim()) return `Stat card ${index + 1} requires label and value`;
    }
  }
  if (key !== 'home.hero') return null;
  const ctas = Array.isArray(meta.ctas) ? meta.ctas as HomeCta[] : [];
  const enabled = ctas.filter((cta) => cta?.enabled);
  if (!enabled.length) return 'At least one hero CTA must be enabled';
  for (const cta of enabled) {
    if (!String(cta.label || '').trim()) return 'Enabled CTA label is required';
    if (!String(cta.href || '').trim()) return 'Enabled CTA URL is required';
  }
  return null;
}

function containsCorruptedText(value: unknown): boolean {
  if (typeof value === 'string') return hasTextCorruption(value);
  if (Array.isArray(value)) return value.some((item) => containsCorruptedText(item));
  if (value && typeof value === 'object') return Object.values(value).some((item) => containsCorruptedText(item));
  return false;
}

function validateHomeTranslationPayload(key: string, payload: { title?: unknown; description?: unknown; body_document?: unknown; meta_json?: unknown }, publish = false): string | null {
  if (!String(payload.title || '').trim()) return 'Title is required';
  if (key === 'home.hero' && !String(payload.description || '').trim()) return 'Hero subtitle is required';
  const docValidation = validateBodyDocument(payload.body_document);
  if (!docValidation.valid) return docValidation.error || 'Invalid body document';
  const metaError = validateLocalizedHomeMeta(parseJson(payload.meta_json, {}), key);
  if (metaError) return metaError;
  if (containsCorruptedText(payload.title) || containsCorruptedText(payload.description) || containsCorruptedText(docValidation.blocks || payload.body_document) || containsCorruptedText(payload.meta_json)) {
    return 'Corrupted translation text detected';
  }
  if (publish && !String(payload.title || '').trim()) return 'Published locale requires a title';
  return null;
}

function validateNewsTranslationPayload(payload: { slug?: unknown; title?: unknown; excerpt?: unknown; body_document?: unknown }, publish = false): string | null {
  if (!String(payload.title || '').trim()) return 'Title is required';
  if (!String(payload.slug || '').trim()) return 'Slug is required';
  const docValidation = validateBodyDocument(payload.body_document);
  if (!docValidation.valid) return docValidation.error || 'Invalid body document';
  if (containsCorruptedText(payload.title) || containsCorruptedText(payload.excerpt) || containsCorruptedText(docValidation.blocks || payload.body_document)) {
    return 'Corrupted translation text detected';
  }
  if (publish && !String(payload.excerpt || '').trim()) return 'Published locale requires an excerpt';
  return null;
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function ensureUniqueLocalizedSlug(baseSlug: string, lang: string, articleId?: string): Promise<string> {
  const base = normalizeSlug(baseSlug) || `news-${Date.now()}`;
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await queryOne<{ article_id: string }>(
      'SELECT article_id FROM news_article_translations WHERE language_code = ? AND slug = ?',
      [lang, candidate]
    );
    if (!existing || existing.article_id === articleId) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function userRef(req: Request): string {
  const user = (req as AuthenticatedRequest).user;
  return user?.email || user?.id || 'admin';
}

function mapEntryTranslation(base: SiteContentEntryRow, translation: SiteContentTranslationRow | null, requestedLang: string, source: SiteContentTranslationRow | null) {
  const resolved = translation || source;
  const resolvedLang = translation ? translation.language_code : source?.language_code || DEFAULT_LANGUAGE;
  const resolvedDocument = resolved ? normalizeBlocks(parseJson<BlockNode[]>(resolved.body_document, emptyDocument())) : emptyDocument();
  const baseMeta = parseJson<Record<string, unknown>>(base.meta_json, {});
  const resolvedMeta = resolved ? parseJson<Record<string, unknown>>(resolved.meta_json, {}) : baseMeta;
  const sanitizedResolvedMeta = sanitizeHomeHeroMeta(base.key, resolvedMeta);
  const normalizedMeta = { ...sanitizedResolvedMeta, presentation: normalizeSectionPresentation(sanitizedResolvedMeta) };
  const sourceVersion = translation?.source_version ?? 0;
  const isStale = translation
    ? translation.language_code !== DEFAULT_LANGUAGE && Number(base.content_revision || 1) > Number(sourceVersion || 0)
    : false;
  return {
    id: base.id,
    key: base.key,
    is_enabled: Boolean(base.is_enabled),
    sort_order: Number(base.sort_order || 0),
    is_system: Boolean(base.is_system),
    content_revision: Number(base.content_revision || 1),
    requested_lang: requestedLang,
    resolved_lang: resolvedLang,
    fallback: resolvedLang !== requestedLang,
    translation_status: translation?.status || 'missing',
    is_stale: isStale,
    title: resolved?.title || base.title,
    description: resolved?.description || base.description || '',
    body_document: resolvedDocument,
    meta_json: normalizedMeta,
    source: source ? {
      language_code: source.language_code,
      title: source.title,
      description: source.description || '',
      body_document: normalizeBlocks(parseJson<BlockNode[]>(source.body_document, emptyDocument())),
      meta_json: (() => {
        const meta = sanitizeHomeHeroMeta(base.key, parseJson<Record<string, unknown>>(source.meta_json, {}));
        return { ...meta, presentation: normalizeSectionPresentation(meta) };
      })(),
      status: source.status,
      published_at: source.published_at || null,
      source_version: source.source_version,
    } : null,
    translation: translation ? {
      language_code: translation.language_code,
      title: translation.title,
      description: translation.description || '',
      body_document: normalizeBlocks(parseJson<BlockNode[]>(translation.body_document, emptyDocument())),
      meta_json: (() => {
        const meta = sanitizeHomeHeroMeta(base.key, parseJson<Record<string, unknown>>(translation.meta_json, {}));
        return { ...meta, presentation: normalizeSectionPresentation(meta) };
      })(),
      status: translation.status,
      published_at: translation.published_at || null,
      source_version: translation.source_version,
    } : null,
  };
}

async function getSiteContentRows(): Promise<SiteContentEntryRow[]> {
  return queryAll<SiteContentEntryRow>('SELECT * FROM site_content_entries ORDER BY sort_order ASC, created_at ASC');
}

async function getEntryTranslations(entryIds: string[]): Promise<SiteContentTranslationRow[]> {
  if (!entryIds.length) return [];
  return queryAll<SiteContentTranslationRow>('SELECT * FROM site_content_entry_translations WHERE entry_id = ANY(?)', [entryIds]);
}

async function getHomePayload(requestedLang: string, includeDisabled = true, admin = false, includeLive = false) {
  const rows = await getSiteContentRows();
  const filtered = includeDisabled ? rows : rows.filter((row) => row.is_enabled);
  const translations = await getEntryTranslations(filtered.map((row) => row.id));
  const byEntry = new Map<string, SiteContentTranslationRow[]>();
  for (const translation of translations) {
    const list = byEntry.get(translation.entry_id) || [];
    list.push(translation);
    byEntry.set(translation.entry_id, list);
  }
  const sections = filtered.map((base) => {
    const list = byEntry.get(base.id) || [];
    const requested = list.find((item) => item.language_code === requestedLang) || null;
    const source = list.find((item) => item.language_code === DEFAULT_LANGUAGE) || null;
    const mapped = mapEntryTranslation(base, requested, requestedLang, source);
    if (!admin && mapped.translation_status !== 'published' && mapped.resolved_lang === requestedLang) {
      const fallbackMapped = mapEntryTranslation(base, source, requestedLang, source);
      return { ...fallbackMapped, fallback: true, resolved_lang: source?.language_code || DEFAULT_LANGUAGE };
    }
    return mapped;
  });
  const payload: { requested_lang: string; sections: any[]; live_sections?: any[] } = { requested_lang: requestedLang, sections };
  if (includeLive) {
    const liveSections = filtered.map((base) => {
      const list = byEntry.get(base.id) || [];
      const requested = list.find((item) => item.language_code === requestedLang && item.status === 'published') || null;
      const source = list.find((item) => item.language_code === DEFAULT_LANGUAGE && item.status === 'published') || null;
      const resolvedRequested = requested || (requestedLang === DEFAULT_LANGUAGE ? null : source);
      return mapEntryTranslation(base, resolvedRequested, requestedLang, source);
    });
    payload.live_sections = liveSections;
  }
  return payload;
}

async function getNewsRows(): Promise<NewsArticleRow[]> {
  return queryAll<NewsArticleRow>('SELECT * FROM news_articles ORDER BY created_at DESC');
}

async function getNewsTranslations(articleIds: string[]): Promise<NewsArticleTranslationRow[]> {
  if (!articleIds.length) return [];
  return queryAll<NewsArticleTranslationRow>('SELECT * FROM news_article_translations WHERE article_id = ANY(?)', [articleIds]);
}

async function formatNewsArticle(base: NewsArticleRow, translation: NewsArticleTranslationRow | null, requestedLang: string, source: NewsArticleTranslationRow | null, admin = false) {
  const resolved = translation || source;
  const resolvedLang = translation ? translation.language_code : source?.language_code || DEFAULT_LANGUAGE;
  const translationStatus = translation?.status || 'missing';
  const shouldFallback = !admin && translationStatus !== 'published' && requestedLang !== DEFAULT_LANGUAGE;
  const finalTranslation = shouldFallback ? source : resolved;
  const finalLang = shouldFallback ? DEFAULT_LANGUAGE : resolvedLang;
  return {
    id: base.id,
    requested_lang: requestedLang,
    resolved_lang: finalLang,
    fallback: finalLang !== requestedLang,
    featured_image_key: base.featured_image_key || null,
    featured_image_url: base.featured_image_key ? await buildMediaUrl(base.featured_image_key) : (base.featured_image_url || null),
    created_by: base.created_by || null,
    updated_by: base.updated_by || null,
    created_at: base.created_at,
    updated_at: base.updated_at,
    content_revision: Number(base.content_revision || 1),
    translation_status: translationStatus,
    is_stale: translation ? translation.language_code !== DEFAULT_LANGUAGE && Number(base.content_revision || 1) > Number(translation.source_version || 0) : false,
    slug: finalTranslation?.slug || base.slug,
    title: finalTranslation?.title || base.title,
    excerpt: finalTranslation?.excerpt || base.excerpt || '',
    body_document: normalizeBlocks(parseJson<BlockNode[]>(finalTranslation?.body_document, textToDocument(base.body))),
    seo_title: finalTranslation?.seo_title || null,
    seo_description: finalTranslation?.seo_description || null,
    published_at: finalTranslation?.published_at || base.published_at || null,
    source: source ? {
      language_code: source.language_code,
      slug: source.slug,
      title: source.title,
      excerpt: source.excerpt || '',
      body_document: normalizeBlocks(parseJson<BlockNode[]>(source.body_document, emptyDocument())),
      seo_title: source.seo_title || null,
      seo_description: source.seo_description || null,
      status: source.status,
      published_at: source.published_at || null,
      source_version: source.source_version,
    } : null,
    translation: translation ? {
      language_code: translation.language_code,
      slug: translation.slug,
      title: translation.title,
      excerpt: translation.excerpt || '',
      body_document: normalizeBlocks(parseJson<BlockNode[]>(translation.body_document, emptyDocument())),
      seo_title: translation.seo_title || null,
      seo_description: translation.seo_description || null,
      status: translation.status,
      published_at: translation.published_at || null,
      source_version: translation.source_version,
    } : null,
  };
}

async function buildNewsPayload(requestedLang: string, admin = false) {
  const rows = await getNewsRows();
  const translations = await getNewsTranslations(rows.map((row) => row.id));
  const byArticle = new Map<string, NewsArticleTranslationRow[]>();
  for (const translation of translations) {
    const list = byArticle.get(translation.article_id) || [];
    list.push(translation);
    byArticle.set(translation.article_id, list);
  }
  const articles = [];
  for (const base of rows) {
    const list = byArticle.get(base.id) || [];
    const requested = list.find((item) => item.language_code === requestedLang) || null;
    const source = list.find((item) => item.language_code === DEFAULT_LANGUAGE) || null;
    const article = await formatNewsArticle(base, requested, requestedLang, source, admin);
    const summary = Object.fromEntries(list.map((item) => [item.language_code, { status: item.status, published_at: item.published_at || null, slug: item.slug }]));
    const withSummary = { ...article, translations_summary: summary };
    if (admin) {
      articles.push(withSummary);
      continue;
    }
    const localeChoice = requested && requested.status === 'published' ? requested : source && source.status === 'published' ? source : null;
    if (!localeChoice) continue;
    articles.push(article);
  }
  articles.sort((a: any, b: any) => new Date(b.published_at || b.created_at || 0).getTime() - new Date(a.published_at || a.created_at || 0).getTime());
  return { requested_lang: requestedLang, articles };
}

async function findEntryByKey(key: string) {
  return queryOne<SiteContentEntryRow>('SELECT * FROM site_content_entries WHERE key = ?', [key]);
}

async function findEntryTranslation(entryId: string, lang: string) {
  return queryOne<SiteContentTranslationRow>('SELECT * FROM site_content_entry_translations WHERE entry_id = ? AND language_code = ?', [entryId, lang]);
}

async function upsertEntryTranslation(base: SiteContentEntryRow, lang: string, payload: { title: string; description: string; body_document: BlockNode[]; meta_json: Record<string, unknown> }, updatedBy: string) {
  const existing = await findEntryTranslation(base.id, lang);
  let revision = Number(base.content_revision || 1);
  const normalizedBlocksValue = normalizeBlocks(payload.body_document || []);
  const normalizedMeta = { ...(payload.meta_json || {}), presentation: normalizeSectionPresentation(payload.meta_json || {}) };
  if (lang === DEFAULT_LANGUAGE) {
    revision += 1;
    await execute(
      `UPDATE site_content_entries
       SET title = ?, description = ?, body = ?, meta_json = ?, content_revision = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        payload.title,
        payload.description,
        documentToLegacyText(normalizedBlocksValue),
        JSON.stringify(normalizedMeta),
        revision,
        base.id,
      ]
    );
  }
  const translationId = existing?.id || randomUUID();
  await execute(
    `INSERT INTO site_content_entry_translations
     (id, entry_id, language_code, title, description, body_document, meta_json, status, published_at, source_version, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (entry_id, language_code)
     DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      body_document = EXCLUDED.body_document,
      meta_json = EXCLUDED.meta_json,
      source_version = EXCLUDED.source_version,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`,
    [
      translationId,
      base.id,
      lang,
      payload.title,
      payload.description,
      JSON.stringify(normalizedBlocksValue),
      JSON.stringify(normalizedMeta),
      existing?.status || (lang === DEFAULT_LANGUAGE ? 'published' : 'draft'),
      existing?.published_at || (lang === DEFAULT_LANGUAGE ? new Date().toISOString() : null),
      lang === DEFAULT_LANGUAGE ? revision : existing?.source_version || Number(base.content_revision || 1),
      updatedBy,
    ]
  );
}

async function setEntryTranslationStatus(base: SiteContentEntryRow, lang: string, status: ContentStatus, updatedBy: string) {
  const translation = await findEntryTranslation(base.id, lang);
  if (!translation) return null;
  await execute(
    `UPDATE site_content_entry_translations
     SET status = ?, published_at = ?, source_version = ?, updated_by = ?, updated_at = NOW()
     WHERE entry_id = ? AND language_code = ?`,
    [
      status,
      status === 'published' ? new Date().toISOString() : translation.published_at,
      Number(base.content_revision || 1),
      updatedBy,
      base.id,
      lang,
    ]
  );
  return findEntryTranslation(base.id, lang);
}

async function validateHomepagePublish(lang: string) {
  const rows = (await getSiteContentRows()).filter((row) => HOMEPAGE_SECTION_KEYS.includes(row.key));
  const validationErrors: Record<string, string[]> = {};

  for (const row of rows) {
    const translation = await findEntryTranslation(row.id, lang);
    if (!translation) {
      validationErrors[row.key] = ['Translation must be saved before homepage publish'];
      continue;
    }
    if (lang !== DEFAULT_LANGUAGE) {
      const source = await findEntryTranslation(row.id, DEFAULT_LANGUAGE);
      if (!source) {
        validationErrors[row.key] = ['English source must exist before translated locales can publish'];
        continue;
      }
    }
    const error = validateHomeTranslationPayload(row.key, {
      title: translation.title,
      description: translation.description,
      body_document: parseJson<BlockNode[]>(translation.body_document, emptyDocument()),
      meta_json: parseJson<Record<string, unknown>>(translation.meta_json, {}),
    }, true);
    if (error) {
      validationErrors[row.key] = [error];
    }
  }

  return {
    valid: Object.keys(validationErrors).length === 0,
    validationErrors,
    rows,
  };
}

async function findNewsArticle(articleId: string) {
  return queryOne<NewsArticleRow>('SELECT * FROM news_articles WHERE id = ?', [articleId]);
}

async function findNewsTranslation(articleId: string, lang: string) {
  return queryOne<NewsArticleTranslationRow>('SELECT * FROM news_article_translations WHERE article_id = ? AND language_code = ?', [articleId, lang]);
}

async function upsertNewsTranslation(base: NewsArticleRow, lang: string, payload: { slug: string; title: string; excerpt: string; body_document: BlockNode[]; seo_title?: string | null; seo_description?: string | null }, updatedBy: string) {
  const existing = await findNewsTranslation(base.id, lang);
  let revision = Number(base.content_revision || 1);
  if (lang === DEFAULT_LANGUAGE) {
    revision += 1;
    await execute(
      `UPDATE news_articles
       SET slug = ?, title = ?, excerpt = ?, body = ?, content_revision = ?, updated_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        payload.slug,
        payload.title,
        payload.excerpt,
        documentToLegacyText(payload.body_document),
        revision,
        updatedBy,
        base.id,
      ]
    );
  }
  const slug = await ensureUniqueLocalizedSlug(payload.slug, lang, base.id);
  const translationId = existing?.id || randomUUID();
  await execute(
    `INSERT INTO news_article_translations
     (id, article_id, language_code, slug, title, excerpt, body_document, seo_title, seo_description, status, published_at, source_version, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (article_id, language_code)
     DO UPDATE SET
      slug = EXCLUDED.slug,
      title = EXCLUDED.title,
      excerpt = EXCLUDED.excerpt,
      body_document = EXCLUDED.body_document,
      seo_title = EXCLUDED.seo_title,
      seo_description = EXCLUDED.seo_description,
      source_version = EXCLUDED.source_version,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`,
    [
      translationId,
      base.id,
      lang,
      slug,
      payload.title,
      payload.excerpt,
      JSON.stringify(payload.body_document || []),
      payload.seo_title || null,
      payload.seo_description || null,
      existing?.status || (lang === DEFAULT_LANGUAGE ? 'published' : 'draft'),
      existing?.published_at || (lang === DEFAULT_LANGUAGE ? new Date().toISOString() : null),
      lang === DEFAULT_LANGUAGE ? revision : existing?.source_version || Number(base.content_revision || 1),
      updatedBy,
    ]
  );
}

async function setNewsTranslationStatus(base: NewsArticleRow, lang: string, status: ContentStatus, updatedBy: string) {
  const translation = await findNewsTranslation(base.id, lang);
  if (!translation) return null;
  await execute(
    `UPDATE news_article_translations
     SET status = ?, published_at = ?, source_version = ?, updated_by = ?, updated_at = NOW()
     WHERE article_id = ? AND language_code = ?`,
    [
      status,
      status === 'published' ? new Date().toISOString() : translation.published_at,
      Number(base.content_revision || 1),
      updatedBy,
      base.id,
      lang,
    ]
  );
  if (lang === DEFAULT_LANGUAGE) {
    await execute(
      'UPDATE news_articles SET status = ?, published_at = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
      [status === 'published' ? 'published' : 'draft', status === 'published' ? new Date().toISOString() : base.published_at, updatedBy, base.id]
    );
  }
  return findNewsTranslation(base.id, lang);
}

router.get('/home', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  res.json(await getHomePayload(lang, true, true, true));
});

router.patch('/home/:key', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  const base = await findEntryByKey(String(req.params.key || '').trim());
  if (!base) {
    res.status(404).json({ error: 'Content entry not found' });
    return;
  }
  if (lang !== DEFAULT_LANGUAGE) {
    const source = await findEntryTranslation(base.id, DEFAULT_LANGUAGE);
    if (!source) {
      res.status(400).json({ error: 'English source must exist before translated locales can be edited' });
      return;
    }
  }
  const next = {
    title: String(req.body?.title || '').trim(),
    description: String(req.body?.description || ''),
    body_document: Array.isArray(req.body?.body_document) ? req.body.body_document as BlockNode[] : emptyDocument(),
    meta_json: parseJson<Record<string, unknown>>(req.body?.meta_json, {}),
  };
  const docValidation = validateBodyDocument(next.body_document);
  const validationError = !docValidation.valid ? (docValidation.error || 'Invalid body document') : validateHomeTranslationPayload(base.key, { ...next, body_document: docValidation.blocks || next.body_document });
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  await upsertEntryTranslation(base, lang, { ...next, body_document: docValidation.blocks || next.body_document }, userRef(req));
  res.json(await getHomePayload(lang, true, true, true));
});

router.post('/home/:key/review', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  const base = await findEntryByKey(String(req.params.key || '').trim());
  if (!base) {
    res.status(404).json({ error: 'Content entry not found' });
    return;
  }
  const translation = await findEntryTranslation(base.id, lang);
  if (!translation) {
    res.status(400).json({ error: 'Translation must be saved before it can move to review' });
    return;
  }
  const validationError = validateHomeTranslationPayload(base.key, {
    title: translation.title,
    description: translation.description,
    body_document: parseJson<BlockNode[]>(translation.body_document, emptyDocument()),
    meta_json: parseJson<Record<string, unknown>>(translation.meta_json, {}),
  });
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  await setEntryTranslationStatus(base, lang, 'review', userRef(req));
  res.json(await getHomePayload(lang, true, true, true));
});

router.post('/home/:key/publish', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  const base = await findEntryByKey(String(req.params.key || '').trim());
  if (!base) {
    res.status(404).json({ error: 'Content entry not found' });
    return;
  }
  if (lang !== DEFAULT_LANGUAGE) {
    const source = await findEntryTranslation(base.id, DEFAULT_LANGUAGE);
    if (!source) {
      res.status(400).json({ error: 'English source must exist before translated locales can publish' });
      return;
    }
  }
  const translation = await findEntryTranslation(base.id, lang);
  if (!translation) {
    res.status(400).json({ error: 'Translation must be saved before it can publish' });
    return;
  }
  const validationError = validateHomeTranslationPayload(base.key, {
    title: translation.title,
    description: translation.description,
    body_document: parseJson<BlockNode[]>(translation.body_document, emptyDocument()),
    meta_json: parseJson<Record<string, unknown>>(translation.meta_json, {}),
  }, true);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  await setEntryTranslationStatus(base, lang, 'published', userRef(req));
  res.json(await getHomePayload(lang, true, true, true));
});

router.post('/home/publish-page', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  const validation = await validateHomepagePublish(lang);
  if (!validation.valid) {
    res.status(400).json({
      ...(await getHomePayload(lang, true, true, true)),
      publish_result: {
        success: false,
        published_keys: [],
        validation_errors: validation.validationErrors,
        published_at: new Date().toISOString(),
      },
    });
    return;
  }

  const publishedAt = new Date().toISOString();
  const publishedKeys: string[] = [];
  for (const row of validation.rows) {
    await setEntryTranslationStatus(row, lang, 'published', userRef(req));
    publishedKeys.push(row.key);
  }

  res.json({
    ...(await getHomePayload(lang, true, true, true)),
    publish_result: {
      success: true,
      published_keys: publishedKeys,
      validation_errors: {},
      published_at: publishedAt,
    },
  });
});

router.post('/home/:key/copy-from-source', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  if (lang === DEFAULT_LANGUAGE) {
    res.status(400).json({ error: 'English source cannot copy from itself' });
    return;
  }
  const base = await findEntryByKey(String(req.params.key || '').trim());
  if (!base) {
    res.status(404).json({ error: 'Content entry not found' });
    return;
  }
  const source = await findEntryTranslation(base.id, DEFAULT_LANGUAGE);
  if (!source) {
    res.status(404).json({ error: 'English source translation not found' });
    return;
  }
  await upsertEntryTranslation(base, lang, {
    title: source.title,
    description: source.description || '',
    body_document: parseJson<BlockNode[]>(source.body_document, emptyDocument()),
    meta_json: parseJson<Record<string, unknown>>(source.meta_json, {}),
  }, userRef(req));
  await setEntryTranslationStatus(base, lang, 'draft', userRef(req));
  res.json(await getHomePayload(lang, true, true, true));
});

router.patch('/home/reorder', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  for (const item of order) {
    await execute('UPDATE site_content_entries SET sort_order = ?, updated_at = NOW() WHERE key = ?', [
      Number(item?.sort_order || 0),
      String(item?.key || ''),
    ]);
  }
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  res.json(await getHomePayload(lang, true, true, true));
});

router.patch('/home/:key/visibility', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const key = String(req.params.key || '').trim();
  await execute(
    'UPDATE site_content_entries SET is_enabled = ?, updated_at = NOW() WHERE key = ?',
    [Boolean(req.body?.is_enabled), key]
  );
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  res.json(await getHomePayload(lang, true, true, true));
});

router.post('/home/:key/restore', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const key = String(req.params.key || '').trim();
  await execute('UPDATE site_content_entries SET is_enabled = TRUE, updated_at = NOW() WHERE key = ?', [key]);
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  res.json(await getHomePayload(lang, true, true, true));
});

router.get('/news', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  res.json(await buildNewsPayload(lang, true));
});

router.get('/news/:id', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  const base = await findNewsArticle(req.params.id);
  if (!base) {
    res.status(404).json({ error: 'News article not found' });
    return;
  }
  const translations = await getNewsTranslations([base.id]);
  const requested = translations.find((item) => item.article_id === base.id && item.language_code === lang) || null;
  const source = translations.find((item) => item.article_id === base.id && item.language_code === DEFAULT_LANGUAGE) || null;
  const article = await formatNewsArticle(base, requested, lang, source, true);
  const summary = Object.fromEntries(translations.filter((item) => item.article_id === base.id).map((item) => [item.language_code, { status: item.status, published_at: item.published_at || null, slug: item.slug }]));
  res.json({ article: { ...article, translations_summary: summary } });
});

router.post('/news', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const slug = await ensureUniqueLocalizedSlug(String(req.body?.slug || req.body?.title || 'news'), DEFAULT_LANGUAGE);
  const next = {
    slug,
    title: String(req.body?.title || '').trim(),
    excerpt: String(req.body?.excerpt || ''),
    body_document: Array.isArray(req.body?.body_document) ? req.body.body_document as BlockNode[] : textToDocument(String(req.body?.body || '')),
    seo_title: String(req.body?.seo_title || req.body?.title || '').trim() || null,
    seo_description: String(req.body?.seo_description || req.body?.excerpt || '').trim() || null,
  };
  const validationError = validateNewsTranslationPayload(next);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const id = randomUUID();
  await execute(
    `INSERT INTO news_articles
      (id, slug, title, excerpt, body, featured_image_key, featured_image_url, status, published_at, created_by, updated_by, content_revision)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, 'draft', NULL, ?, ?, 1)`,
    [id, slug, next.title, next.excerpt, documentToLegacyText(next.body_document), userRef(req), userRef(req)]
  );
  const base = await findNewsArticle(id);
  if (!base) {
    res.status(500).json({ error: 'Failed to create article' });
    return;
  }
  await upsertNewsTranslation(base, DEFAULT_LANGUAGE, next, userRef(req));
  await setNewsTranslationStatus(base, DEFAULT_LANGUAGE, 'draft', userRef(req));
  const article = await findNewsArticle(id);
  const translations = await getNewsTranslations([id]);
  const source = translations.find((item) => item.language_code === DEFAULT_LANGUAGE) || null;
  const formatted = await formatNewsArticle(article as NewsArticleRow, source, DEFAULT_LANGUAGE, source, true);
  res.status(201).json({ article: { ...formatted, translations_summary: { [DEFAULT_LANGUAGE]: { status: source?.status || 'draft', published_at: source?.published_at || null, slug: source?.slug || slug } } } });
});

router.patch('/news/:id', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  const base = await findNewsArticle(req.params.id);
  if (!base) {
    res.status(404).json({ error: 'News article not found' });
    return;
  }
  if (lang !== DEFAULT_LANGUAGE) {
    const source = await findNewsTranslation(base.id, DEFAULT_LANGUAGE);
    if (!source) {
      res.status(400).json({ error: 'English source must exist before translated locales can be edited' });
      return;
    }
  }
  const requestedSlug = String(req.body?.slug || (await findNewsTranslation(base.id, lang))?.slug || base.slug);
  const next = {
    slug: requestedSlug,
    title: String(req.body?.title || '').trim(),
    excerpt: String(req.body?.excerpt || ''),
    body_document: Array.isArray(req.body?.body_document) ? req.body.body_document as BlockNode[] : emptyDocument(),
    seo_title: String(req.body?.seo_title || '').trim() || null,
    seo_description: String(req.body?.seo_description || '').trim() || null,
  };
  const validationError = validateNewsTranslationPayload(next);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  await upsertNewsTranslation(base, lang, next, userRef(req));
  const translations = await getNewsTranslations([base.id]);
  const requested = translations.find((item) => item.article_id === base.id && item.language_code === lang) || null;
  const source = translations.find((item) => item.article_id === base.id && item.language_code === DEFAULT_LANGUAGE) || null;
  const article = await formatNewsArticle((await findNewsArticle(base.id)) as NewsArticleRow, requested, lang, source, true);
  const summary = Object.fromEntries(translations.filter((item) => item.article_id === base.id).map((item) => [item.language_code, { status: item.status, published_at: item.published_at || null, slug: item.slug }]));
  res.json({ article: { ...article, translations_summary: summary } });
});

router.post('/news/:id/review', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  const base = await findNewsArticle(req.params.id);
  if (!base) {
    res.status(404).json({ error: 'News article not found' });
    return;
  }
  const translation = await findNewsTranslation(base.id, lang);
  if (!translation) {
    res.status(400).json({ error: 'Translation must be saved before it can move to review' });
    return;
  }
  const validationError = validateNewsTranslationPayload({
    slug: translation.slug,
    title: translation.title,
    excerpt: translation.excerpt,
    body_document: parseJson<BlockNode[]>(translation.body_document, emptyDocument()),
  });
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  await setNewsTranslationStatus(base, lang, 'review', userRef(req));
  res.json(await buildNewsPayload(lang, true));
});

router.post('/news/:id/publish', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  const base = await findNewsArticle(req.params.id);
  if (!base) {
    res.status(404).json({ error: 'News article not found' });
    return;
  }
  if (lang !== DEFAULT_LANGUAGE) {
    const source = await findNewsTranslation(base.id, DEFAULT_LANGUAGE);
    if (!source) {
      res.status(400).json({ error: 'English source must exist before translated locales can publish' });
      return;
    }
  }
  const translation = await findNewsTranslation(base.id, lang);
  if (!translation) {
    res.status(400).json({ error: 'Translation must be saved before it can publish' });
    return;
  }
  const validationError = validateNewsTranslationPayload({
    slug: translation.slug,
    title: translation.title,
    excerpt: translation.excerpt,
    body_document: parseJson<BlockNode[]>(translation.body_document, emptyDocument()),
  }, true);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  await setNewsTranslationStatus(base, lang, 'published', userRef(req));
  res.json(await buildNewsPayload(lang, true));
});

router.post('/news/:id/copy-from-source', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  if (lang === DEFAULT_LANGUAGE) {
    res.status(400).json({ error: 'English source cannot copy from itself' });
    return;
  }
  const base = await findNewsArticle(req.params.id);
  if (!base) {
    res.status(404).json({ error: 'News article not found' });
    return;
  }
  const source = await findNewsTranslation(base.id, DEFAULT_LANGUAGE);
  if (!source) {
    res.status(404).json({ error: 'English source translation not found' });
    return;
  }
  await upsertNewsTranslation(base, lang, {
    slug: source.slug,
    title: source.title,
    excerpt: source.excerpt || '',
    body_document: parseJson<BlockNode[]>(source.body_document, emptyDocument()),
    seo_title: source.seo_title || null,
    seo_description: source.seo_description || null,
  }, userRef(req));
  await setNewsTranslationStatus(base, lang, 'draft', userRef(req));
  res.json(await buildNewsPayload(lang, true));
});

router.post('/news/:id/featured-image', authMiddleware, requireRole('admin'), upload.single('image'), async (req: Request, res: Response): Promise<void> => {
  const uploadReq = req as Request & { file?: { buffer: Buffer; mimetype: string; originalname: string } };
  const article = await findNewsArticle(req.params.id);
  if (!article) {
    res.status(404).json({ error: 'News article not found' });
    return;
  }
  if (!uploadReq.file) {
    res.status(400).json({ error: 'Featured image is required' });
    return;
  }
  try {
    const key = await saveMediaFile(
      {
        buffer: uploadReq.file.buffer,
        mimetype: uploadReq.file.mimetype,
        originalname: uploadReq.file.originalname,
      },
      'news'
    );
    const url = await buildMediaUrl(key);
    if (article.featured_image_key) {
      await deleteMediaKeys([article.featured_image_key]).catch(() => {});
    }
    await execute(
      'UPDATE news_articles SET featured_image_key = ?, featured_image_url = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
      [key, url, userRef(req), article.id]
    );
    const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
    const translations = await getNewsTranslations([article.id]);
    const requested = translations.find((item) => item.language_code === lang) || null;
    const source = translations.find((item) => item.language_code === DEFAULT_LANGUAGE) || null;
    const formatted = await formatNewsArticle((await findNewsArticle(article.id)) as NewsArticleRow, requested, lang, source, true);
    const summary = Object.fromEntries(translations.map((item) => [item.language_code, { status: item.status, published_at: item.published_at || null, slug: item.slug }]));
    res.json({ article: { ...formatted, translations_summary: summary } });
  } catch (err) {
    if (err instanceof MediaValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.delete('/news/:id', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const article = await findNewsArticle(req.params.id);
  if (!article) {
    res.status(404).json({ error: 'News article not found' });
    return;
  }
  if (article.featured_image_key) {
    await deleteMediaKeys([article.featured_image_key]).catch(() => {});
  }
  await execute('DELETE FROM news_articles WHERE id = ?', [article.id]);
  res.json({ success: true });
});

publicRouter.get('/home', async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  res.json(await getHomePayload(lang, false, false));
});

publicRouter.get('/news', async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  res.json(await buildNewsPayload(lang, false));
});

publicRouter.get('/news/:slug', async (req: Request, res: Response): Promise<void> => {
  const lang = normalizeLang(String(req.query.lang || DEFAULT_LANGUAGE));
  if (!requireSupportedLanguage(res, lang)) return;
  const slug = String(req.params.slug || '').trim();
  const requested = await queryOne<NewsArticleTranslationRow>(
    `SELECT * FROM news_article_translations
     WHERE language_code = ? AND slug = ? AND status = 'published'`,
    [lang, slug]
  );
  const fallback = lang === DEFAULT_LANGUAGE ? null : await queryOne<NewsArticleTranslationRow>(
    `SELECT * FROM news_article_translations
     WHERE language_code = ? AND slug = ? AND status = 'published'`,
    [DEFAULT_LANGUAGE, slug]
  );
  const resolved = requested || fallback;
  if (!resolved) {
    res.status(404).json({ error: 'News article not found' });
    return;
  }
  const base = await findNewsArticle(resolved.article_id);
  if (!base) {
    res.status(404).json({ error: 'News article not found' });
    return;
  }
  const source = await findNewsTranslation(base.id, DEFAULT_LANGUAGE);
  const article = await formatNewsArticle(base, resolved, lang, source, false);
  res.json({ article });
});

export { publicRouter };
export default router;
