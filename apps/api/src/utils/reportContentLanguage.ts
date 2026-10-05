import { DEFAULT_LANGUAGE, isSupportedLanguage } from './languages';
import { hasTextCorruption } from './textCorruption';

export const TRANSLATABLE_FIELDS = ['description', 'address_text', 'infra_name'] as const;
export type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number];
export type TranslationStatus = 'not_needed' | 'pending' | 'completed' | 'failed';

type TranslationRowLike = {
  target_lang: string;
  field_name: string;
  translated_text: string;
};

const ARABIC_RE = /[\u0600-\u06FF]/;
const CYRILLIC_RE = /[\u0400-\u04FF]/;
const HAN_RE = /[\u3400-\u9FFF]/;

const EN_HINTS = ['the', 'and', 'near', 'building', 'damage', 'road', 'school', 'market', 'house'];
const FR_HINTS = ['le', 'la', 'les', 'des', 'avec', 'pour', 'pres', 'ecole', 'batiment', 'degats'];
const ES_HINTS = ['el', 'la', 'los', 'las', 'con', 'para', 'cerca', 'escuela', 'edificio', 'danos'];
const TRANSLATION_REFUSAL_PATTERNS = [
  /(^|\n)\s*User Safety:/i,
  /(^|\n)\s*Safety Categories:/i,
];

export function hasInvalidTranslationText(value: unknown): boolean {
  if (hasTextCorruption(value)) return true;
  const text = String(value || '').trim();
  if (!text) return false;
  return TRANSLATION_REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function normalizeLanguageCode(value?: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (isSupportedLanguage(normalized)) return normalized;
  const short = normalized.split('-')[0];
  return isSupportedLanguage(short) ? short : null;
}

function countHints(text: string, hints: string[]): number {
  const normalized = ` ${text.toLowerCase()} `;
  return hints.reduce((sum, hint) => sum + (normalized.includes(` ${hint} `) ? 1 : 0), 0);
}

export function detectSourceLanguage(fields: string[], hint?: unknown): { language: string; confidence: number } {
  const combined = fields.join(' ').trim();
  if (!combined) {
    const hinted = normalizeLanguageCode(hint);
    return { language: hinted || DEFAULT_LANGUAGE, confidence: hinted ? 0.55 : 0.35 };
  }

  if (ARABIC_RE.test(combined)) return { language: 'ar', confidence: 0.99 };
  if (CYRILLIC_RE.test(combined)) return { language: 'ru', confidence: 0.99 };
  if (HAN_RE.test(combined)) return { language: 'zh', confidence: 0.99 };

  const hinted = normalizeLanguageCode(hint);
  const scores = {
    en: countHints(combined, EN_HINTS),
    fr: countHints(combined, FR_HINTS),
    es: countHints(combined, ES_HINTS),
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 2) {
    return { language: best[0], confidence: 0.78 };
  }

  if (hinted) return { language: hinted, confidence: 0.62 };
  return { language: DEFAULT_LANGUAGE, confidence: 0.4 };
}

export function buildTranslationsObject(rows: TranslationRowLike[]): Record<string, Partial<Record<TranslatableField, string>>> {
  return rows.reduce<Record<string, Partial<Record<TranslatableField, string>>>>((acc, row) => {
    const targetLang = normalizeLanguageCode(row.target_lang);
    if (!targetLang) return acc;
    if (!TRANSLATABLE_FIELDS.includes(row.field_name as TranslatableField)) return acc;
    if (hasInvalidTranslationText(row.translated_text)) return acc;
    if (!acc[targetLang]) acc[targetLang] = {};
    acc[targetLang][row.field_name as TranslatableField] = String(row.translated_text || '');
    return acc;
  }, {});
}
