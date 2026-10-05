import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./aiSettings', () => ({
  getAiModelChain: vi.fn(),
  TRANSLATION_REQUEST_TIMEOUT_MS: 5000,
}));

import { getAiModelChain } from './aiSettings';
import { autoTranslateUiKey } from './uiLocaleTranslation';

function response(body: unknown, init?: { status?: number; ok?: boolean }) {
  const status = init?.status ?? 200;
  const ok = init?.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as any;
}

describe('autoTranslateUiKey', () => {
  const originalKey = process.env.AI_API_KEY;

  beforeEach(() => {
    process.env.AI_API_KEY = 'test-key';
    vi.mocked(getAiModelChain).mockResolvedValue(['model-primary', 'model-fallback-1', 'model-fallback-2']);
  });

  afterEach(() => {
    process.env.AI_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('retries through the configured translation chain until a model succeeds', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(response({ error: { message: 'rate limited', code: 429 } }, { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(response({ choices: [{ message: { content: JSON.stringify({ 'nav.home': 'Accueil test' }) } }] }));

    const result = await autoTranslateUiKey('fr', 'nav.home', 'Home');

    expect(result.value).toBe('Accueil test');
    expect(result.model).toBe('model-fallback-2');
    expect((globalThis.fetch as any).mock.calls).toHaveLength(3);
  });

  it('fails only after all three translation models are exhausted', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(response({ error: { message: 'failure 1', code: 500 } }, { status: 500 }))
      .mockResolvedValueOnce(response({ error: { message: 'failure 2', code: 502 } }, { status: 502 }))
      .mockResolvedValueOnce(response({ error: { message: 'failure 3', code: 503 } }, { status: 503 }));

    await expect(autoTranslateUiKey('fr', 'nav.home', 'Home')).rejects.toThrow(/model-fallback-2/i);
    expect((globalThis.fetch as any).mock.calls).toHaveLength(3);
  });
});
