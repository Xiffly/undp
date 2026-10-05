import { execute, queryAll, queryOne } from '../dbRuntime';

const DEFAULT_VISION_MODEL = 'google/gemma-4-26b-a4b-it:free';
const DEFAULT_TEXT_MODEL = 'openai/gpt-oss-120b:free';
const DEFAULT_VISION_FALLBACK_MODEL_1 = 'google/gemma-4-31b-it:free';
const DEFAULT_VISION_FALLBACK_MODEL_2 = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
const DEFAULT_TEXT_FALLBACK_MODEL_1 = 'openai/gpt-oss-20b:free';
const DEFAULT_TEXT_FALLBACK_MODEL_2 = 'qwen/qwen3-coder:free';
const DEFAULT_TRANSLATION_MODEL = DEFAULT_TEXT_MODEL;
const DEFAULT_TRANSLATION_FALLBACK_MODEL_1 = DEFAULT_TEXT_FALLBACK_MODEL_1;
const DEFAULT_TRANSLATION_FALLBACK_MODEL_2 = 'openrouter/free';
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 60000;

export const AI_SETTINGS_DEFAULTS: Record<string, string> = {
  model_vision: DEFAULT_VISION_MODEL,
  model_vision_fallback_1: DEFAULT_VISION_FALLBACK_MODEL_1,
  model_vision_fallback_2: DEFAULT_VISION_FALLBACK_MODEL_2,
  model_text: DEFAULT_TEXT_MODEL,
  model_text_fallback_1: DEFAULT_TEXT_FALLBACK_MODEL_1,
  model_text_fallback_2: DEFAULT_TEXT_FALLBACK_MODEL_2,
  translation_model: DEFAULT_TRANSLATION_MODEL,
  translation_fallback_model_1: DEFAULT_TRANSLATION_FALLBACK_MODEL_1,
  translation_fallback_model_2: DEFAULT_TRANSLATION_FALLBACK_MODEL_2,
  feature_sitrep: 'true',
  sitrep_min_reports: '3',
  mobilenet_enabled: 'false',
  mobilenet_url: '',
};

export type AiSettingsKey = keyof typeof AI_SETTINGS_DEFAULTS;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const AI_REQUEST_TIMEOUT_MS = parsePositiveInt(
  process.env.AI_REQUEST_TIMEOUT_MS,
  DEFAULT_AI_REQUEST_TIMEOUT_MS
);

export const TRANSLATION_REQUEST_TIMEOUT_MS = parsePositiveInt(
  process.env.TRANSLATION_REQUEST_TIMEOUT_MS,
  AI_REQUEST_TIMEOUT_MS
);

export const AI_MODEL_LIST_REQUEST_TIMEOUT_MS = parsePositiveInt(
  process.env.AI_MODEL_LIST_REQUEST_TIMEOUT_MS,
  AI_REQUEST_TIMEOUT_MS
);

function resolveEnvDefault(key: string): string {
  const translationFallbacks = String(process.env.TRANSLATION_FALLBACK_MODELS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (key === 'model_vision') return (process.env.AI_MODEL_VISION || '').trim();
  if (key === 'model_text') return (process.env.AI_MODEL_TEXT || '').trim();
  if (key === 'translation_model') return (process.env.TRANSLATION_MODEL || '').trim();
  if (key === 'translation_fallback_model_1') return translationFallbacks[0] || '';
  if (key === 'translation_fallback_model_2') return translationFallbacks[1] || '';
  return '';
}

const AI_MODEL_CHAIN_KEYS = {
  vision: ['model_vision', 'model_vision_fallback_1', 'model_vision_fallback_2'],
  text: ['model_text', 'model_text_fallback_1', 'model_text_fallback_2'],
  translation: ['translation_model', 'translation_fallback_model_1', 'translation_fallback_model_2'],
} as const;

const AI_MODEL_CHAIN_DEFAULTS = {
  vision: [DEFAULT_VISION_MODEL, DEFAULT_VISION_FALLBACK_MODEL_1, DEFAULT_VISION_FALLBACK_MODEL_2],
  text: [DEFAULT_TEXT_MODEL, DEFAULT_TEXT_FALLBACK_MODEL_1, DEFAULT_TEXT_FALLBACK_MODEL_2],
  translation: [DEFAULT_TEXT_MODEL, DEFAULT_TRANSLATION_FALLBACK_MODEL_1, DEFAULT_TRANSLATION_FALLBACK_MODEL_2],
} as const;

export type AiModelChainKind = keyof typeof AI_MODEL_CHAIN_KEYS;

export async function ensureAiSettingsDefaults(): Promise<void> {
  for (const [key, fallback] of Object.entries(AI_SETTINGS_DEFAULTS)) {
    const value = resolveEnvDefault(key) || fallback;
    await execute(
      'INSERT INTO ai_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }
}

export async function getAiSetting(key: string): Promise<string> {
  const row = await queryOne<{ value: string }>('SELECT value FROM ai_settings WHERE key = ?', [key]);
  const stored = row?.value ?? '';
  if (stored) return stored;

  if (key === 'translation_model') {
    return resolveEnvDefault('translation_model') || DEFAULT_TRANSLATION_MODEL || await getAiSetting('model_text');
  }

  return resolveEnvDefault(key) || AI_SETTINGS_DEFAULTS[key as AiSettingsKey] || '';
}

export async function getAiModelChain(kind: AiModelChainKind): Promise<string[]> {
  const keys = AI_MODEL_CHAIN_KEYS[kind];
  const values = await Promise.all(keys.map((key) => getAiSetting(key)));
  const deduped: string[] = [];
  for (const candidate of [...values, ...AI_MODEL_CHAIN_DEFAULTS[kind]]) {
    const normalized = String(candidate || '').trim();
    if (!normalized || deduped.includes(normalized)) continue;
    deduped.push(normalized);
  }
  return deduped;
}

export async function setAiSetting(key: string, value: string): Promise<void> {
  await execute(
    "INSERT INTO ai_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
    [key, value]
  );
}

export async function getPublicAiSettings(): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};
  for (const key of Object.keys(AI_SETTINGS_DEFAULTS)) {
    settings[key] = await getAiSetting(key);
  }
  return settings;
}

export async function getAllAiSettingsRows(): Promise<Record<string, string>> {
  const rows = await queryAll<{ key: string; value: string }>('SELECT key, value FROM ai_settings');
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
