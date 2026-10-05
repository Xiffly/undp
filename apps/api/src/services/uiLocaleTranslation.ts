import { logger } from '../observability/logger';
import { DEFAULT_LANGUAGE } from '../utils/languages';
import { flattenLocale, projectLocaleToSourceShape, readLocaleForEditor, saveLocaleFromEditor } from '../utils/locales';
import { getAiModelChain, TRANSLATION_REQUEST_TIMEOUT_MS } from './aiSettings';

type JsonObject = Record<string, unknown>;

const UI_TRANSLATION_BATCH_SIZE = Math.max(1, Math.min(parseInt(process.env.UI_TRANSLATION_BATCH_SIZE || '40', 10), 100));

type TranslationFailureCode =
  | 'rate_limited'
  | 'model_unavailable'
  | 'invalid_response'
  | 'provider_error';

export class UiTranslationError extends Error {
  code: TranslationFailureCode;
  status: number;
  retryable: boolean;
  uiMessage: string;
  attempts: string[];

  constructor(opts: {
    code: TranslationFailureCode;
    message: string;
    status?: number;
    retryable?: boolean;
    uiMessage?: string;
    attempts?: string[];
  }) {
    super(opts.message);
    this.name = 'UiTranslationError';
    this.code = opts.code;
    this.status = opts.status ?? 502;
    this.retryable = opts.retryable ?? false;
    this.uiMessage = opts.uiMessage || 'AI provider is temporarily unavailable. Please try again shortly.';
    this.attempts = opts.attempts || [];
  }
}

async function getProviderConfig() {
  const provider = 'openrouter';
  const apiKey = (process.env.TRANSLATION_API_KEY || process.env.AI_API_KEY || '').trim();
  const modelCandidates = await getAiModelChain('translation');
  const customBaseUrl = (process.env.TRANSLATION_API_BASE_URL || '').trim().replace(/\/$/, '');
  return {
    provider,
    apiKey,
    modelCandidates,
    baseUrl: customBaseUrl || 'https://openrouter.ai/api/v1',
  };
}

function chunkEntries<T>(entries: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }
  return chunks;
}

function extractPlaceholders(input: string): string[] {
  return input.match(/\{\{[^}]+\}\}/g) || [];
}

function samePlaceholders(source: string, translated: string): boolean {
  const sourceTokens = extractPlaceholders(source).sort();
  const translatedTokens = extractPlaceholders(translated).sort();
  return sourceTokens.length === translatedTokens.length && sourceTokens.every((token, index) => token === translatedTokens[index]);
}

function sanitizeDraftTranslation(source: string, translated: unknown): string {
  const next = String(translated || '').trim();
  // English stays authoritative; a draft that loses placeholders is worse than no translation because
  // it can break runtime interpolation in production.
  if (!next) return source;
  if (!samePlaceholders(source, next)) return source;
  return next;
}

function buildUnavailableMessage(retryable: boolean): string {
  return retryable
    ? 'AI provider is temporarily unavailable. Please try again shortly.'
    : 'AI translation is currently unavailable. Please try again later or review provider settings.';
}

function mapProviderError(status: number, detail: string, model: string, attempts: string[] = []): UiTranslationError {
  const normalizedDetail = detail.toLowerCase();
  if (status === 429 || normalizedDetail.includes('rate-limit') || normalizedDetail.includes('rate limited')) {
    return new UiTranslationError({
      code: 'rate_limited',
      status: 503,
      retryable: true,
      uiMessage: buildUnavailableMessage(true),
      message: `Translation model rate-limited: ${model} (${status})`,
      attempts,
    });
  }
  if (
    status === 404
    || status === 410
    || normalizedDetail.includes('model not found')
    || normalizedDetail.includes('no endpoints found')
    || normalizedDetail.includes('unavailable')
  ) {
    return new UiTranslationError({
      code: 'model_unavailable',
      status: 503,
      retryable: true,
      uiMessage: buildUnavailableMessage(true),
      message: `Translation model unavailable: ${model} (${status})`,
      attempts,
    });
  }
  return new UiTranslationError({
    code: 'provider_error',
    status: 502,
    retryable: false,
    uiMessage: buildUnavailableMessage(false),
    message: `Translation provider failed for ${model} (${status})`,
    attempts,
  });
}

async function translateBatchWithOpenRouter(
  lang: string,
  entries: Array<[string, string]>,
  model: string,
  apiKey: string,
  baseUrl: string
): Promise<Record<string, string>> {
  const payload = Object.fromEntries(entries.map(([key, value]) => [key, value]));
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://crisis-platform.com',
      'X-Title': 'UNDP Crisis Assessment Platform',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You translate UI locale strings for a humanitarian crisis platform.',
            'Return only a JSON object with the same keys you received.',
            'Preserve placeholders like {{count}}, {{page}}, {{reportId}} exactly.',
            'Preserve line breaks and punctuation meaningfully.',
            'Do not add explanations, markdown, or extra keys.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Translate this JSON from ${DEFAULT_LANGUAGE} to ${lang}:\n${JSON.stringify(payload)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(TRANSLATION_REQUEST_TIMEOUT_MS),
  }).catch((err: any) => {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new UiTranslationError({
        code: 'provider_error',
        status: 504,
        retryable: true,
        uiMessage: buildUnavailableMessage(true),
        message: `Translation model timed out: ${model}`,
      });
    }
    throw err;
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw mapProviderError(resp.status, detail, model);
  }

  const data = await resp.json() as any;
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new UiTranslationError({
      code: 'invalid_response',
      status: 502,
      retryable: true,
      uiMessage: buildUnavailableMessage(true),
      message: `Translation provider returned invalid JSON for ${model}`,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UiTranslationError({
      code: 'invalid_response',
      status: 502,
      retryable: true,
      uiMessage: buildUnavailableMessage(true),
      message: `Translation provider returned a non-object payload for ${model}`,
    });
  }

  const result: Record<string, string> = {};
  for (const [key, source] of entries) {
    result[key] = sanitizeDraftTranslation(source, parsed[key]);
  }
  return result;
}

async function translateWithModelFallbacks(
  lang: string,
  entries: Array<[string, string]>,
  apiKey: string,
  baseUrl: string,
  modelCandidates: string[]
): Promise<{ translated: Record<string, string>; model: string }> {
  let lastError: unknown;
  const attemptedModels: string[] = [];
  for (const model of modelCandidates) {
    attemptedModels.push(model);
    try {
      // Translation availability can degrade per model, so the admin workflow walks the configured
      // chain before surfacing a failure to editors.
      const translated = await translateBatchWithOpenRouter(lang, entries, model, apiKey, baseUrl);
      console.info('[UI_TRANSLATION_SUCCESS]', JSON.stringify({
        lang,
        model,
        attemptsUsed: attemptedModels.length,
      }));
      return { translated, model };
    } catch (error) {
      logger.warn('ui.translation.attempt.failed', { details: [JSON.stringify({
        lang,
        model,
        error: error instanceof Error ? error.message : String(error),
      })] });
      lastError = error;
    }
  }
  if (lastError instanceof UiTranslationError) {
    throw new UiTranslationError({
      code: lastError.code,
      status: lastError.status,
      retryable: lastError.retryable,
      uiMessage: lastError.uiMessage,
      message: lastError.message,
      attempts: attemptedModels,
    });
  }
  throw new UiTranslationError({
    code: 'provider_error',
    status: 502,
    retryable: false,
    uiMessage: buildUnavailableMessage(false),
    message: 'Translation provider failed',
    attempts: attemptedModels,
  });
}

export async function autoTranslateUiKey(
  lang: string,
  key: string,
  source: string
): Promise<{ value: string; model: string; provider: string }> {
  const { provider, apiKey, modelCandidates, baseUrl } = await getProviderConfig();
  if (!apiKey) {
    throw new Error('Missing TRANSLATION_API_KEY or AI_API_KEY for OpenRouter translation');
  }

  const { translated, model: resolvedModel } = await translateWithModelFallbacks(
    lang,
    [[key, source]],
    apiKey,
    baseUrl,
    modelCandidates
  );
  return {
    value: translated[key] || source,
    model: resolvedModel,
    provider,
  };
}

export async function autoTranslateUiLocale(lang: string): Promise<{ updated: number; total: number; model: string; provider: string }> {
  const { provider, apiKey, modelCandidates, baseUrl } = await getProviderConfig();
  if (!apiKey) {
    throw new Error('Missing TRANSLATION_API_KEY or AI_API_KEY for OpenRouter translation');
  }

  const sourceLocale = readLocaleForEditor(DEFAULT_LANGUAGE);
  const currentLocale = readLocaleForEditor(lang);
  const sourceFlat = flattenLocale(sourceLocale);
  const currentFlat = flattenLocale(currentLocale);

  const entriesToTranslate = Object.entries(sourceFlat).filter(([key, value]) => {
    const currentValue = currentFlat[key];
    return !currentValue || currentValue === value;
  });

  if (!entriesToTranslate.length) {
    return { updated: 0, total: 0, model: modelCandidates[0] || 'openrouter/free', provider };
  }

  const nextFlat = { ...currentFlat };
  let updated = 0;
  let resolvedModel = modelCandidates[0] || 'openrouter/free';

  for (const batch of chunkEntries(entriesToTranslate, UI_TRANSLATION_BATCH_SIZE)) {
    const result = await translateWithModelFallbacks(lang, batch, apiKey, baseUrl, modelCandidates);
    const translated = result.translated;
    resolvedModel = result.model;
    for (const [key, source] of batch) {
      const next = translated[key] || source;
      if (next && next !== source) updated += 1;
      nextFlat[key] = next;
    }
  }

  const projected = projectLocaleToSourceShape(sourceLocale as JsonObject, nextFlat as unknown as JsonObject);
  saveLocaleFromEditor(lang, projected);

  return { updated, total: entriesToTranslate.length, model: resolvedModel, provider };
}
