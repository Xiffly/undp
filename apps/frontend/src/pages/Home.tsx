import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import HomePagePreview from '../components/content/HomePagePreview';
import { buildHomeContentMap, getDefaultHomeContentMap } from '../components/content/homePreviewData';
import type { HomeContentMap } from '../components/content/homePreviewData';
import { useSeo } from '../seo/useSeo';

export default function Home() {
  const { i18n, t } = useTranslation();
  const [contentMap, setContentMap] = useState<HomeContentMap>(() => getDefaultHomeContentMap(t));

  useSeo({
    title: t('home.meta_title', { defaultValue: 'Community Crisis Reporting' }),
    description: t('home.meta_description', {
      defaultValue: 'Community crisis reporting, verified field updates, and response coordination in one platform.',
    }),
    canonicalPath: '/',
  });

  useEffect(() => {
    let active = true;
    api.getPublicHomeContent()
      .then((data) => {
        if (!active) return;
        setContentMap(buildHomeContentMap(data.sections || [], t));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [i18n.resolvedLanguage, t]);

  return <HomePagePreview contentMap={contentMap} />;
}
