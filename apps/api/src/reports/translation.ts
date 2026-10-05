import { logger } from '../observability/logger';
import crypto from 'crypto';
import { randomUUID as uuidv4 } from 'node:crypto';
import { queryAll, queryOne, execute } from '../dbRuntime';
import { Report } from '../types';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES } from '../utils/languages';
import { buildTranslationsObject, detectSourceLanguage, hasInvalidTranslationText, normalizeLanguageCode, TRANSLATABLE_FIELDS, type TranslatableField } from '../utils/reportContentLanguage';
import { hasTextCorruption } from '../utils/textCorruption';
import { getAiModelChain, TRANSLATION_REQUEST_TIMEOUT_MS } from '../services/aiSettings';

export type TranslationRow = {
  report_id: string;
  field_name: string;
  target_lang: string;
  translated_text: string;
};

export type TranslationJobRow = {
  id: string;
  report_id: string;
  target_lang: string;
  status: 'pending' | 'processing' | 'retry_wait' | 'completed' | 'failed_terminal';
  attempt_count: number;
  next_attempt_at?: string;
  last_error_message?: string | null;
  last_provider?: string | null;
  last_model?: string | null;
  locked_at?: string | null;
};

export type RequestedTranslationStatus = 'not_needed' | 'pending' | 'completed' | 'failed';

export type CachedTranslationRow = {
  translated_text: string;
  source_hash: string;
};

export type TranslationExecutionResult = {
  translated: string;
  provider: string;
  model: string | null;
  completed: boolean;
  attemptsUsed: number;
  retryable: boolean;
  errorCode?: string;
  errorMessage?: string;
};

export type TranslationFieldName = TranslatableField;

export type CachedTranslationLookupResult = {
  text: string;
  completed: boolean;
  provider: string;
  model: string | null;
};

export type TranslationState = {
  targetLang: string;
  sourceLang: string;
  status: RequestedTranslationStatus;
  missingFields: TranslatableField[];
  hasContent: boolean;
};

export const TRANSLATION_POLL_MS = parseInt(process.env.TRANSLATION_POLL_MS || '15000', 10);

export const TRANSLATION_LOCK_MINUTES = parseInt(process.env.TRANSLATION_LOCK_MINUTES || '2', 10);

export const TRANSLATION_MAX_ATTEMPTS = parseInt(process.env.TRANSLATION_MAX_ATTEMPTS || '5', 10);

export const TRANSLATION_RETRY_MINUTES = parseInt(process.env.TRANSLATION_RETRY_MINUTES || '15', 10);

export const translationFieldInFlight = new Map<string, Promise<TranslationExecutionResult>>();

export const SUPPORTED_LANGS = new Set(SUPPORTED_LANGUAGE_CODES);

export function hashStable(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function translateDynamicText(
  text: string,
  targetLang: string,
  options?: { sourceLang?: string | null; fieldName?: TranslationFieldName }
): Promise<TranslationExecutionResult> {
  const provider = 'openrouter';
  const modelFallbacks = await getAiModelChain('translation');
  const model = (modelFallbacks[0] || 'openrouter/free').trim();
  const apiKey = (process.env.TRANSLATION_API_KEY || process.env.AI_API_KEY || '').trim();
  const translationEnabled = (process.env.TRANSLATION_ENABLED || 'true').trim() === 'true';
  const customBaseUrl = (process.env.TRANSLATION_API_BASE_URL || '').trim().replace(/\/$/, '');
  if (!text.trim()) return { translated: text, provider, model, completed: true, attemptsUsed: 0, retryable: false };
  if (!translationEnabled) {
    return {
      translated: text,
      provider,
      model,
      completed: false,
      attemptsUsed: 0,
      retryable: false,
      errorCode: 'translation_disabled',
      errorMessage: 'Translation disabled',
    };
  }
  if (!apiKey) {
    return {
      translated: text,
      provider,
      model,
      completed: false,
      attemptsUsed: 0,
      retryable: true,
      errorCode: 'missing_api_key',
      errorMessage: 'Translation API key not configured',
    };
  }
  if (modelFallbacks.length === 0) {
    return {
      translated: text,
      provider,
      model,
      completed: false,
      attemptsUsed: 0,
      retryable: false,
      errorCode: 'missing_models',
      errorMessage: 'No translation models configured',
    };
  }

  const trimmed = text.trim().slice(0, 2000);
  const sourceLang = normalizeLanguageCode(options?.sourceLang) || detectSourceLanguage([trimmed]).language;
  const fieldName = options?.fieldName || 'description';

  const baseUrl = customBaseUrl || 'https://openrouter.ai/api/v1';
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (baseUrl.includes('openrouter')) {
    headers['HTTP-Referer'] = 'https://crisis-platform.com';
    headers['X-Title'] = 'UNDP Crisis Assessment Platform';
  }

  const fieldInstructions =
    fieldName === 'address_text'
      ? 'This is a location or address fragment. Preserve building names, districts, roads, landmarks, and directional terms exactly.'
      : fieldName === 'infra_name'
        ? 'This is a short infrastructure or building name. Keep it concise and preserve proper nouns exactly.'
        : 'This is a free-text crisis report description. Translate the full meaning faithfully without summarizing.';

  const messages = [
    {
      role: 'system',
      content: [
        'You are a strict translation engine for humanitarian crisis reports.',
        'Your only task is translation.',
        'Translate faithfully from the source language to the target language.',
        'Preserve names, proper nouns, place names, coordinates, IDs, numbers, dates, and units exactly.',
        'Do not answer with safety analysis, moderation labels, policy text, explanations, markdown, notes, or classifications.',
        'Do not anonymize, censor, summarize, transliterate unnecessarily, or replace content with placeholders.',
        'If the source already contains a name, keep that name. Never output tags like [PERSON_NAME], [LOCATION], [ADDRESS], or similar.',
        'If the input is an address or building name, translate generic words but preserve the specific place or facility name.',
        'Return only valid JSON with exactly one key: {"translated_text":"..."}',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Source language: ${sourceLang}`,
        `Target language: ${targetLang}`,
        `Field type: ${fieldName}`,
        fieldInstructions,
        'Rules:',
        '1. Output must be only JSON.',
        '2. translated_text must contain only the translation.',
        '3. Do not repeat the source text unchanged unless the text is a proper noun or identifier that should stay identical.',
        '4. Do not include any bracketed placeholder token unless it already exists in the source text.',
        '5. Do not include words such as "safety", "policy", "unsafe", or category labels unless they are literally present in the source text.',
        'Text to translate:',
        trimmed,
      ].join('\n'),
    },
  ];

  let attemptsUsed = 0;
  let sawRetryableFailure = false;
  let lastFailure: { code: string; message: string; model: string | null } | null = null;
  for (const attemptModel of modelFallbacks) {
    attemptsUsed += 1;
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(TRANSLATION_REQUEST_TIMEOUT_MS),
        headers,
        body: JSON.stringify({
          model: attemptModel,
          temperature: 0,
          max_tokens: 600,
          response_format: { type: 'json_object' },
          messages,
        }),
      });
      if (!resp.ok) {
        const detail = (await resp.text()).slice(0, 500);
        const retryable = resp.status === 408 || resp.status === 409 || resp.status === 425 || resp.status === 429 || resp.status >= 500;
        if (retryable) sawRetryableFailure = true;
        lastFailure = {
          code: retryable ? 'upstream_retryable' : 'upstream_model_unavailable',
          message: detail || `Upstream status ${resp.status}`,
          model: attemptModel,
        };
        logger.warn('report.translation.attempt.failed', { details: [JSON.stringify({
          targetLang,
          model: attemptModel,
          status: resp.status,
          detail,
        })] });
        continue;
      }
      const data = await resp.json() as any;
      const translated = extractTranslatedTextFromCompletion(data?.choices?.[0]?.message?.content);
      if (!translated) {
        lastFailure = {
          code: 'empty_content',
          message: 'Model returned empty translation content',
          model: attemptModel,
        };
        logger.warn('report.translation.attempt.failed', { details: [JSON.stringify({
          targetLang,
          model: attemptModel,
          status: 'empty_content',
        })] });
        continue;
      }
      if (
        hasInvalidTranslationText(translated)
        || introducesSyntheticPlaceholder(text, translated)
        || isLikelyUntranslatedSource(text, translated)
        || isLikelyWrongLanguageTranslation(translated, targetLang, sourceLang)
      ) {
        sawRetryableFailure = true;
        const syntheticPlaceholder = introducesSyntheticPlaceholder(text, translated);
        const translationRefusal = hasInvalidTranslationText(translated) && !hasTextCorruption(translated);
        const untranslatedSource = isLikelyUntranslatedSource(text, translated);
        const wrongLanguage = isLikelyWrongLanguageTranslation(translated, targetLang, sourceLang);
        lastFailure = {
          code: syntheticPlaceholder
            ? 'synthetic_placeholder'
            : wrongLanguage
              ? 'wrong_language'
            : untranslatedSource
              ? 'untranslated_source'
            : translationRefusal
              ? 'translation_refusal'
              : 'corrupted_translation',
          message: syntheticPlaceholder
            ? 'Model returned synthetic placeholder text'
            : wrongLanguage
              ? 'Model returned text in the wrong language'
            : untranslatedSource
              ? 'Model returned the original source text unchanged'
            : translationRefusal
              ? 'Model returned translation refusal or safety metadata'
            : 'Model returned corrupted translation text',
          model: attemptModel,
        };
        logger.warn('report.translation.attempt.failed', { details: [JSON.stringify({
          targetLang,
          model: attemptModel,
          status: syntheticPlaceholder
            ? 'synthetic_placeholder'
            : wrongLanguage
              ? 'wrong_language'
            : untranslatedSource
              ? 'untranslated_source'
            : translationRefusal
              ? 'translation_refusal'
              : 'corrupted_translation',
        })] });
        continue;
      }
      const resolvedModel = String(data?.model || attemptModel || '').trim() || attemptModel;
      console.info('[REPORT_TRANSLATION_SUCCESS]', JSON.stringify({
        targetLang,
        model: resolvedModel,
        usedFallback: resolvedModel !== model,
      }));
      return {
        translated,
        provider,
        model: resolvedModel,
        completed: true,
        attemptsUsed,
        retryable: false,
      };
    } catch (err: any) {
      sawRetryableFailure = true;
      lastFailure = {
        code: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'request_error',
        message: err instanceof Error ? err.message : String(err),
        model: attemptModel,
      };
      logger.warn('report.translation.attempt.failed', { details: [JSON.stringify({
        targetLang,
        model: attemptModel,
        status: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'request_error',
        detail: err instanceof Error ? err.message : String(err),
      })] });
    }
  }
  if (lastFailure?.code === 'synthetic_placeholder' && canFallbackToOriginalSource(text)) {
    console.info('[REPORT_TRANSLATION_FALLBACK_ORIGINAL]', JSON.stringify({
      targetLang,
      model: lastFailure.model || model,
      reason: 'synthetic_placeholder',
    }));
    return {
      translated: text,
      provider,
      model: lastFailure.model || model,
      completed: true,
      attemptsUsed,
      retryable: false,
    };
  }
  return {
    translated: text,
    provider,
    model: lastFailure?.model || model,
    completed: false,
    attemptsUsed,
    retryable: sawRetryableFailure,
    errorCode: lastFailure?.code || 'translation_failed',
    errorMessage: lastFailure?.message || 'Translation failed',
  };
}

export function extractTranslatedTextFromCompletion(content: unknown): string {
  const raw = String(content || '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return String((parsed as Record<string, unknown>).translated_text || '').trim();
    }
  } catch {
    // Some models still return plain text even when asked for JSON; allow it and validate later.
  }
  return raw;
}

export function extractSyntheticPlaceholders(value: string): string[] {
  return Array.from(new Set(String(value || '').match(/\[[A-Z][A-Z0-9_]{2,}\]/g) || []));
}

export function isLikelyUntranslatedSource(source: string, translated: string): boolean {
  const normalizedSource = String(source || '').trim();
  const normalizedTranslated = String(translated || '').trim();
  if (!normalizedSource || normalizedSource !== normalizedTranslated) return false;
  const words = normalizedSource.split(/\s+/).filter(Boolean);
  return words.length >= 4;
}

export function canFallbackToOriginalSource(source: string): boolean {
  const normalizedSource = String(source || '').trim();
  if (!normalizedSource) return false;
  const words = normalizedSource.split(/\s+/).filter(Boolean);
  return words.length <= 8 && !/[.!?]/.test(normalizedSource);
}

export function isLikelyWrongLanguageTranslation(translated: string, targetLang: string, sourceLang?: string | null): boolean {
  const normalizedTarget = normalizeLanguageCode(targetLang) || DEFAULT_LANGUAGE;
  const normalizedSource = normalizeLanguageCode(sourceLang || '') || null;
  const detected = detectSourceLanguage([translated], normalizedTarget);
  if (detected.language === normalizedTarget) return false;
  if (normalizedSource && detected.language === normalizedSource && detected.confidence >= 0.72) return true;
  return detected.confidence >= 0.9;
}

export function introducesSyntheticPlaceholder(source: string, translated: string): boolean {
  const sourcePlaceholders = new Set(extractSyntheticPlaceholders(source));
  return extractSyntheticPlaceholders(translated).some((placeholder) => !sourcePlaceholders.has(placeholder));
}

export async function getCachedTranslationRow(reportId: string, fieldName: string, targetLang: string): Promise<CachedTranslationRow | undefined> {
  return queryOne<CachedTranslationRow>(
    'SELECT translated_text, source_hash FROM report_translations WHERE report_id = ? AND field_name = ? AND target_lang = ?',
    [reportId, fieldName, targetLang]
  );
}

export async function persistTranslation(
  reportId: string,
  fieldName: string,
  targetLang: string,
  sourceLang: string | null | undefined,
  sourceHash: string,
  translated: TranslationExecutionResult
): Promise<void> {
  await execute(
    `INSERT INTO report_translations (id, report_id, field_name, target_lang, source_lang, translated_text, source_hash, provider, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (report_id, field_name, target_lang)
     DO UPDATE SET source_lang = EXCLUDED.source_lang, translated_text = EXCLUDED.translated_text, source_hash = EXCLUDED.source_hash, provider = EXCLUDED.provider, model = EXCLUDED.model, updated_at = NOW()`,
    [uuidv4(), reportId, fieldName, targetLang, sourceLang || null, translated.translated, sourceHash, translated.provider, translated.model]
  );
}

export async function getCachedTranslation(reportId: string, fieldName: string, source: string, targetLang: string): Promise<CachedTranslationLookupResult> {
  if (!source || !SUPPORTED_LANGS.has(targetLang)) {
    return { text: source, completed: true, provider: 'none', model: null };
  }
  const sourceHash = hashStable(source);
  const cached = await getCachedTranslationRow(reportId, fieldName, targetLang);
  const staleOrInvalidCached =
    cached
    && cached.source_hash === sourceHash
    && (
      hasInvalidTranslationText(cached.translated_text)
      || isLikelyUntranslatedSource(source, cached.translated_text)
    );
  if (staleOrInvalidCached) {
    await execute(
      'DELETE FROM report_translations WHERE report_id = ? AND field_name = ? AND target_lang = ? AND source_hash = ?',
      [reportId, fieldName, targetLang, sourceHash]
    );
  }
  if (
    cached
    && cached.source_hash === sourceHash
    && !hasInvalidTranslationText(cached.translated_text)
    && !isLikelyUntranslatedSource(source, cached.translated_text)
  ) {
    return { text: cached.translated_text, completed: true, provider: 'cache', model: null };
  }
  return { text: source, completed: false, provider: 'cache_miss', model: null };
}

export function getTranslationInFlightKey(reportId: string, fieldName: string, targetLang: string) {
  return `${reportId}:${fieldName}:${targetLang}`;
}

export async function translateAndPersistField(
  reportId: string,
  fieldName: string,
  source: string,
  targetLang: string,
  sourceLang?: string | null
): Promise<TranslationExecutionResult> {
  const cached = await getCachedTranslation(reportId, fieldName, source, targetLang);
  if (cached.completed) {
    return {
      translated: cached.text,
      completed: true,
      provider: cached.provider,
      model: cached.model,
      attemptsUsed: 0,
      retryable: false,
    };
  }
  const key = getTranslationInFlightKey(reportId, fieldName, targetLang);
  const existing = translationFieldInFlight.get(key);
  if (existing) return existing;

  const sourceHash = hashStable(source);
  const task = (async () => {
    const translated = await translateDynamicText(source, targetLang, {
      sourceLang,
      fieldName: fieldName as TranslationFieldName,
    });
    if (translated.completed) {
      await persistTranslation(reportId, fieldName, targetLang, sourceLang, sourceHash, translated);
    }
    return translated;
  })();
  translationFieldInFlight.set(key, task);
  try {
    return await task;
  } finally {
    translationFieldInFlight.delete(key);
  }
}

export async function getTranslationRows(reportIds: string[], targetLangs: string[] = [DEFAULT_LANGUAGE]): Promise<TranslationRow[]> {
  if (reportIds.length === 0 || targetLangs.length === 0) return [];
  const uniqueReportIds = Array.from(new Set(reportIds));
  const uniqueTargetLangs = Array.from(new Set(targetLangs.map((lang) => normalizeLanguageCode(lang)).filter(Boolean) as string[]));
  if (uniqueTargetLangs.length === 0) return [];
  const reportPlaceholders = uniqueReportIds.map(() => '?').join(',');
  const targetPlaceholders = uniqueTargetLangs.map(() => '?').join(',');
  return queryAll<TranslationRow>(
    `SELECT report_id, field_name, target_lang, translated_text
     FROM report_translations
     WHERE report_id IN (${reportPlaceholders})
       AND target_lang IN (${targetPlaceholders})`,
    [...uniqueReportIds, ...uniqueTargetLangs]
  );
}

export async function attachTranslations(report: any, targetLangs: string[] = [DEFAULT_LANGUAGE]) {
  const rows = await getTranslationRows([report.id], targetLangs);
  const translations = sanitizeReportTranslations(report, buildTranslationsObject(rows));
  return {
    ...report,
    translations,
  };
}

export async function attachTranslationsToMany(reports: any[], targetLangs: string[] = [DEFAULT_LANGUAGE]) {
  const rows = await getTranslationRows(reports.map((report) => String(report.id)), targetLangs);
  const byReport = rows.reduce<Record<string, TranslationRow[]>>((acc, row) => {
    if (!acc[row.report_id]) acc[row.report_id] = [];
    acc[row.report_id].push(row);
    return acc;
  }, {});
  return reports.map((report) => ({
    ...report,
    translations: sanitizeReportTranslations(report, buildTranslationsObject(byReport[String(report.id)] || [])),
  }));
}

export async function setStoredTranslationStatus(reportId: string, status: RequestedTranslationStatus): Promise<void> {
  await execute('UPDATE reports SET translation_status = ? WHERE id = ?', [status, reportId]);
}

export async function getTranslationJob(reportId: string, targetLang: string): Promise<TranslationJobRow | undefined> {
  return queryOne<TranslationJobRow>(
    'SELECT * FROM translation_jobs WHERE report_id = ? AND target_lang = ?',
    [reportId, targetLang]
  );
}

export async function getTranslationJobs(reportIds: string[], targetLangs: string[]): Promise<TranslationJobRow[]> {
  if (reportIds.length === 0 || targetLangs.length === 0) return [];
  const uniqueReportIds = Array.from(new Set(reportIds));
  const uniqueTargetLangs = Array.from(new Set(targetLangs.map((lang) => normalizeLanguageCode(lang)).filter(Boolean) as string[]));
  if (uniqueTargetLangs.length === 0) return [];
  const reportPlaceholders = uniqueReportIds.map(() => '?').join(',');
  const targetPlaceholders = uniqueTargetLangs.map(() => '?').join(',');
  return queryAll<TranslationJobRow>(
    `SELECT * FROM translation_jobs
     WHERE report_id IN (${reportPlaceholders})
       AND target_lang IN (${targetPlaceholders})`,
    [...uniqueReportIds, ...uniqueTargetLangs]
  );
}

export function buildTranslationJobMap(jobs: TranslationJobRow[]): Map<string, TranslationJobRow> {
  return new Map(jobs.map((job) => [`${job.report_id}:${job.target_lang}`, job]));
}

export function getTranslatableValues(report: any) {
  return TRANSLATABLE_FIELDS.reduce<Partial<Record<TranslatableField, string>>>((acc, field) => {
    const value = String(report[field] || '').trim();
    if (value) acc[field] = value;
    return acc;
  }, {});
}

export function sanitizeReportTranslations(report: any, translations: Record<string, Partial<Record<TranslatableField, string>>>) {
  const sanitized: Record<string, Partial<Record<TranslatableField, string>>> = {};
  for (const [targetLang, fields] of Object.entries(translations || {})) {
    for (const field of TRANSLATABLE_FIELDS) {
      const translated = fields?.[field];
      const source = String(report?.[field] || '').trim();
      if (!translated) continue;
      if (source && isLikelyUntranslatedSource(source, translated)) continue;
      if (!sanitized[targetLang]) sanitized[targetLang] = {};
      sanitized[targetLang][field] = translated;
    }
  }
  return sanitized;
}

export function deriveTranslationState(
  report: any,
  targetLang: string,
  job?: TranslationJobRow
): TranslationState {
  const normalizedTarget = normalizeLanguageCode(targetLang) || DEFAULT_LANGUAGE;
  const sourceLang = normalizeLanguageCode(report.source_language) || DEFAULT_LANGUAGE;
  const values = getTranslatableValues(report);
  const missingFields = TRANSLATABLE_FIELDS.filter((field) => {
    const sourceValue = values[field];
    if (!sourceValue) return false;
    const translatedValue = report.translations?.[normalizedTarget]?.[field];
    if (!translatedValue) return true;
    return isLikelyUntranslatedSource(sourceValue, translatedValue);
  });
  const hasContent = Object.keys(values).length > 0;

  if (!hasContent || sourceLang === normalizedTarget) {
    return { targetLang: normalizedTarget, sourceLang, status: 'not_needed', missingFields: [], hasContent };
  }
  if (missingFields.length === 0) {
    return { targetLang: normalizedTarget, sourceLang, status: 'completed', missingFields, hasContent };
  }
  if (job?.status === 'failed_terminal') {
    return { targetLang: normalizedTarget, sourceLang, status: 'failed', missingFields, hasContent };
  }
  if (job && ['pending', 'processing', 'retry_wait'].includes(job.status)) {
    return { targetLang: normalizedTarget, sourceLang, status: 'pending', missingFields, hasContent };
  }
  return { targetLang: normalizedTarget, sourceLang, status: 'pending', missingFields, hasContent };
}

export function applyRequestedTranslationState<T extends Report>(report: T, state: TranslationState): T {
  return {
    ...report,
    translation_status: state.status,
    translation_target_lang: state.targetLang,
  };
}

export async function enqueueTranslationJob(reportId: string, targetLang = DEFAULT_LANGUAGE): Promise<TranslationJobRow | undefined> {
  await execute(
    `INSERT INTO translation_jobs (id, report_id, target_lang, status, attempt_count, next_attempt_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, NOW(), NOW())
     ON CONFLICT (report_id, target_lang) DO UPDATE SET
       status = CASE
         WHEN translation_jobs.status = 'processing' THEN 'processing'
         ELSE 'pending'
       END,
       next_attempt_at = CASE
         WHEN translation_jobs.status = 'processing' THEN translation_jobs.next_attempt_at
         ELSE NOW()
       END,
       updated_at = NOW()`,
    [uuidv4(), reportId, targetLang]
  );
  return getTranslationJob(reportId, targetLang);
}

export async function acquireTranslationJob(): Promise<TranslationJobRow | undefined> {
  return queryOne<TranslationJobRow>(
    `UPDATE translation_jobs
     SET status = 'processing', locked_at = NOW(), updated_at = NOW()
     WHERE id = (
       SELECT id
       FROM translation_jobs
       WHERE status IN ('pending', 'retry_wait')
         AND next_attempt_at <= NOW()
         AND (locked_at IS NULL OR locked_at <= (NOW() - (? * INTERVAL '1 minute')))
       ORDER BY next_attempt_at ASC
       LIMIT 1
     )
     RETURNING *`,
    [TRANSLATION_LOCK_MINUTES]
  );
}

export async function updateTranslationJob(jobId: string, fields: Partial<TranslationJobRow>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.status !== undefined) { sets.push('status = ?'); params.push(fields.status); }
  if (fields.attempt_count !== undefined) { sets.push('attempt_count = ?'); params.push(fields.attempt_count); }
  if (fields.next_attempt_at !== undefined) { sets.push('next_attempt_at = ?'); params.push(fields.next_attempt_at); }
  if (fields.last_error_message !== undefined) { sets.push('last_error_message = ?'); params.push(fields.last_error_message); }
  if (fields.last_provider !== undefined) { sets.push('last_provider = ?'); params.push(fields.last_provider); }
  if (fields.last_model !== undefined) { sets.push('last_model = ?'); params.push(fields.last_model); }
  if (fields.locked_at !== undefined) { sets.push('locked_at = ?'); params.push(fields.locked_at); }
  if (sets.length === 0) return;
  params.push(jobId);
  await execute(`UPDATE translation_jobs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params as any[]);
}

export async function processTranslationJob(job: TranslationJobRow): Promise<void> {
  const report = await queryOne<any>('SELECT id, description, address_text, building_label, infra_name, source_language, translation_status FROM reports WHERE id = ?', [job.report_id]);
  if (!report) {
    await updateTranslationJob(job.id, { status: 'failed_terminal', locked_at: null, last_error_message: 'Report not found' });
    return;
  }

  const sourceLang = normalizeLanguageCode(report.source_language) || DEFAULT_LANGUAGE;
  const values = getTranslatableValues(report);
  if (Object.keys(values).length === 0 || sourceLang === job.target_lang) {
    await setStoredTranslationStatus(job.report_id, 'not_needed');
    await updateTranslationJob(job.id, { status: 'completed', locked_at: null, last_error_message: null });
    return;
  }

  let completedAll = true;
  let lastProvider: string | null = null;
  let lastModel: string | null = null;
  let totalAttemptsUsed = 0;
  let shouldRetry = false;
  let terminalFailure = false;
  let lastErrorMessage: string | null = null;
  for (const field of TRANSLATABLE_FIELDS) {
    const value = values[field];
    if (!value) continue;
    const translated = await translateAndPersistField(job.report_id, field, value, job.target_lang, sourceLang);
    completedAll = completedAll && translated.completed;
    lastProvider = translated.provider;
    lastModel = translated.model;
    totalAttemptsUsed += translated.attemptsUsed;
    if (!translated.completed) {
      shouldRetry = shouldRetry || translated.retryable;
      terminalFailure = terminalFailure || !translated.retryable;
      lastErrorMessage = translated.errorMessage || lastErrorMessage;
    }
  }

  if (completedAll) {
    await setStoredTranslationStatus(job.report_id, 'completed');
    await updateTranslationJob(job.id, {
      status: 'completed',
      locked_at: null,
      last_error_message: null,
      last_provider: lastProvider,
      last_model: lastModel,
      next_attempt_at: null,
      attempt_count: job.attempt_count + totalAttemptsUsed,
    });
    return;
  }

  const attemptIncrement = Math.max(1, totalAttemptsUsed);
  const attempts = job.attempt_count + attemptIncrement;
  const terminal = terminalFailure || attempts >= TRANSLATION_MAX_ATTEMPTS || !shouldRetry;
  await setStoredTranslationStatus(job.report_id, 'failed');
  await updateTranslationJob(job.id, {
    status: terminal ? 'failed_terminal' : 'retry_wait',
    locked_at: null,
    attempt_count: attempts,
    next_attempt_at: terminal ? null : new Date(Date.now() + (TRANSLATION_RETRY_MINUTES * 60 * 1000)).toISOString(),
    last_error_message: lastErrorMessage || 'Translation unavailable or pending upstream response',
    last_provider: lastProvider,
    last_model: lastModel,
  });
}

export async function resolveTranslationsForMany(
  reports: any[],
  targetLang: string,
  options?: { queueMissing?: boolean; retryFailed?: boolean }
) {
  const normalizedTarget = normalizeLanguageCode(targetLang) || DEFAULT_LANGUAGE;
  const queueMissing = options?.queueMissing ?? true;
  const retryFailed = options?.retryFailed ?? false;
  const withTranslations = await attachTranslationsToMany(reports, [normalizedTarget]);
  const jobs = buildTranslationJobMap(await getTranslationJobs(withTranslations.map((report) => String(report.id)), [normalizedTarget]));

  const resolvedReports: Report[] = [];
  for (const report of withTranslations) {
    const job = jobs.get(`${report.id}:${normalizedTarget}`);
    const state = deriveTranslationState(report, normalizedTarget, job);
    const shouldEnqueue =
      queueMissing
      && state.missingFields.length > 0
      && (
        !job
        || job.status === 'completed'
        || (retryFailed && job.status === 'failed_terminal')
      );

    if (shouldEnqueue) {
      await enqueueTranslationJob(report.id, normalizedTarget);
    }
    resolvedReports.push(applyRequestedTranslationState(
      report,
      shouldEnqueue ? { ...state, status: 'pending' } : state
    ));
  }

  return resolvedReports;
}

export let translationWorkerStarted = false;

export async function reconcileCorruptedStoredReportTranslations(): Promise<void> {
  const rows = await queryAll<{
    report_id: string;
    target_lang: string;
    field_name: string;
    translated_text?: string | null;
  }>('SELECT report_id, target_lang, field_name, translated_text FROM report_translations');

  const affected = new Map<string, { reportId: string; targetLang: string }>();
  for (const row of rows) {
    if (!hasInvalidTranslationText(row.translated_text)) continue;
    await execute(
      'DELETE FROM report_translations WHERE report_id = ? AND target_lang = ? AND field_name = ?',
      [row.report_id, row.target_lang, row.field_name]
    );
    affected.set(`${row.report_id}:${row.target_lang}`, {
      reportId: row.report_id,
      targetLang: normalizeLanguageCode(row.target_lang) || DEFAULT_LANGUAGE,
    });
  }

  for (const { reportId, targetLang } of affected.values()) {
    await setStoredTranslationStatus(reportId, 'pending');
    await enqueueTranslationJob(reportId, targetLang);
  }
}

export function startTranslationWorker() {
  if (translationWorkerStarted) return;
  translationWorkerStarted = true;
  setInterval(async () => {
    try {
      // Translation runs out-of-band so report submission is never blocked on AI latency or upstream
      // provider health; the worker backfills localized fields after the source record is stored.
      const job = await acquireTranslationJob();
      if (!job) return;
      await processTranslationJob(job);
    } catch (error) {
      logger.error('worker.translation.failed', { error });
    }
  }, TRANSLATION_POLL_MS).unref?.();
}
