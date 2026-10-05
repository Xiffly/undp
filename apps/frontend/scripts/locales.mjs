import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(ROOT, '..', '..');
const LOCALES_DIR = path.join(ROOT, 'public', 'locales');
const SOURCE_LANG = 'en';
const SOURCE_FILE = 'translation.json';
const SUPPORTED_LANGUAGES_PATH = path.join(REPO_ROOT, 'shared', 'supported-languages.json');
const FRONTEND_SUPPORTED_LANGUAGES_TS_PATH = path.join(ROOT, 'src', 'config', 'supportedLanguages.ts');
const HIDDEN_PREFIXES = ['home.'];

const SUSPICIOUS_TOKENS = [
  'Ã',
  'Â',
  'Ð',
  'Ñ',
  'Ø',
  'Ù',
  'Ï',
  'â€',
  'â€™',
  'â€œ',
  'â€',
  'ï¿½',
  '�',
];

const LANGUAGE_METADATA_FIXES = {
  ar: { nativeLabel: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629', flag: 'AR', dir: 'rtl' },
  en: { nativeLabel: 'English', flag: 'GB', dir: 'ltr' },
  es: { nativeLabel: 'Espa\u00f1ol', flag: 'ES', dir: 'ltr' },
  fr: { nativeLabel: 'Fran\u00e7ais', flag: 'FR', dir: 'ltr' },
  ru: { nativeLabel: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439', flag: 'RU', dir: 'ltr' },
  zh: { nativeLabel: '\u4e2d\u6587', flag: 'CN', dir: 'ltr' },
};

const ALLOWED_ENGLISH_MATCH_KEYS = {
  ar: new Set([
  ]),
  fr: new Set([
    'submit.step_infrastructure',
    'submit.latitude_label',
    'submit.longitude_label',
    'submit.description_label',
    'submit.contact_label',
    'submit.summary_photos',
    'submit.summary_photos_plural',
    
    
    'map.tile_satellite',
    'report.infrastructure_suffix',
    
    'report.photos',
    'report.description',
    
    'admin.reports.infrastructure',
    'admin.reports.action',
    
    
    'infra.commercial',
    'crisis_types.tsunami',
    'crisis_types.explosion',
    
    
    'common.channel_whatsapp',
    'queue.photos',
  ]),
  es: new Set([
    'submit.debris_no',
    'admin.reports.crisis',
    
    'crisis_types.tsunami',
    
    'common.channel_whatsapp',
  ]),
  ru: new Set([
    'common.channel_whatsapp',
  ]),
  zh: new Set([
    'common.channel_whatsapp',
  ]),
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function flatten(input, prefix = '', output = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    if (prefix) output[prefix] = typeof input === 'string' ? input : String(input ?? '');
    return output;
  }

  for (const [key, value] of Object.entries(input)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, nextKey, output);
    } else {
      output[nextKey] = typeof value === 'string' ? value : String(value ?? '');
    }
  }

  return output;
}

function unflatten(flat) {
  const result = {};
  for (const [compoundKey, value] of Object.entries(flat)) {
    const parts = compoundKey.split('.');
    let cursor = result;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part];
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return result;
}

function isEditableKey(key) {
  return !HIDDEN_PREFIXES.some((prefix) => key === prefix.slice(0, -1) || key.startsWith(prefix));
}

function filterEditableFlat(flat) {
  return Object.fromEntries(Object.entries(flat).filter(([key]) => isEditableKey(key)));
}

function getLanguageCodes() {
  const languages = readJson(SUPPORTED_LANGUAGES_PATH);
  if (!Array.isArray(languages) || languages.length === 0) {
    throw new Error('supported-languages.json is empty or invalid');
  }
  return languages.map((lang) => lang.code);
}

function hasLettersOrDigits(value) {
  return /[\p{L}\p{N}]/u.test(value);
}

function scriptRegex(lang) {
  if (lang === 'ru') return /[\u0400-\u04FF]/u;
  if (lang === 'ar') return /[\u0600-\u06FF]/u;
  if (lang === 'zh') return /[\u3400-\u9FFF]/u;
  return null;
}

function hasOnlyPunctuation(value) {
  return Boolean(value.trim()) && !hasLettersOrDigits(value);
}

function suspiciousScore(value, lang, source = '') {
  if (typeof value !== 'string') return 100;
  let score = 0;

  if (SUSPICIOUS_TOKENS.some((token) => value.includes(token))) score += 5;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) score += 5;
  if (value.includes('\uFFFD')) score += 5;

  const trimmed = value.trim();
  if (trimmed && source && source !== value && hasOnlyPunctuation(trimmed)) score += 5;
  if (trimmed.length > 0 && trimmed.length <= 2 && source.length >= 4 && !hasLettersOrDigits(trimmed)) score += 5;

  const expectedScript = scriptRegex(lang);
  if (expectedScript && source && source !== value && !expectedScript.test(value) && hasLettersOrDigits(source)) {
    score += 5;
  }

  return score;
}

function isAllowedEnglishMatch(lang, key, value, source = '') {
  if (lang === SOURCE_LANG) return true;
  if (value !== source) return false;
  return ALLOWED_ENGLISH_MATCH_KEYS[lang]?.has(key) ?? false;
}

function decodeLatin1Utf8(value) {
  try {
    return Buffer.from(value, 'latin1').toString('utf8');
  } catch {
    return value;
  }
}

function normalizeSuspectString(value, lang, source = '') {
  if (typeof value !== 'string') return String(value ?? '');
  let current = value;
  for (let index = 0; index < 2; index += 1) {
    const decoded = decodeLatin1Utf8(current);
    if (decoded !== current && suspiciousScore(decoded, lang, source) < suspiciousScore(current, lang, source)) {
      current = decoded;
      continue;
    }
    break;
  }
  return current;
}

function readLocaleFile(lang) {
  const filePath = path.join(LOCALES_DIR, lang, SOURCE_FILE);
  return fs.existsSync(filePath) ? readJson(filePath) : {};
}

function syncLocaleToSource(sourceFlat, localeFlat) {
  return Object.fromEntries(
    Object.keys(sourceFlat).map((key) => [key, typeof localeFlat[key] === 'string' ? localeFlat[key] : sourceFlat[key]])
  );
}

function validateMetadata(languages) {
  const issues = [];
  const seenCodes = new Set();
  let masters = 0;

  for (const lang of languages) {
    if (!lang || typeof lang !== 'object') {
      issues.push({ scope: 'metadata', issue: 'invalid_language_entry' });
      continue;
    }

    if (seenCodes.has(lang.code)) issues.push({ scope: 'metadata', issue: 'duplicate_code', language: lang.code });
    seenCodes.add(lang.code);
    if (lang.master) masters += 1;

    const expected = LANGUAGE_METADATA_FIXES[lang.code];
    if (expected) {
      if (lang.nativeLabel !== expected.nativeLabel) {
        issues.push({ scope: 'metadata', issue: 'wrong_native_label', language: lang.code, value: lang.nativeLabel });
      }
      if (lang.flag !== expected.flag) {
        issues.push({ scope: 'metadata', issue: 'wrong_flag', language: lang.code, value: lang.flag });
      }
      if (lang.dir !== expected.dir) {
        issues.push({ scope: 'metadata', issue: 'wrong_dir', language: lang.code, value: lang.dir });
      }
    }

    const localePath = path.join(LOCALES_DIR, lang.code, SOURCE_FILE);
    if (!fs.existsSync(localePath)) issues.push({ scope: 'metadata', issue: 'missing_locale_file', language: lang.code });
  }

  if (masters !== 1) issues.push({ scope: 'metadata', issue: 'invalid_master_count', count: masters });
  return issues;
}

function collectLocaleIssues(lang, sourceFlat, localeFlat) {
  const issues = [];
  const missing = Object.keys(sourceFlat).filter((key) => !(key in localeFlat));
  const extra = Object.keys(localeFlat).filter((key) => !(key in sourceFlat));

  for (const key of missing) {
    issues.push({ scope: 'locale', language: lang, key, issue: 'missing_key' });
  }

  for (const key of extra) {
    issues.push({ scope: 'locale', language: lang, key, issue: 'extra_key' });
  }

  for (const [key, value] of Object.entries(localeFlat)) {
    if (typeof value !== 'string') {
      issues.push({ scope: 'locale', language: lang, key, issue: 'non_string_value' });
      continue;
    }

    if (lang !== SOURCE_LANG && value === sourceFlat[key] && !isAllowedEnglishMatch(lang, key, value, sourceFlat[key] || '')) {
      issues.push({ scope: 'locale', language: lang, key, issue: 'untranslated_key', value });
      continue;
    }

    if (suspiciousScore(value, lang, sourceFlat[key] || '') > 0) {
      issues.push({ scope: 'locale', language: lang, key, issue: 'suspicious_text', value });
    }
  }

  return issues;
}

function auditAll() {
  const languages = readJson(SUPPORTED_LANGUAGES_PATH);
  const issues = [...validateMetadata(languages)];
  const sourceFlat = filterEditableFlat(flatten(readLocaleFile(SOURCE_LANG)));

  for (const lang of getLanguageCodes()) {
    const localeFlat = filterEditableFlat(flatten(readLocaleFile(lang)));
    issues.push(...collectLocaleIssues(lang, sourceFlat, localeFlat));
  }

  return issues;
}

function validateAll() {
  const issues = auditAll();
  if (issues.length) {
    const preview = issues.slice(0, 25).map((issue) => JSON.stringify(issue)).join('\n');
    throw new Error(`Locale validation failed with ${issues.length} issue(s):\n${preview}`);
  }
}

function validateWithoutUntranslatedKeys() {
  const issues = auditAll().filter((issue) => issue.issue !== 'untranslated_key');
  if (issues.length) {
    const preview = issues.slice(0, 25).map((issue) => JSON.stringify(issue)).join('\n');
    throw new Error(`Locale structural validation failed with ${issues.length} issue(s):\n${preview}`);
  }
}

function renderSupportedLanguagesTs(languages) {
  const entries = languages
    .map(
      (lang) =>
        `  { code: ${JSON.stringify(lang.code)}, label: ${JSON.stringify(lang.label)}, nativeLabel: ${JSON.stringify(lang.nativeLabel)}, flag: ${JSON.stringify(lang.flag)}, dir: ${JSON.stringify(lang.dir)}, master: ${lang.master ? 'true' : 'false'} },`
    )
    .join('\n');

  return `export type SupportedLanguage = {
  code: string;
  label: string;
  nativeLabel: string;
  flag: string;
  dir: 'ltr' | 'rtl';
  master: boolean;
};

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
${entries}
];
`;
}

function repairSupportedLanguages() {
  const languages = readJson(SUPPORTED_LANGUAGES_PATH);
  const repaired = languages.map((lang) => ({
    ...lang,
    ...(LANGUAGE_METADATA_FIXES[lang.code] || {}),
  }));
  writeJson(SUPPORTED_LANGUAGES_PATH, repaired);
  fs.writeFileSync(FRONTEND_SUPPORTED_LANGUAGES_TS_PATH, renderSupportedLanguagesTs(repaired), 'utf8');
}

function repairLocale(lang, sourceFlat) {
  const currentFlat = filterEditableFlat(flatten(readLocaleFile(lang)));
  const nextFlat = {};
  const stats = { kept: 0, normalized: 0, fallback: 0 };

  for (const [key, sourceValue] of Object.entries(sourceFlat)) {
    if (lang === SOURCE_LANG) {
      nextFlat[key] = sourceValue;
      stats.kept += 1;
      continue;
    }

    const currentValue = typeof currentFlat[key] === 'string' ? currentFlat[key] : '';
    const normalized = normalizeSuspectString(currentValue, lang, sourceValue);
    if (normalized && suspiciousScore(normalized, lang, sourceValue) === 0) {
      nextFlat[key] = normalized;
      stats[normalized === currentValue ? 'kept' : 'normalized'] += 1;
      continue;
    }

    nextFlat[key] = sourceValue;
    stats.fallback += 1;
  }

  writeJson(path.join(LOCALES_DIR, lang, SOURCE_FILE), unflatten(syncLocaleToSource(sourceFlat, nextFlat)));
  return stats;
}

function syncAll() {
  const sourceFlat = filterEditableFlat(flatten(readLocaleFile(SOURCE_LANG)));

  for (const lang of getLanguageCodes()) {
    const localeFlat = filterEditableFlat(flatten(readLocaleFile(lang)));
    writeJson(path.join(LOCALES_DIR, lang, SOURCE_FILE), unflatten(syncLocaleToSource(sourceFlat, localeFlat)));
  }
}

function repairAll() {
  repairSupportedLanguages();
  const sourceFlat = filterEditableFlat(flatten(readLocaleFile(SOURCE_LANG)));
  const summary = {};

  for (const lang of getLanguageCodes()) {
    summary[lang] = repairLocale(lang, sourceFlat);
  }

  validateWithoutUntranslatedKeys();
  return summary;
}

const mode = process.argv[2] || 'validate';

if (mode === 'validate') {
  validateAll();
} else if (mode === 'audit') {
  const issues = auditAll();
  console.log(JSON.stringify({ issue_count: issues.length, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
} else if (mode === 'sync') {
  syncAll();
  validateAll();
} else if (mode === 'repair') {
  const summary = repairAll();
  console.log(JSON.stringify(summary, null, 2));
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
