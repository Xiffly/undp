import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryAllMock,
  queryOneMock,
  formatReportMock,
  resolveTranslationsForManyMock,
} = vi.hoisted(() => ({
  queryAllMock: vi.fn(),
  queryOneMock: vi.fn(),
  formatReportMock: vi.fn(),
  resolveTranslationsForManyMock: vi.fn(),
}));

vi.mock('./dbRuntime', () => ({
  execute: vi.fn(),
  queryAll: queryAllMock,
  queryOne: queryOneMock,
}));

vi.mock('./middleware/auth', () => ({
  authMiddleware: vi.fn((_req, _res, next) => next()),
  requireRole: vi.fn(() => (_req, _res, next) => next()),
}));

vi.mock('./reportMedia', () => ({
  repairStoredPhotoValue: vi.fn((value) => value),
  resolveReportMedia: vi.fn(async () => ({
    photos: [],
    photo_count: 0,
    media_state: 'none',
    ai_media_eligibility: 'no_photos',
    stored_keys: [],
    available_keys: [],
  })),
}));

vi.mock('./routes/reports', () => ({
  formatReport: formatReportMock,
  resolveTranslationsForMany: resolveTranslationsForManyMock,
}));

vi.mock('./services/contributorReputation', () => ({
  applyResolvedAccuracyScore: vi.fn(),
  recomputeContributorProfile: vi.fn(),
}));

vi.mock('./services/moderationSettings', () => ({
  getModerationSettings: vi.fn(),
  getModerationSettingsPayload: vi.fn(),
  setModerationSettings: vi.fn(),
}));

vi.mock('./services/identityLinking', () => ({
  adminVerifyPhone: vi.fn(),
  listIdentityConflicts: vi.fn(),
  manualLinkUserToContributor: vi.fn(),
  mergeContributorProfiles: vi.fn(),
}));

type MockResponse = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  statusCode: number;
  body: unknown;
};

function createMockResponse(): MockResponse {
  const res = {
    statusCode: 200,
    body: undefined,
    status: vi.fn(function (this: MockResponse, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: MockResponse, body: unknown) {
      this.body = body;
      return this;
    }),
  } as unknown as MockResponse;
  return res;
}

async function getRouteHandler(path: string) {
  const module = await import('./routes/admin');
  const router = module.default as any;
  const layer = router.stack.find((entry: any) => entry.route?.path === path && entry.route?.methods?.get);
  if (!layer) throw new Error(`Route not found: ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('admin report translation routes', () => {
  beforeEach(() => {
    vi.resetModules();
    queryAllMock.mockReset().mockResolvedValue([]);
    queryOneMock.mockReset().mockResolvedValue(undefined);
    formatReportMock.mockReset().mockImplementation(async (value) => value);
    resolveTranslationsForManyMock.mockReset().mockImplementation(async (reports) => reports);
  });

  it('does not queue missing translations from admin bulk report reads', async () => {
    const handler = await getRouteHandler('/reports');
    const req = {
      query: { limit: '20', offset: '0', target_lang: 'fr' },
    };
    const res = createMockResponse();

    queryOneMock
      .mockResolvedValueOnce({ c: 1 })
      .mockResolvedValueOnce({ c: 0 });
    queryAllMock.mockResolvedValueOnce([{
      id: 'r1',
      status: 'pending',
      submitted_at: '2026-06-20T10:00:00.000Z',
    }]);
    formatReportMock.mockResolvedValueOnce({
      id: 'r1',
      status: 'pending',
      submitted_at: '2026-06-20T10:00:00.000Z',
      translations: {},
    });
    resolveTranslationsForManyMock.mockResolvedValueOnce([{
      id: 'r1',
      translation_status: 'pending',
      translation_target_lang: 'fr',
    }]);

    await handler(req, res);

    expect(resolveTranslationsForManyMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'r1' })]),
      'fr',
      { queueMissing: false }
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      reports: [expect.objectContaining({ id: 'r1', translation_target_lang: 'fr' })],
      total: 1,
    }));
  });

  it('queues translation resolution from the admin single-report endpoint only for the requested report', async () => {
    const handler = await getRouteHandler('/reports/:id');
    const req = {
      params: { id: 'r42' },
      query: { target_lang: 'ES' },
    };
    const res = createMockResponse();

    queryOneMock.mockResolvedValueOnce({
      id: 'r42',
      status: 'pending',
      submitted_at: '2026-06-20T10:00:00.000Z',
    });
    formatReportMock.mockResolvedValueOnce({
      id: 'r42',
      status: 'pending',
      submitted_at: '2026-06-20T10:00:00.000Z',
      translations: {},
    });
    resolveTranslationsForManyMock.mockResolvedValueOnce([{
      id: 'r42',
      translation_status: 'pending',
      translation_target_lang: 'es',
    }]);

    await handler(req, res);

    expect(resolveTranslationsForManyMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'r42' })],
      'es',
      { retryFailed: true }
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      id: 'r42',
      translation_target_lang: 'es',
    }));
  });

  it('returns 404 when the admin single-report endpoint requests a missing report', async () => {
    const handler = await getRouteHandler('/reports/:id');
    const req = {
      params: { id: 'missing-report' },
      query: { target_lang: 'ar' },
    };
    const res = createMockResponse();

    queryOneMock.mockResolvedValueOnce(undefined);

    await handler(req, res);

    expect(formatReportMock).not.toHaveBeenCalled();
    expect(resolveTranslationsForManyMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
  });
});
