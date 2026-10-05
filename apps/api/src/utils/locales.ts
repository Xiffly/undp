import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_LANGUAGE, isSupportedLanguage, SUPPORTED_LANGUAGE_CODES } from './languages';

export const LOCALES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'apps', 'frontend', 'public', 'locales');
const SOURCE_FILE_NAME = 'translation.json';
const EDITOR_HIDDEN_PREFIXES = ['home.'];
const EDITOR_META_FILE = path.join(LOCALES_DIR, '.editor-meta.json');

type JsonObject = Record<string, unknown>;
type FlatLocaleMap = Record<string, string>;
type LocaleEditorMeta = {
  version: 1;
  languages: Record<string, { sourceHashes: Record<string, string> }>;
};

function isEditorVisibleKey(key: string): boolean {
  return !EDITOR_HIDDEN_PREFIXES.some((prefix) => key === prefix.slice(0, -1) || key.startsWith(prefix));
}

function assertEditorVisibleKey(key: string) {
  if (!key || !isEditorVisibleKey(key)) {
    throw new Error(`Translation key is not editable: ${key}`);
  }
}

export function filterEditableLocaleFlat(flat: FlatLocaleMap): FlatLocaleMap {
  return Object.fromEntries(Object.entries(flat).filter(([key]) => isEditorVisibleKey(key)));
}

export function filterEditableLocaleTree(locale: JsonObject): JsonObject {
  return unflattenLocale(filterEditableLocaleFlat(flattenLocale(locale)));
}

function readJsonFile(filePath: string): JsonObject {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as JsonObject;
}

function writeJsonFile(filePath: string, value: JsonObject) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function hashSourceValue(value: string): string {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex');
}

function getEditableSourceFlat(): FlatLocaleMap {
  return flattenLocale(filterEditableLocaleTree(getSourceLocale()));
}

function readEditorMeta(): LocaleEditorMeta {
  if (!fs.existsSync(EDITOR_META_FILE)) {
    return { version: 1, languages: {} };
  }

  try {
    const parsed = readJsonFile(EDITOR_META_FILE) as LocaleEditorMeta;
    return {
      version: 1,
      languages: parsed?.languages && typeof parsed.languages === 'object' ? parsed.languages : {},
    };
  } catch {
    return { version: 1, languages: {} };
  }
}

function writeEditorMeta(meta: LocaleEditorMeta) {
  writeJsonFile(EDITOR_META_FILE, meta as unknown as JsonObject);
}

function getCurrentSourceHashes(): Record<string, string> {
  const sourceFlat = getEditableSourceFlat();
  return Object.fromEntries(
    Object.entries(sourceFlat).map(([key, value]) => [key, hashSourceValue(value)])
  );
}

function updateEditorMetaHashes(lang: string, keys: string[]) {
  if (lang === DEFAULT_LANGUAGE) return;
  const meta = readEditorMeta();
  const sourceHashes = getCurrentSourceHashes();
  const next = {
    sourceHashes: {
      ...(meta.languages[lang]?.sourceHashes || {}),
    },
  };

  for (const key of keys) {
    if (sourceHashes[key]) {
      next.sourceHashes[key] = sourceHashes[key];
    }
  }

  meta.languages[lang] = next;
  writeEditorMeta(meta);
}

function ensureLocaleMetaBaseline(lang: string): Record<string, string> {
  if (lang === DEFAULT_LANGUAGE) return {};

  const meta = readEditorMeta();
  const sourceHashes = getCurrentSourceHashes();
  const localeFlat = flattenLocale(filterEditableLocaleTree(readStoredLocale(lang)));
  const existing = meta.languages[lang]?.sourceHashes || {};
  const next = { ...existing };
  let changed = false;

  for (const [key, sourceHash] of Object.entries(sourceHashes)) {
    const localeValue = String(localeFlat[key] ?? '').trim();
    if (!localeValue) continue;
    if (!next[key]) {
      next[key] = sourceHash;
      changed = true;
    }
  }

  for (const key of Object.keys(next)) {
    if (!(key in sourceHashes)) {
      delete next[key];
      changed = true;
    }
  }

  if (changed) {
    meta.languages[lang] = { sourceHashes: next };
    writeEditorMeta(meta);
  }

  return next;
}

export function getLocaleStaleKeys(lang: string): string[] {
  if (lang === DEFAULT_LANGUAGE) return [];
  const sourceHashes = getCurrentSourceHashes();
  const savedHashes = ensureLocaleMetaBaseline(lang);
  const localeFlat = flattenLocale(filterEditableLocaleTree(readStoredLocale(lang)));

  return Object.keys(sourceHashes).filter((key) => {
    const localeValue = String(localeFlat[key] ?? '').trim();
    if (!localeValue) return false;
    return savedHashes[key] !== sourceHashes[key];
  });
}

export function getLocaleMissingKeys(lang: string): string[] {
  if (lang === DEFAULT_LANGUAGE) return [];
  const sourceFlat = getEditableSourceFlat();
  const localeFlat = flattenLocale(filterEditableLocaleTree(readStoredLocale(lang)));

  return Object.keys(sourceFlat).filter((key) => String(localeFlat[key] ?? '').trim() === '');
}

export function getLocaleFilePath(lang: string): string {
  return path.join(LOCALES_DIR, lang, SOURCE_FILE_NAME);
}

export function readStoredLocale(lang: string): JsonObject {
  const filePath = getLocaleFilePath(lang);
  if (!fs.existsSync(filePath)) return {};
  return readJsonFile(filePath);
}

export function writeStoredLocale(lang: string, value: JsonObject) {
  writeJsonFile(getLocaleFilePath(lang), value);
}

export function flattenLocale(input: unknown, prefix = '', output: FlatLocaleMap = {}): FlatLocaleMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    if (prefix) output[prefix] = typeof input === 'string' ? input : String(input ?? '');
    return output;
  }

  for (const [key, value] of Object.entries(input as JsonObject)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenLocale(value, nextKey, output);
    } else {
      output[nextKey] = typeof value === 'string' ? value : String(value ?? '');
    }
  }

  return output;
}

export function unflattenLocale(flat: FlatLocaleMap): JsonObject {
  const result: JsonObject = {};

  for (const [compoundKey, value] of Object.entries(flat)) {
    const parts = compoundKey.split('.');
    let cursor: JsonObject = result;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      const next = cursor[part];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as JsonObject;
    }

    cursor[parts[parts.length - 1]] = value;
  }

  return result;
}

export function getSourceLocale(): JsonObject {
  return readStoredLocale(DEFAULT_LANGUAGE);
}

export function projectLocaleToSourceShape(
  sourceLocale: JsonObject,
  candidateLocale: JsonObject,
  fallbackLocale?: JsonObject
): JsonObject {
  const sourceFlat = flattenLocale(sourceLocale);
  const candidateFlat = flattenLocale(candidateLocale);
  const fallbackFlat = fallbackLocale ? flattenLocale(fallbackLocale) : {};
  const nextFlat: FlatLocaleMap = {};

  for (const [key, sourceValue] of Object.entries(sourceFlat)) {
    const candidateValue = candidateFlat[key];
    if (typeof candidateValue === 'string') {
      nextFlat[key] = candidateValue;
      continue;
    }

    const fallbackValue = fallbackFlat[key];
    if (typeof fallbackValue === 'string') {
      nextFlat[key] = fallbackValue;
      continue;
    }

    nextFlat[key] = sourceValue;
  }

  return unflattenLocale(nextFlat);
}

export function projectLocaleToEditorShape(
  sourceLocale: JsonObject,
  candidateLocale: JsonObject
): JsonObject {
  const sourceFlat = flattenLocale(sourceLocale);
  const candidateFlat = flattenLocale(candidateLocale);
  const nextFlat: FlatLocaleMap = {};

  for (const key of Object.keys(sourceFlat)) {
    const candidateValue = candidateFlat[key];
    nextFlat[key] = typeof candidateValue === 'string' ? candidateValue : '';
  }

  return unflattenLocale(nextFlat);
}

export function countLeafStrings(locale: JsonObject): number {
  return Object.keys(flattenLocale(locale)).length;
}

export function countTranslatedLeafStrings(sourceLocale: JsonObject, locale: JsonObject): number {
  const sourceFlat = flattenLocale(sourceLocale);
  const localeFlat = flattenLocale(locale);
  return Object.keys(sourceFlat).filter((key) => {
    const translated = localeFlat[key];
    return Boolean(translated) && translated !== sourceFlat[key];
  }).length;
}

export function getLocaleStatus() {
  const sourceLocale = filterEditableLocaleTree(getSourceLocale());
  const totalKeys = countLeafStrings(sourceLocale);

  return SUPPORTED_LANGUAGE_CODES.map((lang) => {
    const filePath = getLocaleFilePath(lang);
    const exists = fs.existsSync(filePath);
    const locale = projectLocaleToSourceShape(sourceLocale, filterEditableLocaleTree(readStoredLocale(lang)), lang === DEFAULT_LANGUAGE ? sourceLocale : {});
    const staleCount = lang === DEFAULT_LANGUAGE ? 0 : getLocaleStaleKeys(lang).length;
    const missingCount = lang === DEFAULT_LANGUAGE ? 0 : getLocaleMissingKeys(lang).length;
    return {
      lang,
      exists,
      keyCount: totalKeys,
      translatedCount: lang === DEFAULT_LANGUAGE ? totalKeys : countTranslatedLeafStrings(sourceLocale, locale),
      staleCount,
      missingCount,
      attentionCount: staleCount + missingCount,
      hasStaleTranslations: staleCount > 0,
      hasMissingTranslations: missingCount > 0,
    };
  });
}

export function readLocaleForEditor(lang: string): JsonObject {
  if (!isSupportedLanguage(lang)) {
    throw new Error(`Unsupported language: ${lang}`);
  }

  const sourceLocale = filterEditableLocaleTree(getSourceLocale());
  if (lang === DEFAULT_LANGUAGE) return sourceLocale;
  return projectLocaleToEditorShape(sourceLocale, filterEditableLocaleTree(readStoredLocale(lang)));
}

export function saveLocaleFromEditor(lang: string, value: JsonObject): JsonObject {
  if (!isSupportedLanguage(lang)) {
    throw new Error(`Unsupported language: ${lang}`);
  }

  const sourceLocale = getSourceLocale();
  const existingLocale = readStoredLocale(lang);
  const editableSourceLocale = filterEditableLocaleTree(sourceLocale);
  const editableValue = filterEditableLocaleTree(value);
  const editableExistingLocale = filterEditableLocaleTree(existingLocale);
  const nextEditableLocale = lang === DEFAULT_LANGUAGE
    ? projectLocaleToSourceShape(editableValue, editableValue)
    : projectLocaleToSourceShape(editableSourceLocale, editableValue, editableExistingLocale);
  const preservedHiddenLocale = unflattenLocale(
    Object.fromEntries(
      Object.entries(flattenLocale(existingLocale)).filter(([key]) => !isEditorVisibleKey(key))
    )
  );
  const nextLocale = {
    ...preservedHiddenLocale,
    ...nextEditableLocale,
  };

  writeStoredLocale(lang, nextLocale);
  updateEditorMetaHashes(lang, Object.keys(flattenLocale(nextEditableLocale)));
  return nextLocale;
}

export function readLocaleKeyForEditor(lang: string, key: string): { key: string; value: string; source: string; stale: boolean } {
  assertEditorVisibleKey(key);
  const sourceFlat = flattenLocale(readLocaleForEditor(DEFAULT_LANGUAGE));
  if (!(key in sourceFlat)) {
    throw new Error(`Unknown translation key: ${key}`);
  }

  const localeFlat = flattenLocale(readLocaleForEditor(lang));
  return {
    key,
    value: String(localeFlat[key] ?? ''),
    source: String(sourceFlat[key] ?? ''),
    stale: lang === DEFAULT_LANGUAGE ? false : getLocaleStaleKeys(lang).includes(key),
  };
}

export function saveLocaleKeyFromEditor(lang: string, key: string, value: unknown): { key: string; value: string } {
  if (!isSupportedLanguage(lang)) {
    throw new Error(`Unsupported language: ${lang}`);
  }
  assertEditorVisibleKey(key);

  const sourceLocale = getSourceLocale();
  const sourceFlat = flattenLocale(filterEditableLocaleTree(sourceLocale));
  if (!(key in sourceFlat)) {
    throw new Error(`Unknown translation key: ${key}`);
  }

  const existingLocale = readStoredLocale(lang);
  const editableFlat = flattenLocale(filterEditableLocaleTree(existingLocale));
  editableFlat[key] = String(value ?? '');
  const preservedHiddenLocale = unflattenLocale(
    Object.fromEntries(
      Object.entries(flattenLocale(existingLocale)).filter(([candidateKey]) => !isEditorVisibleKey(candidateKey))
    )
  );
  const saved = {
    ...preservedHiddenLocale,
    ...projectLocaleToSourceShape(
      filterEditableLocaleTree(sourceLocale),
      unflattenLocale(editableFlat),
      filterEditableLocaleTree(existingLocale)
    ),
  };
  writeStoredLocale(lang, saved);
  updateEditorMetaHashes(lang, [key]);
  const savedFlat = flattenLocale(filterEditableLocaleTree(saved));

  return {
    key,
    value: String(savedFlat[key] ?? ''),
  };
}

export function upsertLocaleKey(lang: string, key: string, value: unknown): { key: string; value: string } {
  if (!isSupportedLanguage(lang)) {
    throw new Error(`Unsupported language: ${lang}`);
  }
  if (!key) {
    throw new Error('Translation key is required');
  }
  assertEditorVisibleKey(key);

  const existingLocale = readStoredLocale(lang);
  const editableFlat = flattenLocale(filterEditableLocaleTree(existingLocale));
  editableFlat[key] = String(value ?? '');
  const preservedHiddenLocale = unflattenLocale(
    Object.fromEntries(
      Object.entries(flattenLocale(existingLocale)).filter(([candidateKey]) => !isEditorVisibleKey(candidateKey))
    )
  );
  const saved = {
    ...preservedHiddenLocale,
    ...unflattenLocale(editableFlat),
  };
  writeStoredLocale(lang, saved);
  updateEditorMetaHashes(lang, [key]);

  return {
    key,
    value: String(editableFlat[key] ?? ''),
  };
}

export function deleteLocaleKeyEverywhere(key: string) {
  assertEditorVisibleKey(key);
  const meta = readEditorMeta();

  for (const lang of SUPPORTED_LANGUAGE_CODES) {
    const existingLocale = readStoredLocale(lang);
    const flat = flattenLocale(existingLocale);
    if (!(key in flat)) continue;
    delete flat[key];
    writeStoredLocale(lang, unflattenLocale(flat));
    if (meta.languages[lang]?.sourceHashes && key in meta.languages[lang].sourceHashes) {
      delete meta.languages[lang].sourceHashes[key];
    }
  }

  writeEditorMeta(meta);
}
