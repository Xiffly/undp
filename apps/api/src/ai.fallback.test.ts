import { afterEach, describe, expect, it, vi } from 'vitest';
import { callWithFallback } from './routes/ai';

function jsonResponse(body: unknown, init?: { status?: number; ok?: boolean }) {
  const status = init?.status ?? 200;
  const ok = init?.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as any;
}

describe('callWithFallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries provider errors until a later model succeeds', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Bad upstream request', code: 'provider_error' } }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Rate limited', code: 429 } }, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'final answer' } }] }));

    const result = await callWithFallback(
      [{ role: 'user', content: 'test' }],
      ['model-primary', 'model-fallback-1', 'model-fallback-2'],
      'test-key',
      'sitrep',
      100
    );

    expect(result).toEqual({
      text: 'final answer',
      model: 'model-fallback-2',
      attemptsUsed: 3,
    });
  });

  it('retries timeouts and invalid responses before succeeding', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'not-json' } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'recovered answer' } }] }));

    const result = await callWithFallback(
      [{ role: 'user', content: 'test' }],
      ['model-a', 'model-b', 'model-c'],
      'test-key',
      'classify',
      100,
      undefined,
      undefined,
      (text, model) => {
        if (model === 'model-b') {
          throw new Error(`invalid response from ${model}: ${text}`);
        }
      }
    );

    expect(result.model).toBe('model-c');
    expect(result.attemptsUsed).toBe(3);
    expect(result.text).toBe('recovered answer');
  });

  it('fails only after all configured models are exhausted', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Downstream 1', code: 500 } }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Downstream 2', code: 502 } }, { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Downstream 3', code: 503 } }, { status: 503 }));

    await expect(callWithFallback(
      [{ role: 'user', content: 'test' }],
      ['model-1', 'model-2', 'model-3'],
      'test-key',
      'sitrep',
      100
    )).rejects.toThrow(/Downstream 3/i);

    expect((globalThis.fetch as any).mock.calls).toHaveLength(3);
  });
});
