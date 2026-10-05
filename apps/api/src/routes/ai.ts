import { logger } from '../observability/logger';
import { buildDeterministicSitrep, applySitrepScopeAndDedup, resolveFocusAreaScope, sanitizeSitrepContent, SitrepCompositionContext, ResolvedSitrepScope, parseBboxString, SitrepStats, SitrepFiltersSnapshot } from '../ai/sitrepComposition';
import { normalizeClassificationPayload, parseStoredClassification, ClassificationResult } from '../ai/classification';
import express, { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { queryAll, queryOne, execute } from '../dbRuntime';
import { authMiddleware, requireRole } from '../middleware/auth';
import { readMediaBuffer } from '../media';
import { resolveReportMedia } from '../reportMedia';
import { attachTranslationsToMany, formatReport } from './reports';
import { syncReportPhotoQualityFromAi } from '../services/contributorReputation';
import { AI_MODEL_LIST_REQUEST_TIMEOUT_MS, AI_REQUEST_TIMEOUT_MS, getAiModelChain, getAiSetting, getPublicAiSettings, setAiSetting } from '../services/aiSettings';
import { getModerationSettings } from '../services/moderationSettings';

const router = express.Router();
const AI_ENV_KEY = process.env.AI_API_KEY || '';
const AI_ALLOW_INSECURE_TLS = process.env.AI_ALLOW_INSECURE_TLS === 'true';
const STRICT_INTEGRATIONS = process.env.NODE_ENV === 'production' || process.env.STRICT_INTEGRATIONS === 'true';
const AI_CLASSIFY_MAX_PER_MINUTE = parseInt(process.env.AI_CLASSIFY_MAX_PER_MINUTE || '20', 10);
const AI_CLASSIFY_MAX_PER_DAY = parseInt(process.env.AI_CLASSIFY_MAX_PER_DAY || '1000', 10);
const AI_CLASSIFY_POLL_MS = parseInt(process.env.AI_CLASSIFY_POLL_MS || '15000', 10);
const AI_CLASSIFY_LOCK_MINUTES = parseInt(process.env.AI_CLASSIFY_LOCK_MINUTES || '2', 10);
const FREE_VISION_MODELS = [
  'google/gemma-4-31b-it:free',
  'nex-agi/nex-n2-pro:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'openai/gpt-5-nano',
  'amazon/nova-lite-v1',
  'google/gemma-3-12b-it',
  'mistralai/mistral-small-3.2-24b-instruct',
] as const;
const FREE_TEXT_MODELS = [
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-4-scout:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'deepseek/deepseek-r1-0528:free',
  'mistralai/devstral-small:free',
  'google/gemma-3-27b-it:free',
  'qwen/qwen3-coder:free',
] as const;

// AI settings are initialized after schema migrations during worker startup.

class UpstreamModelError extends Error {
  httpStatus: number;
  providerCode: string | number | null;
  endpointType: 'classify' | 'sitrep';
  model: string;
  retryable: boolean;
  raw: string;
  constructor(message: string, opts: {
    httpStatus: number;
    providerCode: string | number | null;
    endpointType: 'classify' | 'sitrep';
    model: string;
    retryable: boolean;
    raw: string;
  }) {
    super(message);
    this.httpStatus = opts.httpStatus;
    this.providerCode = opts.providerCode;
    this.endpointType = opts.endpointType;
    this.model = opts.model;
    this.retryable = opts.retryable;
    this.raw = opts.raw;
  }
}

class InvalidImagePayloadError extends Error {}
class QuotaExhaustedError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super('Classification quota exhausted');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type ClassifyJobRow = {
  id: string;
  report_id: string;
  status: 'pending' | 'processing' | 'retry_wait' | 'completed' | 'failed_terminal';
  attempt_count: number;
  next_attempt_at?: string;
  last_error_code?: string | null;
  last_error_message?: string | null;
  last_model?: string | null;
  locked_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

function parseProviderErrorPayload(raw: string): { code: string | number | null; message: string } {
  try {
    const parsed = JSON.parse(raw);
    const err = parsed?.error || parsed;
    return {
      code: err?.code ?? null,
      message: String(err?.message || raw || 'Unknown upstream error'),
    };
  } catch {
    return { code: null, message: raw || 'Unknown upstream error' };
  }
}

function isRetryableUpstreamStatus(status: number): boolean {
  return status === 429 || status === 404 || status >= 500;
}

function isRetryableProviderLimitMessage(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('key limit exceeded')
    || normalized.includes('rate limit')
    || normalized.includes('quota')
    || normalized.includes('credit limit')
    || normalized.includes('insufficient credits')
    || normalized.includes('payment required');
}

function isRetryableAiTransportError(err: unknown): boolean {
  const message = String((err as Error)?.message || '').toLowerCase();
  const code = String((err as { cause?: { code?: string }; code?: string })?.cause?.code || (err as { code?: string })?.code || '').toUpperCase();
  return message.includes('fetch failed')
    || message.includes('network')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('abort')
    || message.includes('tls')
    || message.includes('certificate')
    || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    || code === 'SELF_SIGNED_CERT_IN_CHAIN'
    || code === 'CERT_HAS_EXPIRED'
    || code === 'ECONNRESET'
    || code === 'EAI_AGAIN'
    || code === 'ENETUNREACH'
    || code === 'ETIMEDOUT'
    || code === 'ECONNREFUSED'
    || code === 'EACCES';
}

function canRerunFailedClassification(code: string | null | undefined, message?: string | null): boolean {
  const normalizedCode = String(code || '').trim();
  if (['report_not_found', 'no_photos', 'missing_media', 'invalid_media', 'invalid_image_payload'].includes(normalizedCode)) {
    return false;
  }
  return Boolean(normalizedCode) || Boolean(String(message || '').trim());
}

function logAiFailure(meta: {
  endpointType: 'classify' | 'sitrep';
  model: string;
  imageMime?: string;
  imageBytes?: number;
  upstreamStatus?: number;
  upstreamCode?: string | number | null;
  message: string;
}) {
  logger.error('ai.upstream.failure', { details: [JSON.stringify(meta)] });
}

function logAiSuccess(meta: {
  endpointType: 'classify' | 'sitrep';
  model: string;
  attemptsUsed: number;
}) {
  console.info('[AI_UPSTREAM_SUCCESS]', JSON.stringify(meta));
}

async function normalizeImageDataUrl(photoKey: string): Promise<{ dataUrl: string; mime: string; bytes: number }> {
  let input: Buffer;
  try {
    input = await readMediaBuffer(photoKey);
  } catch {
    throw new InvalidImagePayloadError('Image file missing or unreadable');
  }

  try {
    const converted = await sharp(input)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
    if (!converted.length) throw new InvalidImagePayloadError('Image normalization produced empty output');
    const mime = 'image/jpeg';
    return { dataUrl: `data:${mime};base64,${converted.toString('base64')}`, mime, bytes: converted.length };
  } catch {
    throw new InvalidImagePayloadError('Unsupported, corrupted, or invalid image payload');
  }
}

function parseJsonObject<T extends Record<string, unknown>>(raw: unknown, fallback: T): T {
  try {
    if (!raw) return fallback;
    if (typeof raw === 'object') return { ...fallback, ...(raw as T) };
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return { ...fallback, ...(parsed as T) };
  } catch {
    return fallback;
  }
}

function parseJsonArray(raw: unknown): string[] {
  try {
    if (Array.isArray(raw)) return raw.map((value) => String(value)).filter(Boolean);
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.map((value) => String(value)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function recordClassifyAttempt(reportId: string, model: string, outcomeCode: string): Promise<void> {
  await execute(
    'INSERT INTO ai_classify_attempts (report_id, model, endpoint_type, outcome_code) VALUES (?, ?, ?, ?)',
    [reportId, model, 'classify', outcomeCode]
  );
}

async function getClassifyQuotaUsage(): Promise<{ minuteCount: number; dayCount: number }> {
  const minuteRow = await queryOne<{ c: string | number }>(
    "SELECT COUNT(*) as c FROM ai_classify_attempts WHERE endpoint_type = 'classify' AND created_at >= (NOW() - INTERVAL '1 minute')"
  );
  const dayRow = await queryOne<{ c: string | number }>(
    "SELECT COUNT(*) as c FROM ai_classify_attempts WHERE endpoint_type = 'classify' AND created_at >= (NOW() - INTERVAL '1 day')"
  );
  return {
    minuteCount: Number(minuteRow?.c || 0),
    dayCount: Number(dayRow?.c || 0),
  };
}

async function ensureClassifyQuota(): Promise<void> {
  const usage = await getClassifyQuotaUsage();
  if (usage.minuteCount >= AI_CLASSIFY_MAX_PER_MINUTE) throw new QuotaExhaustedError(60);
  if (usage.dayCount >= AI_CLASSIFY_MAX_PER_DAY) throw new QuotaExhaustedError(3600);
}

function computeRetryDelayMs(attemptCount: number, errorCode: string): number {
  const base = errorCode === 'upstream_rate_limited' ? 60_000 : errorCode === 'upstream_model_unavailable' ? 30_000 : 20_000;
  const boundedAttempt = Math.max(1, Math.min(attemptCount, 6));
  const jitter = Math.floor(Math.random() * 5000);
  return base * boundedAttempt + jitter;
}

async function getClassifyJob(reportId: string): Promise<ClassifyJobRow | undefined> {
  return queryOne<ClassifyJobRow>('SELECT * FROM ai_classify_jobs WHERE report_id = ?', [reportId]);
}

async function reconcilePendingClassificationJobs(): Promise<number> {
  const inserted = await queryOne<{ inserted_count: string | number }>(`
    WITH seeded AS (
      INSERT INTO ai_classify_jobs (id, report_id, status, attempt_count, next_attempt_at, created_at, updated_at)
      SELECT
        'job_' || r.id,
        r.id,
        'pending',
        0,
        NOW(),
        NOW(),
        NOW()
      FROM reports r
      LEFT JOIN ai_classify_jobs j ON j.report_id = r.id
      WHERE r.ai_classification_status = 'pending'
        AND r.ai_classification IS NULL
        AND j.report_id IS NULL
      ON CONFLICT (report_id) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) AS inserted_count FROM seeded
  `);
  return Number(inserted?.inserted_count || 0);
}

async function reviveRecoverableClassificationJobs(): Promise<number> {
  const revived = await queryOne<{ revived_count: string | number }>(`
    WITH revived_jobs AS (
      UPDATE ai_classify_jobs
      SET status = 'retry_wait',
          next_attempt_at = NOW(),
          locked_at = NULL,
          last_error_code = NULL,
          last_error_message = NULL,
          last_model = NULL,
          updated_at = NOW()
      WHERE status = 'failed_terminal'
        AND (
          last_error_code IN ('missing_api_key', 'upstream_rate_limited', 'upstream_model_unavailable', 'quota_exhausted', 'network_error')
          OR lower(COALESCE(last_error_message, '')) LIKE '%key limit exceeded%'
          OR lower(COALESCE(last_error_message, '')) LIKE '%rate limit%'
          OR lower(COALESCE(last_error_message, '')) LIKE '%quota%'
          OR lower(COALESCE(last_error_message, '')) LIKE '%credit limit%'
          OR lower(COALESCE(last_error_message, '')) LIKE '%insufficient credits%'
          OR lower(COALESCE(last_error_message, '')) LIKE '%payment required%'
          OR lower(COALESCE(last_error_message, '')) LIKE '%fetch failed%'
          OR lower(COALESCE(last_error_message, '')) LIKE '%network%'
          OR lower(COALESCE(last_error_message, '')) LIKE '%timeout%'
        )
      RETURNING report_id
    ), revived_reports AS (
      UPDATE reports
      SET ai_classification_status = 'pending',
          ai_classification_error = NULL
      WHERE id IN (SELECT report_id FROM revived_jobs)
        AND ai_classification IS NULL
      RETURNING id
    )
    SELECT COUNT(*) AS revived_count FROM revived_reports
  `);
  return Number(revived?.revived_count || 0);
}

async function upsertClassifyJob(reportId: string): Promise<ClassifyJobRow> {
  const row = await queryOne<ClassifyJobRow>(`
    INSERT INTO ai_classify_jobs (id, report_id, status, attempt_count, next_attempt_at, updated_at)
    VALUES (?, ?, 'pending', 0, NOW(), NOW())
    ON CONFLICT (report_id)
    DO UPDATE SET
      status = CASE
        WHEN ai_classify_jobs.status IN ('completed', 'failed_terminal', 'processing') THEN ai_classify_jobs.status
        ELSE 'pending'
      END,
      next_attempt_at = CASE
        WHEN ai_classify_jobs.status IN ('completed', 'failed_terminal', 'processing') THEN ai_classify_jobs.next_attempt_at
        ELSE NOW()
      END,
      updated_at = NOW()
    RETURNING *
  `, [randomUUID(), reportId]);
  if (!row) throw new Error('Failed to upsert classify job');
  return row;
}

async function updateClassifyJob(jobId: string, patch: Partial<ClassifyJobRow> & { next_attempt_at?: string | null }): Promise<void> {
  const sets: string[] = [];
  const params: any[] = [];
  const entries = Object.entries(patch);
  for (const [key, value] of entries) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  sets.push('updated_at = NOW()');
  params.push(jobId);
  await execute(`UPDATE ai_classify_jobs SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function tryAcquireNextClassifyJob(): Promise<ClassifyJobRow | undefined> {
  return queryOne<ClassifyJobRow>(`
    UPDATE ai_classify_jobs
    SET status = 'processing', locked_at = NOW(), updated_at = NOW()
    WHERE id = (
      SELECT id FROM ai_classify_jobs
      WHERE status IN ('pending', 'retry_wait')
        AND next_attempt_at <= NOW()
        AND (locked_at IS NULL OR locked_at < (NOW() - INTERVAL '${AI_CLASSIFY_LOCK_MINUTES} minutes'))
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT 1
    )
    RETURNING *
  `);
}

async function callOpenAI(messages: any[], model: string, apiKey: string, endpointType: 'classify' | 'sitrep', maxTokens = 500): Promise<string> {
  const baseUrl = 'https://openrouter.ai/api/v1';
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://crisis-platform.com',
    'X-Title': 'UNDP Crisis Assessment Platform',
  };
  const previousTlsMode = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (AI_ALLOW_INSECURE_TLS) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  let resp: globalThis.Response;
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.3 }),
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    }).catch((err: any) => {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new UpstreamModelError(`Model request timed out for ${model}`, {
          httpStatus: 504,
          providerCode: 'timeout',
          endpointType,
          model,
          retryable: true,
          raw: 'timeout',
        });
      }
      const causeCode = String(err?.cause?.code || '');
      const causeMessage = String(err?.cause?.message || err?.message || 'fetch failed');
      if (causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || causeCode === 'SELF_SIGNED_CERT_IN_CHAIN' || causeCode === 'CERT_HAS_EXPIRED') {
        throw new UpstreamModelError(`TLS verification failed for ${model}: ${causeMessage}`, {
          httpStatus: 503,
          providerCode: 'tls_verification_failed',
          endpointType,
          model,
          retryable: true,
          raw: causeMessage.slice(0, 500),
        });
      }
      if (causeCode === 'ECONNRESET' || causeCode === 'EAI_AGAIN' || causeCode === 'ENETUNREACH' || causeCode === 'ETIMEDOUT' || causeCode === 'ECONNREFUSED' || causeCode === 'EACCES') {
        throw new UpstreamModelError(`Network request failed for ${model}: ${causeMessage}`, {
          httpStatus: 503,
          providerCode: 'network_error',
          endpointType,
          model,
          retryable: true,
          raw: causeMessage.slice(0, 500),
        });
      }
      if (isRetryableAiTransportError(err)) {
        throw new UpstreamModelError(`Network request failed for ${model}: ${causeMessage}`, {
          httpStatus: 503,
          providerCode: 'network_error',
          endpointType,
          model,
          retryable: true,
          raw: causeMessage.slice(0, 500),
        });
      }
      throw err;
    });
  } finally {
    if (AI_ALLOW_INSECURE_TLS) {
      if (previousTlsMode === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsMode;
    }
  }
  if (!resp.ok) {
    const err = await resp.text();
    const parsed = parseProviderErrorPayload(err);
    throw new UpstreamModelError(parsed.message, {
      httpStatus: resp.status,
      providerCode: parsed.code,
      endpointType,
      model,
      retryable: isRetryableUpstreamStatus(resp.status),
      raw: err.slice(0, 500),
    });
  }
  const data = await resp.json() as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new UpstreamModelError(`Model returned no text content for ${model}`, {
      httpStatus: 502,
      providerCode: 'empty_content',
      endpointType,
      model,
      retryable: true,
      raw: JSON.stringify(data).slice(0, 500),
    });
  }
  return content.trim();
}

export async function callWithFallback(
  messages: any[],
  models: string[],
  apiKey: string,
  endpointType: 'classify' | 'sitrep',
  maxTokens: number,
  onBeforeAttempt?: (model: string) => Promise<void> | void,
  onAttempt?: (model: string, outcomeCode: string, err?: UpstreamModelError) => Promise<void> | void,
  validateText?: (text: string, model: string) => Promise<void> | void
): Promise<{ text: string; model: string; attemptsUsed: number }> {
  const attempts = models.length ? models : [endpointType === 'classify' ? FREE_VISION_MODELS[0] : FREE_VISION_MODELS[1]];
  let lastErr: unknown;
  let attemptsUsed = 0;
  for (const model of attempts) {
    try {
      await onBeforeAttempt?.(model);
      attemptsUsed += 1;
      const text = await callOpenAI(messages, model, apiKey, endpointType, maxTokens);
      try {
        await validateText?.(text, model);
      } catch (err) {
        if (err instanceof UpstreamModelError) throw err;
        throw new UpstreamModelError(`Model returned invalid response for ${model}`, {
          httpStatus: 502,
          providerCode: 'invalid_response',
          endpointType,
          model,
          retryable: true,
          raw: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        });
      }
      await onAttempt?.(model, 'success');
      return { text, model, attemptsUsed };
    } catch (err) {
      lastErr = err;
      if (err instanceof UpstreamModelError) {
        await onAttempt?.(model, String(err.providerCode || err.httpStatus || 'provider_error'), err);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('No model attempts were executed');
}

function mapAiErrorToHttp(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof InvalidImagePayloadError) {
    return { status: 422, body: { error: err.message, code: 'invalid_image_payload' } };
  }
  if (err instanceof UpstreamModelError) {
    const msg = err.message.toLowerCase();
    if (err.httpStatus === 429 || isRetryableProviderLimitMessage(msg)) {
      return { status: 429, body: { error: err.message, code: 'upstream_rate_limited', retryable: true, model: err.model, endpoint: err.endpointType } };
    }
    if (msg.includes('cannot identify image file') || msg.includes('unable to process input image')) {
      return { status: 422, body: { error: err.message, code: 'invalid_image_payload', model: err.model, endpoint: err.endpointType } };
    }
    if (err.httpStatus === 404 || err.httpStatus >= 500) {
      return { status: 502, body: { error: err.message, code: 'upstream_model_unavailable', retryable: true, model: err.model, endpoint: err.endpointType } };
    }
    return { status: 502, body: { error: err.message, code: 'upstream_provider_error', retryable: false, model: err.model, endpoint: err.endpointType } };
  }
  return { status: 500, body: { error: err instanceof Error ? err.message : 'AI request failed', code: 'internal_ai_error' } };
}

async function getReportClassification(reportId: string): Promise<ClassificationResult | null> {
  const row = await queryOne<{ ai_classification: unknown }>('SELECT ai_classification FROM reports WHERE id = ?', [reportId]);
  return parseStoredClassification(row?.ai_classification);
}

async function saveClassificationResult(reportId: string, result: ClassificationResult): Promise<void> {
  await execute(
    'UPDATE reports SET ai_classification = ?, ai_classification_model = ?, ai_classified_at = ?, ai_classification_status = ?, ai_classification_error = ?, internal_notes = ? WHERE id = ?',
    [
      JSON.stringify(result),
      result.model,
      result.classified_at,
      'completed',
      null,
      `Suggested: ${result.damage_level} (${Math.round(result.confidence * 100)}% confident). ${result.reasoning}`.trim(),
      reportId,
    ]
  );
  const photoRow = await queryOne<{ photos: unknown }>('SELECT photos FROM reports WHERE id = ?', [reportId]);
  const media = await resolveReportMedia(photoRow?.photos);
  await syncReportPhotoQualityFromAi(reportId, result.confidence, media.photo_count);
}

async function updateReportClassificationState(reportId: string, status: 'pending' | 'completed' | 'failed', errorMessage?: string | null): Promise<void> {
  await execute(
    'UPDATE reports SET ai_classification_status = ?, ai_classification_error = ? WHERE id = ?',
    [status, errorMessage || null, reportId]
  );
}

async function processClassificationJob(job: ClassifyJobRow): Promise<{ kind: 'completed'; result: ClassificationResult } | { kind: 'queued'; retryAfterSeconds: number; code: string; message: string } | { kind: 'failed'; status: number; body: Record<string, unknown> }> {
  const existing = await getReportClassification(job.report_id);
  if (existing) {
    await updateReportClassificationState(job.report_id, 'completed', null);
    await updateClassifyJob(job.id, {
      status: 'completed',
      last_error_code: null,
      last_error_message: null,
      next_attempt_at: null,
      locked_at: null,
    });
    return { kind: 'completed', result: existing };
  }

  const report = await queryOne<any>('SELECT * FROM reports WHERE id = ?', [job.report_id]);
  if (!report) {
    await updateReportClassificationState(job.report_id, 'failed', 'Report not found');
    await updateClassifyJob(job.id, {
      status: 'failed_terminal',
      last_error_code: 'report_not_found',
      last_error_message: 'Report not found',
      locked_at: null,
      next_attempt_at: null,
    });
    return { kind: 'failed', status: 404, body: { error: 'Report not found', code: 'report_not_found' } };
  }

  const media = await resolveReportMedia(report.photos);
  if (media.ai_media_eligibility !== 'eligible') {
    const code = media.ai_media_eligibility;
    const message = code === 'no_photos'
      ? 'No photos found for this report'
      : code === 'missing_media'
        ? 'Photo files are missing for this report'
        : 'Photo references are invalid for this report';
    const status = code === 'no_photos' ? 400 : 422;
    await updateReportClassificationState(job.report_id, 'failed', message);
    await updateClassifyJob(job.id, {
      status: 'failed_terminal',
      last_error_code: code,
      last_error_message: message,
      locked_at: null,
      next_attempt_at: null,
    });
    return { kind: 'failed', status, body: { error: message, code } };
  }

  const apiKey = AI_ENV_KEY;
  if (!apiKey) {
    const retryMs = Math.max(300000, computeRetryDelayMs(Math.max(1, job.attempt_count + 1), 'missing_api_key'));
    await updateReportClassificationState(job.report_id, 'pending', 'AI key not configured yet');
    await updateClassifyJob(job.id, {
      status: 'retry_wait',
      attempt_count: job.attempt_count + 1,
      last_error_code: 'missing_api_key',
      last_error_message: 'API key not configured',
      next_attempt_at: new Date(Date.now() + retryMs).toISOString(),
      locked_at: null,
    });
    return { kind: 'queued', retryAfterSeconds: Math.ceil(retryMs / 1000), code: 'missing_api_key', message: 'AI key not configured' };
  }

  let failureImageMime: string | undefined;
  let failureImageBytes: number | undefined;

  try {
    let parsed: ClassificationResult | null = null;
    const normalized = await Promise.all(
      media.available_keys.slice(0, 3).map((photo) => normalizeImageDataUrl(photo))
    );
    if (!normalized.length) throw new InvalidImagePayloadError('Unsupported, corrupted, or invalid image payload');
    failureImageMime = normalized[0].mime;
    failureImageBytes = normalized[0].bytes;

    const messages = [
      {
        role: 'system',
        content: `You are a UNDP humanitarian infrastructure damage assessor.
Task: classify structural damage from one or more photos.
Output must be strict JSON only, no markdown, no prose outside JSON.
Schema:
{"damage_level":"minimal|partial|destroyed","confidence":0.0-1.0,"reasoning":"<=160 chars","debris_visible":true|false,"urgent":true|false}
Rules:
- Focus on visible physical damage only.
- If uncertain, lower confidence.
- "urgent" should be true only for severe immediate risk indicators (collapse, fire, major debris blocking critical access).`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Infrastructure type: ${report.infra_category || 'unknown'}. Crisis type: ${report.crisis_type || 'unknown'}. Reporter damage level: ${report.damage_level}. Assess visible structural damage only.` },
          ...normalized.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl, detail: 'low' } })),
        ],
      },
    ];

    const modelPool = await getAiModelChain('vision');
    const { text: raw, model, attemptsUsed } = await callWithFallback(
      messages,
      modelPool,
      apiKey,
      'classify',
      300,
      async () => {
        await ensureClassifyQuota();
      },
      async (attemptModel, outcomeCode, err) => {
        await recordClassifyAttempt(job.report_id, attemptModel, outcomeCode);
        if (err) {
          logAiFailure({
            endpointType: 'classify',
            model: err.model,
            imageMime: failureImageMime,
            imageBytes: failureImageBytes,
            upstreamStatus: err.httpStatus,
            upstreamCode: err.providerCode,
            message: err.message,
          });
        }
      },
      (rawText, rawModel) => {
        let parsedJson: any;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          throw new UpstreamModelError(`Model returned invalid JSON for ${rawModel}`, {
            httpStatus: 502,
            providerCode: 'invalid_json',
            endpointType: 'classify',
            model: rawModel,
            retryable: true,
            raw: rawText.slice(0, 500),
          });
        }
        parsed = normalizeClassificationPayload(parsedJson, rawModel);
      }
    );
    const parsedResult = parsed || normalizeClassificationPayload(JSON.parse(raw), model);
    logAiSuccess({ endpointType: 'classify', model, attemptsUsed });
    await saveClassificationResult(job.report_id, parsedResult);
    await updateClassifyJob(job.id, {
      status: 'completed',
      attempt_count: job.attempt_count + attemptsUsed,
      last_error_code: null,
      last_error_message: null,
      last_model: model,
      next_attempt_at: null,
      locked_at: null,
    });
    return { kind: 'completed', result: parsedResult };
  } catch (err) {
    if (err instanceof QuotaExhaustedError) {
      const retryMs = computeRetryDelayMs(Math.max(1, job.attempt_count + 1), 'upstream_rate_limited');
      await updateReportClassificationState(job.report_id, 'pending', err.message);
      await updateClassifyJob(job.id, {
        status: 'retry_wait',
        last_error_code: 'quota_exhausted',
        last_error_message: err.message,
        next_attempt_at: new Date(Date.now() + retryMs).toISOString(),
        locked_at: null,
      });
      return { kind: 'queued', retryAfterSeconds: err.retryAfterSeconds, code: 'quota_exhausted', message: err.message };
    }

    if (err instanceof InvalidImagePayloadError) {
      await updateReportClassificationState(job.report_id, 'failed', err.message);
      await updateClassifyJob(job.id, {
        status: 'failed_terminal',
        attempt_count: job.attempt_count,
        last_error_code: 'invalid_image_payload',
        last_error_message: err.message,
        next_attempt_at: null,
        locked_at: null,
      });
      return { kind: 'failed', status: 422, body: { error: err.message, code: 'invalid_image_payload' } };
    }

    if (err instanceof UpstreamModelError) {
      const mapped = mapAiErrorToHttp(err);
      if (mapped.body.retryable === true) {
        const retryMs = computeRetryDelayMs(Math.max(1, job.attempt_count + 1), String(mapped.body.code));
        await updateReportClassificationState(job.report_id, 'pending', err.message);
        await updateClassifyJob(job.id, {
          status: 'retry_wait',
          attempt_count: job.attempt_count + 1,
          last_error_code: String(mapped.body.code),
          last_error_message: err.message,
          last_model: err.model,
          next_attempt_at: new Date(Date.now() + retryMs).toISOString(),
          locked_at: null,
        });
        return {
          kind: 'queued',
          retryAfterSeconds: Math.ceil(retryMs / 1000),
          code: String(mapped.body.code),
          message: err.message,
        };
      }

      await updateReportClassificationState(job.report_id, 'failed', err.message);
      await updateClassifyJob(job.id, {
        status: 'failed_terminal',
        attempt_count: job.attempt_count + 1,
        last_error_code: String(mapped.body.code),
        last_error_message: err.message,
        last_model: err.model,
        next_attempt_at: null,
        locked_at: null,
      });
      return { kind: 'failed', status: mapped.status, body: mapped.body };
    }

    if (isRetryableAiTransportError(err)) {
      const message = err instanceof Error ? err.message : 'AI request failed';
      const retryMs = computeRetryDelayMs(Math.max(1, job.attempt_count + 1), 'network_error');
      await updateReportClassificationState(job.report_id, 'pending', message);
      await updateClassifyJob(job.id, {
        status: 'retry_wait',
        attempt_count: job.attempt_count + 1,
        last_error_code: 'network_error',
        last_error_message: message,
        next_attempt_at: new Date(Date.now() + retryMs).toISOString(),
        locked_at: null,
      });
      return {
        kind: 'queued',
        retryAfterSeconds: Math.ceil(retryMs / 1000),
        code: 'network_error',
        message,
      };
    }

    await updateReportClassificationState(job.report_id, 'failed', err instanceof Error ? err.message : 'AI request failed');
    await updateClassifyJob(job.id, {
      status: 'failed_terminal',
      attempt_count: job.attempt_count + 1,
      last_error_code: 'internal_ai_error',
      last_error_message: err instanceof Error ? err.message : 'AI request failed',
      next_attempt_at: null,
      locked_at: null,
    });
    return { kind: 'failed', status: 500, body: { error: err instanceof Error ? err.message : 'AI request failed', code: 'internal_ai_error' } };
  }
}

let classifyWorkerTimer: NodeJS.Timeout | null = null;
let classifyWorkerRunning = false;

async function runClassifyWorkerOnce(): Promise<void> {
  if (classifyWorkerRunning) return;
  classifyWorkerRunning = true;
  try {
    await reconcilePendingClassificationJobs();
    await reviveRecoverableClassificationJobs();
    const job = await tryAcquireNextClassifyJob();
    if (!job) return;
    await processClassificationJob(job);
  } catch (err) {
    logger.error('ai.classify.worker', { details: [err] });
  } finally {
    classifyWorkerRunning = false;
  }
}

export function startAiBackgroundWorkers(): void {
  if (classifyWorkerTimer) return;
  runClassifyWorkerOnce().catch((err) => logger.error('ai.classify.worker.boot', { details: [err] }));
  classifyWorkerTimer = setInterval(() => {
    runClassifyWorkerOnce().catch((err) => logger.error('ai.classify.worker.interval', { details: [err] }));
  }, AI_CLASSIFY_POLL_MS);
}

router.get('/settings', authMiddleware, requireRole('team_lead'), async (_req: Request, res: Response): Promise<void> => {
  const settings = await getPublicAiSettings();
  res.json({ settings });
});

router.get('/models', authMiddleware, requireRole('team_lead'), async (_req: Request, res: Response): Promise<void> => {
  const apiKey = AI_ENV_KEY;
  const FALLBACKS = {
    vision: [...FREE_VISION_MODELS],
    text: [...FREE_TEXT_MODELS],
    translation: [...FREE_TEXT_MODELS],
  };

  if (!apiKey) {
    if (STRICT_INTEGRATIONS) {
      res.status(503).json({ error: 'OpenRouter API key is required in strict mode' });
      return;
    }
    res.json({
      models: FALLBACKS,
      pools: { classify: await getAiModelChain('vision'), sitrep: await getAiModelChain('text') },
      source: 'fallback',
      reason: 'no_api_key',
    });
    return;
  }

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(AI_MODEL_LIST_REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as any;
    const rawModels: any[] = data.data || [];
    const all = rawModels.map((m: any) => m.id).filter(Boolean);
    const curatedVision = FREE_VISION_MODELS.filter((id) => all.includes(id));
    const curatedText = FREE_TEXT_MODELS.filter((id) => all.includes(id));
    const visionModels = curatedVision.length ? [...curatedVision] : FALLBACKS.vision;
    const textModels = curatedText.length ? [...curatedText] : FALLBACKS.text;
    const translationModels = curatedText.length ? [...curatedText] : FALLBACKS.translation;

    res.json({
      models: { vision: visionModels, text: textModels, translation: translationModels },
      pools: { classify: await getAiModelChain('vision'), sitrep: await getAiModelChain('text') },
      source: 'live',
      provider: 'openrouter',
    });
  } catch (err: any) {
    if (STRICT_INTEGRATIONS) {
      res.status(502).json({ error: `OpenRouter model list failed in strict mode: ${err.message}` });
      return;
    }
    res.json({
      models: FALLBACKS,
      pools: { classify: await getAiModelChain('vision'), sitrep: await getAiModelChain('text') },
      source: 'fallback',
      reason: err.message,
    });
  }
});

router.patch('/settings', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const allowed = [
    'model_vision', 'model_vision_fallback_1', 'model_vision_fallback_2',
    'model_text', 'model_text_fallback_1', 'model_text_fallback_2',
    'translation_model',
    'translation_fallback_model_1', 'translation_fallback_model_2',
    'feature_sitrep',
    'sitrep_min_reports',
    'mobilenet_enabled', 'mobilenet_url',
  ];
  const updates: string[] = [];
  for (const [key, value] of Object.entries(req.body)) {
    if (allowed.includes(key)) { await setAiSetting(key, String(value)); updates.push(key); }
  }
  res.json({ success: true, updated: updates });
});

router.get('/classify-damage/:reportId', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { reportId } = req.params;
  const report = await queryOne<any>('SELECT id, ai_classification, photos FROM reports WHERE id = ?', [reportId]);
  if (!report) { res.status(404).json({ error: 'Report not found', code: 'report_not_found' }); return; }
  const classification = parseStoredClassification(report.ai_classification);
  const job = await getClassifyJob(reportId);
  const media = await resolveReportMedia(report.photos);
  res.json({
    report_id: reportId,
    status: classification ? 'completed' : (job?.status || 'missing'),
    classification,
    ai_media_eligibility: media.ai_media_eligibility,
    media_state: media.media_state,
    photo_count: media.photo_count,
    job: job || null,
  });
});

export async function triggerClassificationForReport(reportId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const normalizedReportId = String(reportId || '').trim();
  if (!normalizedReportId) {
    return { status: 400, body: { error: 'reportId required', code: 'missing_report_id' } };
  }

  const report = await queryOne<any>('SELECT id, photos FROM reports WHERE id = ?', [normalizedReportId]);
  if (!report) return { status: 404, body: { error: 'Report not found', code: 'report_not_found' } };

  const media = await resolveReportMedia(report.photos);
  if (media.ai_media_eligibility !== 'eligible') {
    const code = media.ai_media_eligibility;
    const status = code === 'no_photos' ? 400 : 422;
    const message = code === 'no_photos'
      ? 'No photos found for this report'
      : code === 'missing_media'
        ? 'Photo files are missing for this report'
        : 'Photo references are invalid for this report';
    await updateReportClassificationState(normalizedReportId, 'failed', message);
    return {
      status,
      body: {
        error: message,
        code,
        report_id: normalizedReportId,
        ai_media_eligibility: media.ai_media_eligibility,
        media_state: media.media_state,
        photo_count: media.photo_count,
      },
    };
  }

  const cached = await getReportClassification(normalizedReportId);
  if (cached) {
    return { status: 200, body: { success: true, status: 'completed', report_id: normalizedReportId, classification: cached, job: await getClassifyJob(normalizedReportId) } };
  }

  const existingJob = await upsertClassifyJob(normalizedReportId);
  if (existingJob.status === 'processing') {
    return { status: 202, body: { success: true, status: 'processing', report_id: normalizedReportId, job: existingJob } };
  }
  if (existingJob.status === 'completed') {
    return { status: 200, body: { success: true, status: 'completed', report_id: normalizedReportId, classification: await getReportClassification(normalizedReportId), job: existingJob } };
  }
  if (existingJob.status === 'failed_terminal') {
    if (canRerunFailedClassification(existingJob.last_error_code, existingJob.last_error_message)) {
      await updateReportClassificationState(normalizedReportId, 'pending', null);
      await updateClassifyJob(existingJob.id, {
        status: 'pending',
        next_attempt_at: new Date().toISOString(),
        locked_at: null,
        last_error_code: null,
        last_error_message: null,
        last_model: null,
      });
      const resumedJob = await getClassifyJob(normalizedReportId);
      if (!resumedJob) {
        return { status: 500, body: { error: 'Unable to resume classification job', code: 'job_resume_failed' } };
      }
      existingJob.status = resumedJob.status;
      existingJob.next_attempt_at = resumedJob.next_attempt_at;
      existingJob.locked_at = resumedJob.locked_at;
      existingJob.last_error_code = resumedJob.last_error_code;
      existingJob.last_error_message = resumedJob.last_error_message;
    } else {
      const status = existingJob.last_error_code === 'no_photos'
        ? 400
        : existingJob.last_error_code === 'missing_media' || existingJob.last_error_code === 'invalid_media'
          ? 422
          : 422;
      return {
        status,
        body: {
          success: false,
          status: 'failed_terminal',
          report_id: normalizedReportId,
          ai_media_eligibility: media.ai_media_eligibility,
          media_state: media.media_state,
          photo_count: media.photo_count,
          job: existingJob,
        },
      };
    }
  }
  if (existingJob.status === 'failed_terminal') {
    const status = existingJob.last_error_code === 'no_photos'
      ? 400
      : existingJob.last_error_code === 'missing_media' || existingJob.last_error_code === 'invalid_media'
        ? 422
        : 422;
    return {
      status,
      body: {
        success: false,
        status: 'failed_terminal',
        report_id: normalizedReportId,
        ai_media_eligibility: media.ai_media_eligibility,
        media_state: media.media_state,
        photo_count: media.photo_count,
        job: existingJob,
      },
    };
  }

  const acquired = await queryOne<ClassifyJobRow>(
    "UPDATE ai_classify_jobs SET status = 'processing', locked_at = NOW(), updated_at = NOW() WHERE report_id = ? AND status IN ('pending', 'retry_wait') RETURNING *",
    [normalizedReportId]
  );
  const activeJob = acquired || await getClassifyJob(normalizedReportId);
  if (!activeJob) {
    return { status: 500, body: { error: 'Unable to start classification job', code: 'job_acquire_failed' } };
  }
  if (activeJob.status !== 'processing') {
    return { status: 202, body: { success: true, status: activeJob.status, report_id: normalizedReportId, job: activeJob } };
  }

  const result = await processClassificationJob(activeJob);
  if (result.kind === 'completed') {
    return { status: 200, body: { success: true, status: 'completed', report_id: normalizedReportId, classification: result.result, job: await getClassifyJob(normalizedReportId) } };
  }
  if (result.kind === 'queued') {
    return {
      status: 202,
      body: {
        success: true,
        status: 'queued',
        report_id: normalizedReportId,
        retryable: true,
        retry_after_seconds: result.retryAfterSeconds,
        code: result.code,
        message: result.message,
        job: await getClassifyJob(normalizedReportId),
      },
    };
  }
  return { status: result.status, body: { ...result.body, report_id: normalizedReportId, job: await getClassifyJob(normalizedReportId) } };
}

router.post('/classify-damage', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const result = await triggerClassificationForReport(String(req.body?.reportId || ''));
  res.status(result.status).json(result.body);
});

router.post('/sitrep', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (await getAiSetting('feature_sitrep') !== 'true') {
      res.status(403).json({ error: 'Situation report feature is disabled' }); return;
    }
    const apiKey = AI_ENV_KEY;

    const { bbox, crisis_event, since, focus_area } = req.body;
    const minReports = parseInt((await getAiSetting('sitrep_min_reports')) || '3', 10);
    const moderationSettings = await getModerationSettings();
    const explicitBbox = bbox ? parseBboxString(String(bbox)) : null;
    if (bbox && !explicitBbox) {
      res.status(400).json({ error: 'Invalid bbox format. Expected minLng,minLat,maxLng,maxLat' });
      return;
    }

    let resolvedScope: ResolvedSitrepScope | null = null;
    if (focus_area && String(focus_area).trim()) {
      resolvedScope = await resolveFocusAreaScope(String(focus_area).trim(), String(req.headers['accept-language'] || 'en'));
      if (!resolvedScope) {
        res.status(400).json({ error: 'Focus area could not be resolved to a geographic location. Please enter a clearer place name.' });
        return;
      }
    }

    const scopeBbox = resolvedScope?.bbox ? parseBboxString(resolvedScope.bbox) : null;
    if (resolvedScope && !scopeBbox && !(resolvedScope.scope_level === 'country' && resolvedScope.country_code)) {
      res.status(400).json({ error: 'Resolved focus area does not provide a usable geographic boundary. Please choose a clearer place name.' });
      return;
    }
    const coarseBbox = explicitBbox || scopeBbox;

    let query = "SELECT * FROM reports WHERE status NOT IN ('duplicate', 'rejected')";
    const params: (string | number)[] = [];
    if (crisis_event) { query += ' AND crisis_event = ?'; params.push(crisis_event); }
    if (since) { query += ' AND submitted_at >= ?'; params.push(since); }
    if (coarseBbox) {
      const [minLng, minLat, maxLng, maxLat] = coarseBbox;
      query += ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?';
      params.push(minLat, maxLat, minLng, maxLng);
    } else if (resolvedScope?.scope_level === 'country' && resolvedScope.country_code) {
      query += ' AND lower(COALESCE(country_code, \'\')) = ?';
      params.push(resolvedScope.country_code);
    }
    query += ' ORDER BY submitted_at DESC LIMIT 500';
    const candidateReports = await queryAll<any>(query, params);

    const selection = applySitrepScopeAndDedup({
      candidateReports,
      resolvedScope,
      moderationSettings,
      limit: 50,
    });
    const reports = selection.reports;
    const outsideScopeExcluded = selection.outsideScopeExcluded;
    const duplicateReportsExcluded = selection.duplicateReportsExcluded;
    const statusReportsExcluded = selection.statusReportsExcluded;

    if (reports.length === 0) {
      res.status(400).json({ error: 'No in-scope reports are available for the selected location.' });
      return;
    }
    const allowLowCoverageFocusArea = Boolean(resolvedScope || (focus_area && String(focus_area).trim()));
    const lowCoverage = reports.length < minReports;
    if (lowCoverage && !allowLowCoverageFocusArea) {
      res.status(400).json({ error: `Need at least ${minReports} reports to generate situation report. Found: ${reports.length}` });
      return;
    }

    
    const stats: SitrepStats = {
      total: reports.length,
      destroyed: reports.filter(r => r.damage_level === 'destroyed').length,
      partial: reports.filter(r => r.damage_level === 'partial').length,
      minimal: reports.filter(r => r.damage_level === 'minimal').length,
      urgent: reports.filter(r => r.is_urgent).length,
      verified: reports.filter(r => r.status === 'verified').length,
      crisisTypes: [...new Set(reports.map(r => r.crisis_type).filter(Boolean))],
      infraCategories: [...new Set(reports.map(r => r.infra_category).filter(Boolean))],
      needsCounts: {} as Record<string, number>,
    };
    const sourceReportIds = reports.map((report) => String(report.id));
    const filterSnapshot: SitrepFiltersSnapshot = {
      bbox: explicitBbox ? String(bbox) : (scopeBbox ? resolvedScope?.bbox || null : null),
      crisis_event: crisis_event ? String(crisis_event) : null,
      since: since ? String(since) : null,
      focus_area: focus_area ? String(focus_area) : null,
      scope: resolvedScope,
      duplicate_radius_m: moderationSettings.duplicateRadiusM,
      duplicate_time_hours: moderationSettings.duplicateTimeHours,
      candidate_report_count: selection.candidateReportCount,
      outside_scope_excluded: outsideScopeExcluded,
      duplicate_reports_excluded: duplicateReportsExcluded,
      status_reports_excluded: statusReportsExcluded,
      low_coverage: lowCoverage,
      min_reports_required: minReports,
    };

    const compositionContext: SitrepCompositionContext = {
      stats,
      reports,
      resolvedScope,
      focusArea: focus_area ? String(focus_area) : null,
      moderationSettings,
      filterSnapshot,
      minReports,
    };

    
    for (const r of reports) {
      try {
        const needs = JSON.parse(r.pressing_needs || '[]') as string[];
        for (const n of needs) { stats.needsCounts[n] = (stats.needsCounts[n] || 0) + 1; }
      } catch {
        // Skip malformed needs payloads when building the sitrep summary rollup.
      }
    }
    const topNeeds = Object.entries(stats.needsCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => `${k} (${v} reports)`);

    const recentDescriptions = reports
      .filter(r => r.description || r.address_text || r.building_label).slice(0, 10)
      .map(r => {
        const location = [r.building_label, r.address_text].filter(Boolean).join(' | ') || 'Unknown location';
        return `- [${r.damage_level?.toUpperCase()}] ${location}: ${r.description || 'No description provided'}`;
      }).join('\n');

    const scopeSummary = resolvedScope
      ? `- Resolved focus area: ${resolvedScope.resolved_name}
- Scope level: ${resolvedScope.scope_level}
- Country: ${resolvedScope.country_name || 'unknown'}
${resolvedScope.admin1 ? `- Admin level 1: ${resolvedScope.admin1}` : ''}
${resolvedScope.locality ? `- Locality: ${resolvedScope.locality}` : ''}
${resolvedScope.bbox ? `- Geographic bounding box: ${resolvedScope.bbox}` : ''}`
      : '';

    const systemPrompt = `You are a professional humanitarian field coordinator writing a UNDP situation report. 
Write in a factual, professional third-person voice suitable for field team briefings.
Keep the report concise (3-4 paragraphs). 
Use UNDP/UN humanitarian terminology.
Never mention AI or that this was auto-generated.
Do not use placeholders such as [ADDRESS], [FOCUS AREA], [Focus Area], TBD, UNKNOWN, or bracketed tokens.
If a focus area is provided, refer to that exact place name in normal prose.
Do not mention or summarize places outside the resolved focus area.`;

    const userPrompt = `Generate a field situation report from the following crisis damage data:

SUMMARY STATISTICS:
- Total reports: ${stats.total} (${stats.verified} verified, ${stats.urgent} urgent)
- Damage breakdown: ${stats.destroyed} destroyed, ${stats.partial} partial, ${stats.minimal} minimal
- Crisis types: ${stats.crisisTypes.join(', ') || 'mixed'}
- Infrastructure affected: ${stats.infraCategories.join(', ') || 'various'}
- Top pressing needs: ${topNeeds.join('; ') || 'not specified'}
${focus_area ? `- Focus area: ${focus_area}` : ''}
${scopeSummary}
- Duplicate suppression applied with ${moderationSettings.duplicateRadiusM}m radius and ${moderationSettings.duplicateTimeHours}h window
- Reports excluded outside scope: ${outsideScopeExcluded}
- Reports excluded as duplicates: ${duplicateReportsExcluded}
${lowCoverage ? `- Low coverage note: only ${reports.length} in-scope reports were available, below the standard minimum of ${minReports}` : ''}

RECENT FIELD DESCRIPTIONS:
${recentDescriptions || 'No descriptions available'}

Write a 3-4 paragraph situation report for field team briefings. Include: overview, damage assessment, priority needs, recommended next actions.
${resolvedScope ? `Use this exact focus area in the report body when referring to the location: ${resolvedScope.resolved_name}` : (focus_area ? `Use this exact focus area in the report body when referring to the location: ${focus_area}` : 'Do not invent a named focus area if one is not provided.')}`;

    const modelPool = await getAiModelChain('text');
    let sitrep = '';
    let model = resolvedScope ? 'scoped:deterministic' : 'fallback:deterministic';
    if (resolvedScope) {
      sitrep = buildDeterministicSitrep(compositionContext);
    } else if (apiKey) {
      try {
        const result = await callWithFallback(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          modelPool,
          apiKey,
          'sitrep',
          800,
          undefined,
          async (attemptModel, outcomeCode, err) => {
            if (err) {
              logAiFailure({
                endpointType: 'sitrep',
                model: err.model,
                upstreamStatus: err.httpStatus,
                upstreamCode: err.providerCode,
                message: err.message,
              });
              return;
            }
            console.info('[AI_UPSTREAM_ATTEMPT]', JSON.stringify({ endpointType: 'sitrep', model: attemptModel, outcomeCode }));
          }
        );
        sitrep = sanitizeSitrepContent(result.text, resolvedScope?.resolved_name || (focus_area ? String(focus_area) : null));
        model = result.model;
        logAiSuccess({ endpointType: 'sitrep', model: result.model, attemptsUsed: result.attemptsUsed });
      } catch (err) {
        if (!(err instanceof UpstreamModelError)) {
          logger.error('ai.sitrep.fallback', { details: [err] });
        }
        sitrep = buildDeterministicSitrep(compositionContext);
      }
    } else {
      sitrep = buildDeterministicSitrep(compositionContext);
    }

    const saved = await queryOne<{ id: string | number }>(
      `INSERT INTO sitrep_logs (report_count, content, focus_area, model, stats_json, report_ids_json, filters_json)
       VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
       RETURNING id`,
      [
        reports.length,
        sitrep,
        focus_area || resolvedScope?.resolved_name || null,
        model,
        JSON.stringify(stats),
        JSON.stringify(sourceReportIds),
        JSON.stringify(filterSnapshot),
      ]
    );

    res.json({
      success: true,
      id: String(saved?.id || ''),
      sitrep,
      stats,
      model,
      report_count: reports.length,
      focus_area: focus_area || resolvedScope?.resolved_name || null,
      filters: filterSnapshot,
    });
  } catch (err: any) {
    const mapped = mapAiErrorToHttp(err);
    res.status(mapped.status).json(mapped.body);
  }
});

router.get('/sitrep-history', authMiddleware, requireRole('team_lead'), async (_req: Request, res: Response): Promise<void> => {
  res.set('Cache-Control', 'no-store, max-age=0');
  const logs = await queryAll('SELECT id, generated_at, report_count, focus_area, model, substr(content,1,200) as preview FROM sitrep_logs ORDER BY generated_at DESC LIMIT 20');
  res.json({
    logs: logs.map((log: any) => ({
      ...log,
      id: String(log.id),
    })),
  });
});

router.get('/sitrep-history/:id', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  res.set('Cache-Control', 'no-store, max-age=0');
  const requestedLang = String(req.query.lang || '').trim().toLowerCase();
  const log = await queryOne<any>(
    `SELECT id, generated_at, report_count, content, focus_area, model, stats_json, report_ids_json, filters_json
     FROM sitrep_logs
     WHERE id = ?`,
    [req.params.id]
  );
  if (!log) {
    res.status(404).json({ error: 'Situation report not found' });
    return;
  }

  const sourceReportIds = parseJsonArray(log.report_ids_json);
  const stats = parseJsonObject<SitrepStats>(log.stats_json, {
    total: Number(log.report_count || 0),
    destroyed: 0,
    partial: 0,
    minimal: 0,
    urgent: 0,
    verified: 0,
    crisisTypes: [],
    infraCategories: [],
    needsCounts: {},
  });
  const filters = parseJsonObject<SitrepFiltersSnapshot>(log.filters_json, {
    bbox: null,
    crisis_event: null,
    since: null,
    focus_area: log.focus_area || null,
  });

  let sourceReports: any[] = [];
  if (sourceReportIds.length > 0) {
    const placeholders = sourceReportIds.map(() => '?').join(',');
    const rows = await queryAll<any>(`SELECT * FROM reports WHERE id IN (${placeholders})`, sourceReportIds);
    const formattedRows = await Promise.all(rows.map((row) => formatReport(row)));
    const translatedRows = requestedLang ? await attachTranslationsToMany(formattedRows, [requestedLang]) : formattedRows;
    const byId = new Map(translatedRows.map((row) => [String(row.id), row]));
    sourceReports = sourceReportIds.map((id) => {
      const report = byId.get(id);
      if (!report) {
        return { id, unavailable: true };
      }
      return { ...report, unavailable: false };
    });
  }

  res.json({
    sitrep: {
      id: String(log.id),
      generated_at: log.generated_at,
      report_count: Number(log.report_count || sourceReportIds.length || stats.total || 0),
      content: String(log.content || ''),
      focus_area: log.focus_area || null,
      model: String(log.model || ''),
      preview: String(log.content || '').slice(0, 200),
    },
    stats,
    filters,
    source_report_ids: sourceReportIds,
    source_reports: sourceReports,
  });
});

router.get('/status', authMiddleware, requireRole('team_lead'), async (_req: Request, res: Response): Promise<void> => {
  const settings = await getPublicAiSettings();
  res.json({
    strict_mode: STRICT_INTEGRATIONS,
    pools: {
      classify: await getAiModelChain('vision'),
      sitrep: await getAiModelChain('text'),
    },
    quotas: {
      classify_per_minute: AI_CLASSIFY_MAX_PER_MINUTE,
      classify_per_day: AI_CLASSIFY_MAX_PER_DAY,
    },
    features: {
      damage_classify: true,
      sitrep: settings.feature_sitrep === 'true',
    },
    mobilenet: {
      implemented: false,
      enabled: settings.mobilenet_enabled === 'true',
      url: settings.mobilenet_url || null,
    },
  });
});

export const __aiInternals = {
  isRetryableAiTransportError,
  processClassificationJob,
};

export default router;

export { applySitrepScopeAndDedup } from '../ai/sitrepComposition';
