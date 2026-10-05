import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryOneMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
}));

vi.mock('../dbRuntime', () => ({
  execute: vi.fn(),
  queryAll: vi.fn(),
  queryOne: queryOneMock,
}));

describe('aiSettings translation chain defaults', () => {
  beforeEach(() => {
    vi.resetModules();
    queryOneMock.mockReset().mockResolvedValue(undefined);
    process.env.TRANSLATION_MODEL = 'model-primary-env';
    process.env.TRANSLATION_FALLBACK_MODELS = 'model-fallback-env-1,model-fallback-env-2';
  });

  it('hydrates translation fallback chain from legacy env defaults when DB settings are empty', async () => {
    const module = await import('./aiSettings');

    await expect(module.getAiModelChain('translation')).resolves.toEqual([
      'model-primary-env',
      'model-fallback-env-1',
      'model-fallback-env-2',
      'openai/gpt-oss-120b:free',
      'openai/gpt-oss-20b:free',
      'openrouter/free',
    ]);
  });
});
