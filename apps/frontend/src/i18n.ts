import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, getLanguageMeta } from './config/languages';

let localeResourceVersion = Date.now();

export function bumpI18nResourceVersion() {
  localeResourceVersion = Date.now();
}

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGE_CODES,
    defaultNS: 'translation',
    ns: ['translation'],

    backend: {
      loadPath: (lngs: string[], namespaces: string[]) => `/locales/${lngs[0]}/${namespaces[0]}.json?v=${localeResourceVersion}`,
    },

    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'undp_language',
    },

    interpolation: {
      escapeValue: false,
    },

    react: {
      useSuspense: true,
    },
  });

i18n.on('languageChanged', (lang) => {
  const meta = getLanguageMeta(lang);
  document.documentElement.lang = meta.code;
  document.documentElement.dir = meta.dir;
});

export default i18n;
