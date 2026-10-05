import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executeMock,
  queryOneMock,
  queryAllMock,
  resolveReportMediaMock,
  readMediaBufferMock,
  getAiModelChainMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  queryOneMock: vi.fn(),
  queryAllMock: vi.fn(),
  resolveReportMediaMock: vi.fn(),
  readMediaBufferMock: vi.fn(),
  getAiModelChainMock: vi.fn(),
}));

vi.mock('./dbRuntime', () => ({
  execute: executeMock,
  queryOne: queryOneMock,
  queryAll: queryAllMock,
}));

vi.mock('./middleware/auth', () => ({
  authMiddleware: vi.fn(),
  requireRole: vi.fn(() => vi.fn()),
}));

vi.mock('./media', () => ({
  readMediaBuffer: readMediaBufferMock,
}));

vi.mock('./reportMedia', () => ({
  resolveReportMedia: resolveReportMediaMock,
}));

vi.mock('./routes/reports', () => ({
  attachTranslationsToMany: vi.fn(async (rows) => rows),
  formatReport: vi.fn(async (row) => row),
}));

vi.mock('./services/contributorReputation', () => ({
  syncReportPhotoQualityFromAi: vi.fn(),
}));

vi.mock('./services/aiSettings', () => ({
  AI_MODEL_LIST_REQUEST_TIMEOUT_MS: 1000,
  AI_REQUEST_TIMEOUT_MS: 1000,
  ensureAiSettingsDefaults: vi.fn(async () => undefined),
  getAiModelChain: getAiModelChainMock,
  getAiSetting: vi.fn(),
  getPublicAiSettings: vi.fn(),
  setAiSetting: vi.fn(),
}));

vi.mock('./services/moderationSettings', () => ({
  getModerationSettings: vi.fn(),
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('normalized-image')),
  })),
}));

async function loadAiModule() {
  return import('./routes/ai');
}

describe('ai worker retry hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.AI_API_KEY = 'test-key';
    executeMock.mockReset().mockResolvedValue(1);
    queryOneMock.mockReset().mockResolvedValue(undefined);
    queryAllMock.mockReset().mockResolvedValue([]);
    getAiModelChainMock.mockReset().mockResolvedValue(['vision-primary']);
    resolveReportMediaMock.mockReset().mockResolvedValue({
      ai_media_eligibility: 'eligible',
      available_keys: ['photo-1'],
      photo_count: 1,
      media_state: 'ready',
      photos: [],
    });
    readMediaBufferMock.mockReset().mockResolvedValue(Buffer.from('fake-image'));
  });

  it('moves generic fetch failures into retry_wait instead of terminal failure', async () => {
    const aiModule = await loadAiModule();
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT ai_classification FROM reports')) return { ai_classification: null };
      if (sql.includes('SELECT * FROM reports WHERE id = ?')) {
        return {
          id: 'r1',
          photos: '[]',
          infra_category: 'residential',
          crisis_type: 'flood',
          damage_level: 'partial',
        };
      }
      return undefined;
    });
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await aiModule.__aiInternals.processClassificationJob({
      id: 'job-1',
      report_id: 'r1',
      status: 'processing',
      attempt_count: 0,
    });

    expect(result.kind).toBe('queued');
    expect(executeMock.mock.calls.some(([sql, params]) => String(sql).includes('UPDATE ai_classify_jobs SET') && params?.includes('retry_wait'))).toBe(true);
    expect(executeMock.mock.calls.some(([sql, params]) => String(sql).includes('UPDATE reports SET ai_classification_status') && params?.[0] === 'pending')).toBe(true);
  });
});
