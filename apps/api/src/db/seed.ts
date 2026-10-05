import bcrypt from 'bcryptjs';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES } from '../utils/languages';
import { flattenLocale, readStoredLocale } from '../utils/locales';
import { HOMEPAGE_LOCALE_SEEDS } from '../utils/homepageLocaleSeeds';
import { hasTextCorruption } from '../utils/textCorruption';

import { queryAll, queryOne, execute } from '../dbRuntime';

const BOOTSTRAP_ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const BOOTSTRAP_ADMIN_NAME = String(process.env.ADMIN_NAME || 'Bootstrap Admin').trim() || 'Bootstrap Admin';
const BOOTSTRAP_ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const HOMEPAGE_CMS_MIGRATION_ACTOR = 'system_locale_migration';
const CMS_HOMEPAGE_SECTION_KEYS = ['home.hero', 'home.how_it_works', 'home.stats', 'home.offline'] as const;
const SUSPICIOUS_TRANSLATION_TOKENS = ['Ã', 'Ð', 'Ñ', 'Ø', 'Ù', '\u001d', '\u001e', '\u0012', '\u0014'];

async function ensureSeedAdminUser(): Promise<void> {
  if (!BOOTSTRAP_ADMIN_EMAIL || !BOOTSTRAP_ADMIN_PASSWORD) return;
  if (BOOTSTRAP_ADMIN_PASSWORD.length < 10) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters when bootstrap admin seeding is enabled.');
  }

  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [BOOTSTRAP_ADMIN_EMAIL]);
  if (existing) return;

  const hash = await bcrypt.hash(BOOTSTRAP_ADMIN_PASSWORD, 12);
  const id = `user-seeded-admin-${Date.now()}`;
  await execute(
    `INSERT INTO users (id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, ?, 'admin', TRUE)`,
    [id, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, hash]
  );
}

function hasSuspiciousTranslationEncoding(value?: string | null): boolean {
  if (!value) return false;
  return SUSPICIOUS_TRANSLATION_TOKENS.some((token) => value.includes(token));
}

function normalizeLegacyHomepageLocaleValue(lang: string, key: string, value: string | undefined, englishValue: string): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (hasSuspiciousTranslationEncoding(trimmed)) return englishValue;
  if (hasTextCorruption(trimmed)) return englishValue;
  if (trimmed === englishValue) return null;
  return trimmed;
}

function containsCorruptedStoredContent(value: unknown): boolean {
  if (typeof value === 'string') return hasTextCorruption(value);
  if (Array.isArray(value)) return value.some((item) => containsCorruptedStoredContent(item));
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => containsCorruptedStoredContent(item));
  return false;
}

function localeValueToParagraphDocument(text: string) {
  return [{ type: 'paragraph', text }];
}

function removeNewsHeroCta(meta: any) {
  if (!meta || typeof meta !== 'object') return meta;
  if (!Array.isArray(meta.ctas)) return meta;
  const ctas = meta.ctas.filter((cta: any) => cta?.id !== 'news');
  return ctas.length === meta.ctas.length ? meta : { ...meta, ctas };
}

async function sanitizeStoredHomepageHeroCtas(): Promise<void> {
  const heroBase = await queryOne<{ id: string; meta_json: any }>('SELECT id, meta_json FROM site_content_entries WHERE key = ?', ['home.hero']);
  if (!heroBase) return;

  const nextBaseMeta = removeNewsHeroCta(heroBase.meta_json || {});
  if (JSON.stringify(nextBaseMeta) !== JSON.stringify(heroBase.meta_json || {})) {
    await execute('UPDATE site_content_entries SET meta_json = ?, updated_at = NOW() WHERE id = ?', [
      JSON.stringify(nextBaseMeta),
      heroBase.id,
    ]);
  }

  const translations = await queryAll<{ id: string; meta_json: any }>(
    'SELECT id, meta_json FROM site_content_entry_translations WHERE entry_id = ?',
    [heroBase.id]
  );

  for (const translation of translations) {
    const nextMeta = removeNewsHeroCta(translation.meta_json || {});
    if (JSON.stringify(nextMeta) === JSON.stringify(translation.meta_json || {})) continue;
    await execute('UPDATE site_content_entry_translations SET meta_json = ?, updated_at = NOW() WHERE id = ?', [
      JSON.stringify(nextMeta),
      translation.id,
    ]);
  }
}

async function migrateLegacyHomepageLocaleTranslations(): Promise<void> {
  const englishLocale = flattenLocale(readStoredLocale(DEFAULT_LANGUAGE));
  const baseRows = await queryAll<{ id: string; key: string; title: string; description: string | null; body: string | null; meta_json: any; content_revision: number }>(
    'SELECT id, key, title, description, body, meta_json, content_revision FROM site_content_entries WHERE key = ANY(?)',
    [Array.from(CMS_HOMEPAGE_SECTION_KEYS)]
  );
  const baseByKey = new Map(baseRows.map((row) => [row.key, row]));

  for (const lang of SUPPORTED_LANGUAGE_CODES) {
    if (lang === DEFAULT_LANGUAGE) continue;
    const localeFlat = {
      ...(HOMEPAGE_LOCALE_SEEDS[lang] || {}),
      ...flattenLocale(readStoredLocale(lang)),
    };

    const heroBase = baseByKey.get('home.hero');
    const howBase = baseByKey.get('home.how_it_works');
    const statsBase = baseByKey.get('home.stats');
    const offlineBase = baseByKey.get('home.offline');
    if (!heroBase || !howBase || !statsBase || !offlineBase) continue;

    const heroTranslation = await queryOne<any>('SELECT * FROM site_content_entry_translations WHERE entry_id = ? AND language_code = ?', [heroBase.id, lang]);
    const howTranslation = await queryOne<any>('SELECT * FROM site_content_entry_translations WHERE entry_id = ? AND language_code = ?', [howBase.id, lang]);
    const statsTranslation = await queryOne<any>('SELECT * FROM site_content_entry_translations WHERE entry_id = ? AND language_code = ?', [statsBase.id, lang]);
    const offlineTranslation = await queryOne<any>('SELECT * FROM site_content_entry_translations WHERE entry_id = ? AND language_code = ?', [offlineBase.id, lang]);

    const canOverwrite = (row?: {
      updated_by?: string | null;
      status?: string | null;
      title?: string | null;
      description?: string | null;
      body_document?: unknown;
      meta_json?: unknown;
    } | undefined) =>
      !row
      || !row.updated_by
      || row.updated_by === 'system_backfill'
      || row.updated_by === HOMEPAGE_CMS_MIGRATION_ACTOR
      || containsCorruptedStoredContent(row.title)
      || containsCorruptedStoredContent(row.description)
      || containsCorruptedStoredContent(row.body_document)
      || containsCorruptedStoredContent(row.meta_json);

    const heroTitle = normalizeLegacyHomepageLocaleValue(lang, 'home.hero_title', localeFlat['home.hero_title'], englishLocale['home.hero_title'] || heroBase.title);
    const heroSubtitle = normalizeLegacyHomepageLocaleValue(lang, 'home.hero_subtitle', localeFlat['home.hero_subtitle'], englishLocale['home.hero_subtitle'] || String(heroBase.description || ''));
    const heroSubmit = normalizeLegacyHomepageLocaleValue(lang, 'home.btn_submit', localeFlat['home.btn_submit'], englishLocale['home.btn_submit'] || 'Submit a Report');
    const heroMap = normalizeLegacyHomepageLocaleValue(lang, 'home.btn_map', localeFlat['home.btn_map'], englishLocale['home.btn_map'] || 'View Crisis Map');
    if (canOverwrite(heroTranslation) && (heroTitle || heroSubtitle || heroSubmit || heroMap)) {
      const heroMeta = JSON.parse(JSON.stringify(heroTranslation?.meta_json || heroBase.meta_json || {}));
      if (Array.isArray(heroMeta.ctas)) {
        heroMeta.ctas = heroMeta.ctas.map((cta: any) => {
          if (cta?.id === 'submit' && heroSubmit) return { ...cta, label: heroSubmit };
          if (cta?.id === 'map' && heroMap) return { ...cta, label: heroMap };
          return cta;
        }).filter((cta: any) => cta?.id !== 'news');
      }
      const translationId = heroTranslation?.id || `migrate_${heroBase.id}_${lang}`;
      await execute(
        `INSERT INTO site_content_entry_translations
         (id, entry_id, language_code, title, description, body_document, meta_json, status, published_at, source_version, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON CONFLICT (entry_id, language_code)
         DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          meta_json = EXCLUDED.meta_json,
          source_version = EXCLUDED.source_version,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()`,
        [
          translationId,
          heroBase.id,
          lang,
          heroTitle || heroTranslation?.title || heroBase.title,
          heroSubtitle || heroTranslation?.description || heroBase.description || '',
          JSON.stringify(heroTranslation?.body_document || []),
          JSON.stringify(heroMeta),
          heroTranslation?.status || 'draft',
          heroTranslation?.published_at || null,
          Number(heroBase.content_revision || 1),
          HOMEPAGE_CMS_MIGRATION_ACTOR,
        ]
      );
    }

    const howTitle = normalizeLegacyHomepageLocaleValue(lang, 'home.how_it_works', localeFlat['home.how_it_works'], englishLocale['home.how_it_works'] || howBase.title);
    const howSubtitle = normalizeLegacyHomepageLocaleValue(lang, 'home.how_subtitle', localeFlat['home.how_subtitle'], englishLocale['home.how_subtitle'] || String(howBase.description || ''));
    if (canOverwrite(howTranslation)) {
      const howMeta = JSON.parse(JSON.stringify(howTranslation?.meta_json || howBase.meta_json || {}));
      const steps = Array.isArray(howMeta.steps) ? howMeta.steps : [];
      let howChanged = Boolean(howTitle || howSubtitle);
      for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
        const titleKey = `home.step${stepIndex + 1}_title`;
        const nextTitle = normalizeLegacyHomepageLocaleValue(lang, titleKey, localeFlat[titleKey], englishLocale[titleKey] || '');
        if (nextTitle) {
          steps[stepIndex] = { ...steps[stepIndex], title: nextTitle };
          howChanged = true;
        }
        const bullets = Array.isArray(steps[stepIndex]?.bullets) ? [...steps[stepIndex].bullets] : [];
        for (let bulletIndex = 0; bulletIndex < bullets.length; bulletIndex += 1) {
          const bulletKey = `home.step${stepIndex + 1}_point${bulletIndex + 1}`;
          const nextBullet = normalizeLegacyHomepageLocaleValue(lang, bulletKey, localeFlat[bulletKey], englishLocale[bulletKey] || '');
          if (nextBullet) {
            bullets[bulletIndex] = nextBullet;
            howChanged = true;
          }
        }
        steps[stepIndex] = { ...steps[stepIndex], bullets };
      }
      howMeta.steps = steps;
      if (howChanged) {
        const translationId = howTranslation?.id || `migrate_${howBase.id}_${lang}`;
        await execute(
          `INSERT INTO site_content_entry_translations
           (id, entry_id, language_code, title, description, body_document, meta_json, status, published_at, source_version, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON CONFLICT (entry_id, language_code)
           DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            meta_json = EXCLUDED.meta_json,
            source_version = EXCLUDED.source_version,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()`,
          [
            translationId,
            howBase.id,
            lang,
            howTitle || howTranslation?.title || howBase.title,
            howSubtitle || howTranslation?.description || howBase.description || '',
            JSON.stringify(howTranslation?.body_document || []),
            JSON.stringify(howMeta),
            howTranslation?.status || 'draft',
            howTranslation?.published_at || null,
            Number(howBase.content_revision || 1),
            HOMEPAGE_CMS_MIGRATION_ACTOR,
          ]
        );
      }
    }

    if (canOverwrite(statsTranslation)) {
      const statsMeta = JSON.parse(JSON.stringify(statsTranslation?.meta_json || statsBase.meta_json || {}));
      const items = Array.isArray(statsMeta.items) ? statsMeta.items : [];
      let statsChanged = false;
      for (const item of items) {
        if (!item?.id) continue;
        const labelKey = `home.stats_${item.id}`;
        const valueKey = `home.stats_${item.id}_val`;
        const nextLabel = normalizeLegacyHomepageLocaleValue(lang, labelKey, localeFlat[labelKey], englishLocale[labelKey] || '');
        const nextValue = normalizeLegacyHomepageLocaleValue(lang, valueKey, localeFlat[valueKey], englishLocale[valueKey] || '');
        if (nextLabel) {
          item.label = nextLabel;
          statsChanged = true;
        }
        if (nextValue) {
          item.value = nextValue;
          statsChanged = true;
        }
      }
      if (statsChanged) {
        const translationId = statsTranslation?.id || `migrate_${statsBase.id}_${lang}`;
        await execute(
          `INSERT INTO site_content_entry_translations
           (id, entry_id, language_code, title, description, body_document, meta_json, status, published_at, source_version, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON CONFLICT (entry_id, language_code)
           DO UPDATE SET
            meta_json = EXCLUDED.meta_json,
            source_version = EXCLUDED.source_version,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()`,
          [
            translationId,
            statsBase.id,
            lang,
            statsTranslation?.title || statsBase.title,
            statsTranslation?.description || statsBase.description || '',
            JSON.stringify(statsTranslation?.body_document || []),
            JSON.stringify(statsMeta),
            statsTranslation?.status || 'draft',
            statsTranslation?.published_at || null,
            Number(statsBase.content_revision || 1),
            HOMEPAGE_CMS_MIGRATION_ACTOR,
          ]
        );
      }
    }

    const offlineTitle = normalizeLegacyHomepageLocaleValue(lang, 'home.offline_title', localeFlat['home.offline_title'], englishLocale['home.offline_title'] || offlineBase.title);
    const offlineDesc = normalizeLegacyHomepageLocaleValue(lang, 'home.offline_desc', localeFlat['home.offline_desc'], englishLocale['home.offline_desc'] || String(offlineBase.body || ''));
    if (canOverwrite(offlineTranslation) && (offlineTitle || offlineDesc)) {
      const translationId = offlineTranslation?.id || `migrate_${offlineBase.id}_${lang}`;
      await execute(
        `INSERT INTO site_content_entry_translations
         (id, entry_id, language_code, title, description, body_document, meta_json, status, published_at, source_version, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON CONFLICT (entry_id, language_code)
         DO UPDATE SET
          title = EXCLUDED.title,
          body_document = EXCLUDED.body_document,
          source_version = EXCLUDED.source_version,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()`,
        [
          translationId,
          offlineBase.id,
          lang,
          offlineTitle || offlineTranslation?.title || offlineBase.title,
          offlineTranslation?.description || offlineBase.description || '',
          JSON.stringify(offlineDesc ? localeValueToParagraphDocument(offlineDesc) : (offlineTranslation?.body_document || [])),
          JSON.stringify(offlineTranslation?.meta_json || offlineBase.meta_json || {}),
          offlineTranslation?.status || 'draft',
          offlineTranslation?.published_at || null,
          Number(offlineBase.content_revision || 1),
          HOMEPAGE_CMS_MIGRATION_ACTOR,
        ]
      );
    }
  }
}

export async function seedRuntimeData(): Promise<void> {
  const heroMeta = {
    ctas: [
      { id: 'submit', label: 'Submit a Report', href: '/submit', variant: 'primary', enabled: true, sort_order: 1 },
      { id: 'map', label: 'View Crisis Map', href: '/map', variant: 'secondary', enabled: true, sort_order: 2 },
    ],
  };
  const howMeta = {
    steps: [
      {
        id: 'step-1',
        title: 'Find the location',
        bullets: [
          'Use your location to find the area',
          'Mark where the damage happened',
          'If GPS fails, describe the place nearby',
        ],
        icon: 'location',
      },
      {
        id: 'step-2',
        title: 'Add photos and details',
        bullets: [
          'Take or upload photos of the damage',
          'Write a short description',
          'Save the report offline if needed',
        ],
        icon: 'upload',
      },
      {
        id: 'step-3',
        title: 'Review and send',
        bullets: [
          'Choose the damage level',
          'Check the location and photos',
          'Send now or upload later',
        ],
        icon: 'review',
      },
    ],
  };
  const statsMeta = {
    items: [
      { id: 'reports', label: 'Reports Filed', value: '50K+', icon: 'users' },
      { id: 'response', label: 'Avg Response Time', value: '< 2hr', icon: 'clock' },
      { id: 'anonymous', label: 'Anonymous Option', value: '100%', icon: 'shield' },
    ],
  };
  const emptyBlocks = JSON.stringify([] as unknown[]);
  const textToParagraphBlocks = (text: string) => JSON.stringify(
    String(text || '').trim()
      ? [{ type: 'paragraph', text: String(text || '').trim() }]
      : []
  );

  await execute(
    `INSERT INTO site_content_entries
      (id, key, title, description, body, meta_json, is_enabled, sort_order, is_system)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO NOTHING`,
    [
      'content_home_hero',
      'home.hero',
      'Report Crisis Damage\nin Your Community',
      'Help UNDP and humanitarian organizations respond faster by sharing what you see on the ground. Your report matters.',
      '',
      JSON.stringify(heroMeta),
      true,
      1,
      true,
    ]
  );

  await execute(
    `INSERT INTO site_content_entries
      (id, key, title, description, body, meta_json, is_enabled, sort_order, is_system)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO NOTHING`,
    [
      'content_home_how',
      'home.how_it_works',
      'How It Works',
      'Three simple steps to report damage',
      'Use GPS or the map to mark the location, upload up to 5 photos, then classify and submit the damage report.',
      JSON.stringify(howMeta),
      true,
      2,
      true,
    ]
  );

  await execute(
    `INSERT INTO site_content_entries
      (id, key, title, description, body, meta_json, is_enabled, sort_order, is_system)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO NOTHING`,
    [
      'content_home_stats',
      'home.stats',
      'Operational Reach',
      'High-level indicators used on the public home page.',
      '',
      JSON.stringify(statsMeta),
      true,
      3,
      false,
    ]
  );

  await execute(
    `INSERT INTO site_content_entries
      (id, key, title, description, body, meta_json, is_enabled, sort_order, is_system)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO NOTHING`,
    [
      'content_home_offline',
      'home.offline',
      'No connection? No problem.',
      '',
      'Reports can be stored locally in this browser on this device and submitted when connectivity returns. In supported browsers, sync may continue in the background; otherwise it resumes when you reopen the site.',
      JSON.stringify({}),
      true,
      4,
      false,
    ]
  );

  await execute(
    `INSERT INTO site_content_entry_translations
      (id, entry_id, language_code, title, description, body_document, meta_json, status, published_at, source_version, updated_by)
     SELECT
      'sct_' || id || '_' || ?,
      id,
      ?,
      title,
      COALESCE(description, ''),
      CASE
        WHEN COALESCE(trim(body), '') = '' THEN ?::jsonb
        ELSE ?::jsonb
      END,
      meta_json,
      'published',
      COALESCE(updated_at, created_at, NOW()),
      content_revision,
      'system_backfill'
     FROM site_content_entries
     ON CONFLICT (entry_id, language_code) DO NOTHING`,
    [DEFAULT_LANGUAGE, DEFAULT_LANGUAGE, emptyBlocks, textToParagraphBlocks('placeholder')]
  );

  await execute(
    `UPDATE site_content_entry_translations tr
     SET body_document = CASE
       WHEN COALESCE(trim(base.body), '') = '' THEN ?::jsonb
       ELSE jsonb_build_array(jsonb_build_object('type', 'paragraph', 'text', base.body))
     END,
     title = base.title,
     description = COALESCE(base.description, ''),
     meta_json = base.meta_json,
     source_version = base.content_revision
     FROM site_content_entries base
     WHERE tr.entry_id = base.id
       AND tr.language_code = ?`,
    [emptyBlocks, DEFAULT_LANGUAGE]
  );

  await execute(
    `UPDATE site_content_entries
     SET meta_json = ?::jsonb, updated_at = NOW()
     WHERE key = 'home.how_it_works'
       AND (meta_json IS NULL OR meta_json = '{}'::jsonb OR COALESCE(jsonb_typeof(meta_json->'steps'), '') <> 'array')`,
    [JSON.stringify(howMeta)]
  );

  await execute(
    `UPDATE site_content_entry_translations tr
     SET meta_json = ?::jsonb, updated_at = NOW()
     FROM site_content_entries base
     WHERE tr.entry_id = base.id
       AND base.key = 'home.how_it_works'
       AND tr.language_code = ?
       AND (tr.meta_json IS NULL OR tr.meta_json = '{}'::jsonb OR COALESCE(jsonb_typeof(tr.meta_json->'steps'), '') <> 'array')`,
    [JSON.stringify(howMeta), DEFAULT_LANGUAGE]
  );

  await execute(
    `INSERT INTO news_article_translations
      (id, article_id, language_code, slug, title, excerpt, body_document, seo_title, seo_description, status, published_at, source_version, updated_by)
     SELECT
      'nat_' || id || '_' || ?,
      id,
      ?,
      slug,
      title,
      COALESCE(excerpt, ''),
      CASE
        WHEN COALESCE(trim(body), '') = '' THEN ?::jsonb
        ELSE jsonb_build_array(jsonb_build_object('type', 'paragraph', 'text', body))
      END,
      title,
      COALESCE(excerpt, ''),
      CASE WHEN status = 'published' THEN 'published' ELSE 'draft' END,
      published_at,
      content_revision,
      COALESCE(updated_by, created_by, 'system_backfill')
     FROM news_articles
     ON CONFLICT (article_id, language_code) DO NOTHING`,
    [DEFAULT_LANGUAGE, DEFAULT_LANGUAGE, emptyBlocks]
  );

  await sanitizeStoredHomepageHeroCtas();
  await migrateLegacyHomepageLocaleTranslations();

  await ensureSeedAdminUser();
}
