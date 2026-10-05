import React, { useMemo } from 'react';
import { CheckCircle, CheckCircle2, Clock, Map, MapPin, Shield, Upload, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import BlockRenderer from './BlockRenderer';
import { normalizePresentation } from './contentSchema';
import { getDefaultHomeContentMap, getPreviewHeroCtas, getPreviewHowSteps } from './homePreviewData';
import type { HomeContentMap } from './homePreviewData';

function isExternalHref(href: string) {
  return /^(https?:)?\/\//i.test(href) || /^(mailto|tel):/i.test(href);
}

function normalizeHref(rawHref?: string | null) {
  const href = String(rawHref || '').trim();
  if (!href) return '';
  if (isExternalHref(href) || href.startsWith('/') || href.startsWith('#')) return href;
  return `/${href.replace(/^\.?\//, '')}`;
}

export default function HomePagePreview({
  contentMap,
  interactive = false,
  selectedKey,
  onSelectSection,
  showBadges = false,
  liveMap,
}: {
  contentMap: HomeContentMap;
  interactive?: boolean;
  selectedKey?: string;
  onSelectSection?: (key: string) => void;
  showBadges?: boolean;
  liveMap?: HomeContentMap | null;
}) {
  const { t } = useTranslation();
  const hero = contentMap['home.hero'];
  const how = contentMap['home.how_it_works'];
  const stats = contentMap['home.stats'];
  const offline = contentMap['home.offline'];
  const defaultSections = useMemo(() => getDefaultHomeContentMap(t), [t]);
  const sectionLabels = useMemo(() => ({
    'home.hero': t('admin.content_manager.section_hero', { defaultValue: 'Hero' }),
    'home.how_it_works': t('admin.content_manager.section_how_it_works', { defaultValue: 'How It Works' }),
    'home.stats': t('admin.content_manager.section_stats', { defaultValue: 'Stats' }),
    'home.offline': t('admin.content_manager.section_offline', { defaultValue: 'Offline Support' }),
  }), [t]);
  const heroCtas = useMemo(() => getPreviewHeroCtas(hero, t), [hero, t]);
  const heroPresentation = useMemo(() => normalizePresentation(hero?.meta_json || {}), [hero]);
  const statItems = Array.isArray(stats?.meta_json?.items) ? stats.meta_json.items as Array<Record<string, string>> : [];
  const howSteps = useMemo(() => getPreviewHowSteps(how, t), [how, t]);

  function sectionBadge(key: string) {
    if (!showBadges) return null;
    const liveSection = liveMap?.[key];
    const currentSection = contentMap[key];
    const changed = JSON.stringify(currentSection) !== JSON.stringify(liveSection);
    return (
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full bg-black/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-current">{sectionLabels[key] || key}</span>
        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${changed ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
          {changed
            ? t('admin.content_preview.changed_since_live', { defaultValue: 'Changed since live' })
            : t('admin.content_preview.published_live', { defaultValue: 'Published live' })}
        </span>
      </div>
    );
  }

  function containerClasses(key: string, extra = '') {
    const isSelected = interactive && selectedKey === key;
    return `${interactive ? 'cursor-pointer transition-all hover:ring-2 hover:ring-un-blue/40' : ''} ${isSelected ? 'ring-2 ring-un-blue shadow-lg' : ''} ${extra}`.trim();
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
      <div className="min-h-screen bg-gradient-to-b from-un-dark via-un-blue to-blue-400">
        <div className={`mx-auto px-4 pb-16 pt-12 text-center text-white ${heroPresentation.container_width_token === 'wide' ? 'max-w-5xl' : 'max-w-3xl'}`} onClick={() => onSelectSection?.('home.hero')}>
          {sectionBadge('home.hero')}
          <div className={containerClasses('home.hero')}>
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
              <MapPin size={32} />
            </div>
            <h1 className="mb-4 whitespace-pre-line text-3xl font-bold leading-tight md:text-4xl">{hero?.title || defaultSections['home.hero'].title}</h1>
            {heroPresentation.subheading && <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-blue-100">{heroPresentation.subheading}</p>}
            <p className="mb-3 text-lg leading-relaxed text-blue-100">{hero?.description || defaultSections['home.hero'].description}</p>
            {(hero?.body_document || []).length > 0 && <BlockRenderer blocks={hero?.body_document || []} className="mx-auto mb-8 max-w-2xl text-blue-50" />}
            <div className="flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
              {heroCtas.map((cta) => {
                const isPrimary = cta.variant === 'primary';
                const icon = cta.href === '/submit' ? <Upload size={20} /> : cta.href === '/map' ? <Map size={20} /> : null;
                const href = normalizeHref(cta.href);
                const className = `flex items-center justify-center gap-2 rounded-xl px-8 py-4 text-lg shadow-lg ${isPrimary ? 'bg-white font-bold text-un-dark' : 'bg-white/20 font-semibold text-white backdrop-blur'}`;

                if (!href) return null;

                if (interactive) {
                  return (
                    <span key={cta.id} className={className}>
                      {icon} {cta.label}
                    </span>
                  );
                }

                if (isExternalHref(href)) {
                  return (
                    <a
                      key={cta.id}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className={className}
                    >
                      {icon} {cta.label}
                    </a>
                  );
                }

                return (
                  <Link
                    key={cta.id}
                    to={href}
                    className={className}
                  >
                    {icon} {cta.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-t-3xl bg-white px-4 py-10">
          <div className="mx-auto max-w-4xl">
            {how?.is_enabled !== false && (
              <div onClick={() => onSelectSection?.('home.how_it_works')} className={containerClasses('home.how_it_works', 'rounded-3xl p-2')}>
                {sectionBadge('home.how_it_works')}
                <h2 className="mb-2 text-center text-2xl font-bold text-un-dark">{how?.title || defaultSections['home.how_it_works'].title}</h2>
                <p className="mb-3 text-center text-gray-500">{how?.description || defaultSections['home.how_it_works'].description}</p>
                <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-3">
                  {howSteps.map((step, index) => {
                    const Icon = step.icon === 'upload' ? Upload : step.icon === 'review' ? CheckCircle : MapPin;
                    const color = step.icon === 'upload' ? 'bg-orange-100 text-orange-600' : step.icon === 'review' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-un-blue';
                    return (
                      <div key={step.id} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                        <div className={`relative mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${color}`}>
                          <Icon size={24} />
                          <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-un-dark text-xs font-bold text-white">{String(index + 1)}</span>
                        </div>
                        <h3 className="mb-3 text-center font-semibold text-gray-900">{step.title}</h3>
                        <ul className="space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600">
                          {step.bullets.map((bullet, bulletIndex) => (
                            <li key={`${step.id}-${bulletIndex}`} className="flex items-start gap-2 text-left leading-relaxed">
                              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-un-blue" />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {stats?.is_enabled !== false && (
              <div onClick={() => onSelectSection?.('home.stats')} className={containerClasses('home.stats', 'rounded-3xl p-2')}>
                {sectionBadge('home.stats')}
                <div className="mb-10">
                  {!!stats?.title && <h3 className="mb-2 text-center text-xl font-bold text-gray-900">{stats.title}</h3>}
                  {!!stats?.description && <p className="mb-6 text-center text-sm text-gray-500">{stats.description}</p>}
                  <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
                    {(statItems.length ? statItems : defaultSections['home.stats'].meta_json.items as Array<Record<string, string>>).map((item) => {
                      const Icon = item.icon === 'clock' ? Clock : item.icon === 'shield' ? Shield : Users;
                      const color = item.icon === 'clock' ? 'text-orange-500' : item.icon === 'shield' ? 'text-green-500' : 'text-un-blue';
                      return (
                        <div key={item.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                          <Icon size={24} className={`${color} mx-auto mb-1`} />
                          <div className="text-xl font-bold text-gray-900">{item.value}</div>
                          <div className="text-xs text-gray-500">{item.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {offline?.is_enabled !== false && (
              <div onClick={() => onSelectSection?.('home.offline')} className={containerClasses('home.offline', 'rounded-3xl p-2')}>
                {sectionBadge('home.offline')}
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center">
                  <h3 className="mb-3 text-lg font-bold text-gray-900">{offline?.title || defaultSections['home.offline'].title}</h3>
                  <div className="text-sm text-gray-600">
                    <BlockRenderer blocks={offline?.body_document || []} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="h-20 bg-white md:h-0" />
      </div>
    </div>
  );
}
