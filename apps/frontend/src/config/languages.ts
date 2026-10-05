import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './supportedLanguages';

export { SUPPORTED_LANGUAGES };
export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((lang) => lang.code);
export const DEFAULT_LANGUAGE = SUPPORTED_LANGUAGES.find((lang) => lang.master)?.code || 'en';

export function getLanguageMeta(code?: string | null): SupportedLanguage {
  const normalized = String(code || '').toLowerCase();
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === normalized || normalized.startsWith(`${lang.code}-`))
    || SUPPORTED_LANGUAGES[0];
}
