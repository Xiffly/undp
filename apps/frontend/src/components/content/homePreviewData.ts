import type { TFunction } from 'i18next';
import type { HomeCta, SiteContentEntry } from '../../types';

export type HomeContentMap = Record<string, SiteContentEntry>;
type HomeHowStep = {
  id: string;
  title: string;
  bullets: string[];
  icon: 'location' | 'upload' | 'review';
};

function defaultHomeSections(t: TFunction): HomeContentMap {
  return {
    'home.hero': {
      id: 'fallback-hero',
      key: 'home.hero',
      title: t('public_home.hero.title', { defaultValue: 'Report Crisis Damage\nin Your Community' }),
      description: t('public_home.hero.description', { defaultValue: 'Help UNDP and humanitarian organizations respond faster by sharing what you see on the ground. Your report matters.' }),
      body_document: [],
      meta_json: {
        ctas: [
          { id: 'submit', label: t('public_home.hero.cta_submit', { defaultValue: 'Submit a Report' }), href: '/submit', variant: 'primary', enabled: true, sort_order: 1 },
          { id: 'map', label: t('public_home.hero.cta_map', { defaultValue: 'View Crisis Map' }), href: '/map', variant: 'secondary', enabled: true, sort_order: 2 },
        ],
        presentation: { section_label: t('admin.content_manager.section_hero', { defaultValue: 'Hero' }), background_variant_token: 'hero', padding_token: 'spacious', container_width_token: 'default' },
      },
      is_enabled: true,
      sort_order: 1,
      is_system: true,
      content_revision: 1,
      requested_lang: 'en',
      resolved_lang: 'en',
      fallback: false,
      translation_status: 'published',
      is_stale: false,
      source: null,
      translation: null,
    },
    'home.how_it_works': {
      id: 'fallback-how',
      key: 'home.how_it_works',
      title: t('public_home.how_it_works.title', { defaultValue: 'How It Works' }),
      description: t('public_home.how_it_works.description', { defaultValue: 'Three simple steps to report damage' }),
      body_document: [],
      meta_json: {
        steps: [
          {
            id: 'step-1',
            title: t('public_home.how_it_works.step_1.title', { defaultValue: 'Find the location' }),
            bullets: [
              t('public_home.how_it_works.step_1.bullet_1', { defaultValue: 'Use your location to find the area' }),
              t('public_home.how_it_works.step_1.bullet_2', { defaultValue: 'Mark where the damage happened' }),
              t('public_home.how_it_works.step_1.bullet_3', { defaultValue: 'If GPS fails, describe the place nearby' }),
            ],
            icon: 'location',
          },
          {
            id: 'step-2',
            title: t('public_home.how_it_works.step_2.title', { defaultValue: 'Add photos and details' }),
            bullets: [
              t('public_home.how_it_works.step_2.bullet_1', { defaultValue: 'Take or upload photos of the damage' }),
              t('public_home.how_it_works.step_2.bullet_2', { defaultValue: 'Write a short description' }),
              t('public_home.how_it_works.step_2.bullet_3', { defaultValue: 'Save the report offline if needed' }),
            ],
            icon: 'upload',
          },
          {
            id: 'step-3',
            title: t('public_home.how_it_works.step_3.title', { defaultValue: 'Review and send' }),
            bullets: [
              t('public_home.how_it_works.step_3.bullet_1', { defaultValue: 'Choose the damage level' }),
              t('public_home.how_it_works.step_3.bullet_2', { defaultValue: 'Check the location and photos' }),
              t('public_home.how_it_works.step_3.bullet_3', { defaultValue: 'Send now or upload later' }),
            ],
            icon: 'review',
          },
        ],
        presentation: { section_label: t('admin.content_manager.section_how_it_works', { defaultValue: 'How It Works' }), background_variant_token: 'default', padding_token: 'normal', container_width_token: 'wide' },
      },
      is_enabled: true,
      sort_order: 2,
      is_system: true,
      content_revision: 1,
      requested_lang: 'en',
      resolved_lang: 'en',
      fallback: false,
      translation_status: 'published',
      is_stale: false,
      source: null,
      translation: null,
    },
    'home.stats': {
      id: 'fallback-stats',
      key: 'home.stats',
      title: t('public_home.stats.title', { defaultValue: 'Operational Reach' }),
      description: t('public_home.stats.description', { defaultValue: 'High-level indicators used on the public home page.' }),
      body_document: [],
      meta_json: {
        items: [
          { id: 'reports', label: t('public_home.stats.item_reports_label', { defaultValue: 'Reports Filed' }), value: '50K+', icon: 'users' },
          { id: 'response', label: t('public_home.stats.item_response_label', { defaultValue: 'Avg Response Time' }), value: '< 2hr', icon: 'clock' },
          { id: 'anonymous', label: t('public_home.stats.item_anonymous_label', { defaultValue: 'Anonymous Option' }), value: '100%', icon: 'shield' },
        ],
        presentation: { section_label: t('admin.content_manager.section_stats', { defaultValue: 'Stats' }), background_variant_token: 'default', padding_token: 'normal', container_width_token: 'default' },
      },
      is_enabled: true,
      sort_order: 3,
      is_system: false,
      content_revision: 1,
      requested_lang: 'en',
      resolved_lang: 'en',
      fallback: false,
      translation_status: 'published',
      is_stale: false,
      source: null,
      translation: null,
    },
    'home.offline': {
      id: 'fallback-offline',
      key: 'home.offline',
      title: t('public_home.offline.title', { defaultValue: 'No connection? No problem.' }),
      description: '',
      body_document: [{
        type: 'paragraph',
        content: [{ text: t('public_home.offline.body', { defaultValue: 'Reports can be stored locally in this browser on this device and submitted when connectivity returns. In supported browsers, sync may continue in the background; otherwise it resumes when you reopen the site.' }) }],
        style: { font_size_token: 'sm' },
      }],
      meta_json: { presentation: { section_label: t('admin.content_manager.section_offline', { defaultValue: 'Offline Support' }), background_variant_token: 'subtle', padding_token: 'normal', container_width_token: 'default' } },
      is_enabled: true,
      sort_order: 4,
      is_system: false,
      content_revision: 1,
      requested_lang: 'en',
      resolved_lang: 'en',
      fallback: false,
      translation_status: 'published',
      is_stale: false,
      source: null,
      translation: null,
    },
  };
}

function getHowSteps(section?: SiteContentEntry): HomeHowStep[] {
  const raw = section?.meta_json?.steps;
  if (!Array.isArray(raw)) return [];
  return (raw as HomeHowStep[]).filter((step) => step && step.title && Array.isArray(step.bullets));
}

function getEnabledCtas(hero?: SiteContentEntry): HomeCta[] {
  const raw = hero?.meta_json?.ctas;
  if (!Array.isArray(raw)) return [];
  return (raw as HomeCta[])
    .filter((cta) => cta?.enabled && cta?.id !== 'news')
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function buildHomeContentMap(sections: SiteContentEntry[], t: TFunction): HomeContentMap {
  const next = { ...defaultHomeSections(t) };
  for (const section of sections || []) next[section.key] = section;
  return next;
}

export function getDefaultHomeContentMap(t: TFunction): HomeContentMap {
  return defaultHomeSections(t);
}

export function getPreviewHeroCtas(hero: SiteContentEntry | undefined, t: TFunction): HomeCta[] {
  const ctas = getEnabledCtas(hero);
  return ctas.length ? ctas : getEnabledCtas(defaultHomeSections(t)['home.hero']);
}

export function getPreviewHowSteps(how: SiteContentEntry | undefined, t: TFunction): HomeHowStep[] {
  const steps = getHowSteps(how);
  return steps.length ? steps : getHowSteps(defaultHomeSections(t)['home.how_it_works']);
}
