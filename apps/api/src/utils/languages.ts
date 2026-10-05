import fs from 'fs';
import path from 'path';

export type SupportedLanguage = {
  code: string;
  label: string;
  nativeLabel: string;
  flag: string;
  dir: 'ltr' | 'rtl';
  master: boolean;
};

const LANGUAGES_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'shared', 'supported-languages.json');

function loadLanguages(): SupportedLanguage[] {
  const raw = fs.readFileSync(LANGUAGES_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('supported-languages.json is empty or invalid');
  }
  return parsed as SupportedLanguage[];
}

export const SUPPORTED_LANGUAGES = loadLanguages();
export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((lang) => lang.code);
export const DEFAULT_LANGUAGE = SUPPORTED_LANGUAGES.find((lang) => lang.master)?.code || 'en';

export function isSupportedLanguage(code?: string | null): boolean {
  return SUPPORTED_LANGUAGE_CODES.includes(String(code || '').toLowerCase());
}
