import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeStoredPhotoKeys, repairStoredPhotoValue, resolveReportMedia } from './reportMedia';

const mockBuildMediaUrls = vi.fn();
const mockMediaKeyExists = vi.fn();

vi.mock('./media', () => ({
  buildMediaUrls: (...args: any[]) => mockBuildMediaUrls(...args),
  mediaKeyExists: (...args: any[]) => mockMediaKeyExists(...args),
  normalizeStoredKey: (key: string) => key.replace(/^\/+/, '').replace(/\\/g, '/'),
}));

describe('reportMedia', () => {
  beforeEach(() => {
    mockBuildMediaUrls.mockReset();
    mockMediaKeyExists.mockReset();
    mockBuildMediaUrls.mockImplementation(async (keys: string[]) => keys.map((key) => `/uploads/${key}`));
  });

  it('normalizes legacy upload urls into stored keys', () => {
    const normalized = normalizeStoredPhotoKeys(JSON.stringify([
      '/uploads/reports/2026/06/a.jpg',
      'reports/2026/06/b.jpg',
    ]));

    expect(normalized.stored_keys).toEqual([
      'reports/2026/06/a.jpg',
      'reports/2026/06/b.jpg',
    ]);
    expect(normalized.legacy_entries).toEqual(['/uploads/reports/2026/06/a.jpg']);
    expect(normalized.needs_repair).toBe(true);
  });

  it('marks missing files as partial_missing and missing_media', async () => {
    mockMediaKeyExists.mockImplementation(async (key: string) => key.endsWith('a.jpg'));

    const media = await resolveReportMedia(JSON.stringify([
      'reports/2026/06/a.jpg',
      'reports/2026/06/b.jpg',
    ]));

    expect(media.photos).toEqual(['/uploads/reports/2026/06/a.jpg']);
    expect(media.photo_count).toBe(2);
    expect(media.media_state).toBe('partial_missing');
    expect(media.ai_media_eligibility).toBe('missing_media');
  });

  it('marks invalid legacy-only values as invalid_media', async () => {
    const media = await resolveReportMedia(JSON.stringify([
      'https://example.com/file.jpg',
    ]));

    expect(media.photos).toEqual([]);
    expect(media.media_state).toBe('invalid_legacy');
    expect(media.ai_media_eligibility).toBe('invalid_media');
  });

  it('repairs legacy values idempotently', () => {
    const repaired = repairStoredPhotoValue(JSON.stringify([
      '/uploads/reports/2026/06/a.jpg',
      'reports/2026/06/a.jpg',
      '',
    ]));

    expect(repaired.next_keys).toEqual(['reports/2026/06/a.jpg']);
    expect(repaired.changed).toBe(true);
    expect(repaired.legacy_entries).toEqual(['/uploads/reports/2026/06/a.jpg']);
  });
});
