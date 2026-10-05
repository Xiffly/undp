import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executeMock,
  queryAllMock,
  queryOneMock,
  getAiModelChainMock,
  setIntervalMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  queryAllMock: vi.fn(),
  queryOneMock: vi.fn(),
  getAiModelChainMock: vi.fn(),
  setIntervalMock: vi.fn(() => ({ unref: vi.fn() }) as any),
}));

vi.stubGlobal('setInterval', setIntervalMock as any);

vi.mock('./dbRuntime', () => ({
  execute: executeMock,
  queryAll: queryAllMock,
  queryOne: queryOneMock,
}));

vi.mock('./routes/alerts', () => ({
  checkAndSendAlerts: vi.fn(),
}));

vi.mock('./media', () => ({
  deleteMediaKeys: vi.fn(),
  saveMediaFile: vi.fn(),
}));

vi.mock('./reportMedia', () => ({
  normalizeStoredPhotoKeys: vi.fn((value) => value),
  resolveReportMedia: vi.fn(async () => ({
    photos: [],
    photo_count: 0,
    media_state: 'none',
    ai_media_eligibility: 'no_photos',
    stored_keys: [],
    available_keys: [],
  })),
}));

vi.mock('./middleware/auth', () => ({
  authMiddleware: vi.fn(),
  optionalAuthMiddleware: vi.fn(),
  requireRole: vi.fn(() => vi.fn()),
}));

vi.mock('./services/contributorReputation', () => ({
  applyResolvedAccuracyScore: vi.fn(),
  ensureContributorAlias: vi.fn(),
  ensureReportQualityStub: vi.fn(),
  recomputeContributorProfile: vi.fn(),
}));

vi.mock('./services/identityLinking', () => ({
  deriveContributorKeyFromUser: vi.fn(),
  ensureUserContributorLink: vi.fn(),
  normalizePhone: vi.fn((value) => value),
}));

vi.mock('./services/aiSettings', () => ({
  getAiModelChain: getAiModelChainMock,
  getAiSetting: vi.fn(),
  TRANSLATION_REQUEST_TIMEOUT_MS: 60000,
}));

vi.mock('./services/moderationSettings', () => ({
  getModerationSettings: vi.fn(),
}));

function jsonResponse(body: unknown, init?: { status?: number }) {
  const status = init?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as any;
}

async function loadReportsModule() {
  return import('./routes/reports');
}

describe('report translation hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    executeMock.mockReset().mockResolvedValue(1);
    queryAllMock.mockReset().mockResolvedValue([]);
    queryOneMock.mockReset().mockResolvedValue(undefined);
    getAiModelChainMock.mockReset().mockResolvedValue(['model-primary', 'model-fallback']);
    setIntervalMock.mockClear();
    process.env.TRANSLATION_ENABLED = 'true';
    process.env.AI_API_KEY = 'test-key';
    delete process.env.TRANSLATION_API_KEY;
    delete process.env.TRANSLATION_API_BASE_URL;
    delete process.env.TRANSLATION_REQUEST_TIMEOUT_MS;
  });

  afterEach(() => {
    delete process.env.TRANSLATION_ENABLED;
    delete process.env.AI_API_KEY;
  });

  it('retries translation models until a fallback succeeds', async () => {
    const reportsModule = await loadReportsModule();
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'No endpoints found', code: 404 } }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Перевод' } }], model: 'model-fallback' }));

    const result = await reportsModule.__translationInternals.translateDynamicText('Damaged bridge', 'ru');

    expect(result.completed).toBe(true);
    expect(result.model).toBe('model-fallback');
    expect(result.attemptsUsed).toBe(2);
  });

  it('rejects synthetic placeholders and falls back to the next translation model', async () => {
    const reportsModule = await loadReportsModule();
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Acceso sur al puente [PERSON_NAME]' } }], model: 'model-primary' }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Acceso sur al puente Cahir' } }], model: 'model-fallback' }));

    const result = await reportsModule.__translationInternals.translateDynamicText('South approach to Cahir bridge', 'es');

    expect(result.completed).toBe(true);
    expect(result.model).toBe('model-fallback');
    expect(result.translated).toBe('Acceso sur al puente Cahir');
    expect(result.attemptsUsed).toBe(2);
  });

  it('falls back to the original source text when every model redacts a proper noun as a synthetic placeholder', async () => {
    const reportsModule = await loadReportsModule();
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Acceso sur al puente [PERSON_NAME]' } }], model: 'model-primary' }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Acceso al puente [LOCATION]' } }], model: 'model-fallback' }));

    const result = await reportsModule.__translationInternals.translateDynamicText('South approach to Cahir bridge', 'es');

    expect(result.completed).toBe(true);
    expect(result.translated).toBe('South approach to Cahir bridge');
    expect(result.attemptsUsed).toBe(2);
  });

  it('does not fall back to the original source text for long sentence translations', async () => {
    const reportsModule = await loadReportsModule();
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Message [PERSON_NAME]' } }], model: 'model-primary' }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Resident [LOCATION]' } }], model: 'model-fallback' }));

    const result = await reportsModule.__translationInternals.translateDynamicText(
      'Message supplementaire d un resident confirmant les memes dommages dans les maisons autour de la cour.',
      'en'
    );

    expect(result.completed).toBe(false);
    expect(result.errorCode).toBe('synthetic_placeholder');
    expect(result.attemptsUsed).toBe(2);
  });

  it('rejects safety metadata payloads and falls back to the next translation model', async () => {
    const reportsModule = await loadReportsModule();
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'User Safety: unsafe\nSafety Categories: PII/Privacy' } }], model: 'model-primary' }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Additional message from a resident confirming the same damage in the houses around the courtyard.' } }], model: 'model-fallback' }));

    const result = await reportsModule.__translationInternals.translateDynamicText(
      'Message supplementaire d un resident confirmant les memes dommages dans les maisons autour de la cour.',
      'en'
    );

    expect(result.completed).toBe(true);
    expect(result.model).toBe('model-fallback');
    expect(result.translated).toContain('Additional message from a resident');
    expect(result.attemptsUsed).toBe(2);
  });

  it('rejects unchanged source-text responses and falls back to the next translation model', async () => {
    const reportsModule = await loadReportsModule();
    const source = 'Message supplementaire d un resident confirmant les memes dommages dans les maisons autour de la cour.';
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: source } }], model: 'model-primary' }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Additional message from a resident confirming the same damage in the houses around the courtyard.' } }], model: 'model-fallback' }));

    const result = await reportsModule.__translationInternals.translateDynamicText(source, 'en');

    expect(result.completed).toBe(true);
    expect(result.model).toBe('model-fallback');
    expect(result.translated).toContain('Additional message from a resident');
    expect(result.attemptsUsed).toBe(2);
  });

  it('marks missing non-English to English translations pending and enqueues once on read', async () => {
    const reportsModule = await loadReportsModule();
    queryAllMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM report_translations')) return [];
      if (sql.includes('FROM translation_jobs')) return [];
      return [];
    });

    const [report] = await reportsModule.resolveTranslationsForMany([{
      id: 'r1',
      description: 'مدرسة متضررة',
      address_text: '',
      infra_name: '',
      source_language: 'ar',
      translations: {},
    }], 'en');

    expect(report.translation_status).toBe('pending');
    expect(report.translation_target_lang).toBe('en');
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0]).toContain('INSERT INTO translation_jobs');
  });

  it('does not enqueue again when a target-language job already exists', async () => {
    const reportsModule = await loadReportsModule();
    queryAllMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM report_translations')) return [];
      if (sql.includes('FROM translation_jobs')) {
        return [{ id: 'job-1', report_id: 'r1', target_lang: 'ru', status: 'pending', attempt_count: 0 }];
      }
      return [];
    });

    const [report] = await reportsModule.resolveTranslationsForMany([{
      id: 'r1',
      description: 'Damaged school',
      address_text: '',
      infra_name: '',
      source_language: 'en',
      translations: {},
    }], 'ru');

    expect(report.translation_status).toBe('pending');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('requeues a failed terminal translation only when retryFailed is enabled', async () => {
    const reportsModule = await loadReportsModule();
    queryAllMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM report_translations')) return [];
      if (sql.includes('FROM translation_jobs')) {
        return [{ id: 'job-1', report_id: 'r1', target_lang: 'en', status: 'failed_terminal', attempt_count: 5 }];
      }
      return [];
    });

    const baseReport = {
      id: 'r1',
      description: 'Maison endommagee',
      address_text: '',
      infra_name: '',
      source_language: 'fr',
      translations: {},
    };

    const [withoutRetry] = await reportsModule.resolveTranslationsForMany([baseReport], 'en');
    expect(withoutRetry.translation_status).toBe('failed');
    expect(executeMock).not.toHaveBeenCalled();

    executeMock.mockClear();

    const [withRetry] = await reportsModule.resolveTranslationsForMany([baseReport], 'en', { retryFailed: true });
    expect(withRetry.translation_status).toBe('pending');
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0]).toContain('INSERT INTO translation_jobs');
  });

  it('treats unchanged cached translations as missing and requeues them on read', async () => {
    const reportsModule = await loadReportsModule();
    queryAllMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM report_translations')) {
        return [{
          report_id: 'r1',
          field_name: 'description',
          target_lang: 'en',
          translated_text: 'Message supplementaire d un resident confirmant les memes dommages dans les maisons autour de la cour.',
        }];
      }
      if (sql.includes('FROM translation_jobs')) {
        return [{ id: 'job-1', report_id: 'r1', target_lang: 'en', status: 'completed', attempt_count: 1 }];
      }
      return [];
    });

    const [report] = await reportsModule.resolveTranslationsForMany([{
      id: 'r1',
      description: 'Message supplementaire d un resident confirmant les memes dommages dans les maisons autour de la cour.',
      address_text: '',
      infra_name: '',
      source_language: 'fr',
      translations: {},
    }], 'en');

    expect(report.translation_status).toBe('pending');
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0]).toContain('INSERT INTO translation_jobs');
  });

  it('dedupes concurrent worker translation for the same field and target', async () => {
    const reportsModule = await loadReportsModule();
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM report_translations')) return undefined;
      return undefined;
    });
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'Escuela dañada' } }], model: 'model-primary' }));

    const [first, second] = await Promise.all([
      reportsModule.__translationInternals.translateAndPersistField('r1', 'description', 'Damaged school', 'es', 'en'),
      reportsModule.__translationInternals.translateAndPersistField('r1', 'description', 'Damaged school', 'es', 'en'),
    ]);

    expect(first.completed).toBe(true);
    expect(second.completed).toBe(true);
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
  });

  it('worker persists successful translations and completes the target job', async () => {
    const reportsModule = await loadReportsModule();
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, description')) {
        return {
          id: 'r1',
          description: 'Damaged school',
          address_text: '',
          building_label: '',
          infra_name: '',
          source_language: 'en',
          translation_status: 'pending',
        };
      }
      if (sql.includes('FROM report_translations')) return undefined;
      return undefined;
    });
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'Escuela dañada' } }], model: 'model-primary' }));

    await reportsModule.__translationInternals.processTranslationJob({
      id: 'job-1',
      report_id: 'r1',
      target_lang: 'es',
      status: 'processing',
      attempt_count: 0,
    });

    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO report_translations'))).toBe(true);
    expect(executeMock.mock.calls.some(([sql, params]) => String(sql).includes('UPDATE reports SET translation_status') && params?.[0] === 'completed')).toBe(true);
    expect(executeMock.mock.calls.some(([sql, params]) => String(sql).includes('UPDATE translation_jobs SET') && params?.includes('completed'))).toBe(true);
  });

  it('treats corrupted model output as retryable and falls back to the next model', async () => {
    const reportsModule = await loadReportsModule();
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '┐└┘' } }], model: 'model-primary' }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Перевод' } }], model: 'model-fallback' }));

    const result = await reportsModule.__translationInternals.translateDynamicText('Damaged bridge', 'ru');

    expect(result.completed).toBe(true);
    expect(result.model).toBe('model-fallback');
    expect(result.attemptsUsed).toBe(2);
  });

  it('worker moves retryable translation failures into retry_wait without throwing', async () => {
    const reportsModule = await loadReportsModule();
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, description')) {
        return {
          id: 'r1',
          description: 'Damaged school',
          address_text: '',
          building_label: '',
          infra_name: '',
          source_language: 'en',
          translation_status: 'pending',
        };
      }
      if (sql.includes('FROM report_translations')) return undefined;
      return undefined;
    });
    vi.spyOn(globalThis, 'fetch' as any)
      .mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));

    await reportsModule.__translationInternals.processTranslationJob({
      id: 'job-1',
      report_id: 'r1',
      target_lang: 'es',
      status: 'processing',
      attempt_count: 0,
    });

    expect(executeMock.mock.calls.some(([sql, params]) => String(sql).includes('UPDATE translation_jobs SET') && params?.includes('retry_wait'))).toBe(true);
    expect(executeMock.mock.calls.some(([sql, params]) => String(sql).includes('UPDATE reports SET translation_status') && params?.[0] === 'failed')).toBe(true);
  });

  it('reconciles and upserts geocode jobs for historical address-only reports', async () => {
    const reportsModule = await loadReportsModule();
    queryAllMock.mockResolvedValueOnce([{ id: 'r1' }]);
    queryOneMock.mockResolvedValueOnce({ id: 'gj-1', report_id: 'r1', status: 'pending', attempt_count: 0 });

    await reportsModule.__translationInternals.reconcilePendingGeocodeJobs();

    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO report_geocode_jobs'))).toBe(true);
  });

  it('geocode worker persists resolved coordinates and completes the job', async () => {
    const reportsModule = await loadReportsModule();
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM reports WHERE id = ?')) {
        return {
          id: 'r1',
          location_id: 'loc_old',
          version_number: 1,
          location_capture_mode: 'unknown',
          address_text: 'Cahir, Ireland',
          building_label: '',
          lat: null,
          lng: null,
          footprint_set_id: null,
          footprint_feature_id: null,
          footprint_feature_key: null,
        };
      }
      if (sql.includes('FROM report_locations')) return undefined;
      if (sql.includes('SELECT COALESCE(MAX(version_number), 0) + 1 AS v FROM reports WHERE location_id = ?')) return { v: 1 };
      return undefined;
    });
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse([{ lat: '52.3779467', lon: '-7.922583' }]));

    await reportsModule.__translationInternals.processGeocodeJob({
      id: 'gj-1',
      report_id: 'r1',
      status: 'processing',
      attempt_count: 0,
    });

    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes('UPDATE reports') && String(sql).includes('version_number'))).toBe(true);
    expect(executeMock.mock.calls.some(([sql, params]) => String(sql).includes('INSERT INTO report_versions') && params?.includes('geocode_backfill'))).toBe(true);
    expect(executeMock.mock.calls.some(([sql, params]) => String(sql).includes('UPDATE report_geocode_jobs SET') && params?.includes('completed'))).toBe(true);
  });

  it('geocode worker marks no-result lookups terminal', async () => {
    const reportsModule = await loadReportsModule();
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM reports WHERE id = ?')) {
        return {
          id: 'r1',
          address_text: 'Unknown Place',
          lat: null,
          lng: null,
        };
      }
      return undefined;
    });
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse([]));

    await reportsModule.__translationInternals.processGeocodeJob({
      id: 'gj-1',
      report_id: 'r1',
      status: 'processing',
      attempt_count: 0,
    });

    expect(executeMock.mock.calls.some(([sql, params]) => String(sql).includes('UPDATE report_geocode_jobs SET') && params?.includes('failed_terminal') && params?.includes('no_result'))).toBe(true);
  });
});
