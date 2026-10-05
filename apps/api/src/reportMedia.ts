import { buildMediaUrls, mediaKeyExists, normalizeStoredKey } from './media';

export type MediaState = 'none' | 'ready' | 'partial_missing' | 'invalid_legacy';
export type AiMediaEligibility = 'eligible' | 'no_photos' | 'missing_media' | 'invalid_media';

type MediaReferenceKind = 'stored_key' | 'legacy_url' | 'invalid';

export type NormalizedMediaReference = {
  original: string;
  key: string | null;
  kind: MediaReferenceKind;
};

export type ResolvedReportMedia = {
  raw_entries: string[];
  stored_keys: string[];
  available_keys: string[];
  missing_keys: string[];
  photos: string[];
  photo_count: number;
  media_state: MediaState;
  ai_media_eligibility: AiMediaEligibility;
  broken_entries: string[];
  legacy_entries: string[];
  needs_repair: boolean;
};

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((value) => String(value)).map((value) => value.trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value)).map((value) => value.trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function keyFromLegacyUploadsPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      return keyFromLegacyUploadsPath(parsed.pathname);
    } catch {
      return null;
    }
  }
  const match = normalized.match(/(?:^|\/)uploads\/(.+)$/i);
  if (!match?.[1]) return null;
  return normalizeStoredKey(match[1]);
}

export function normalizeMediaReference(value: string): NormalizedMediaReference {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { original: trimmed, key: null, kind: 'invalid' };

  const legacyKey = keyFromLegacyUploadsPath(trimmed);
  if (legacyKey) {
    return { original: trimmed, key: legacyKey, kind: 'legacy_url' };
  }

  if (/^data:/i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return { original: trimmed, key: null, kind: 'invalid' };
  }

  return { original: trimmed, key: normalizeStoredKey(trimmed), kind: 'stored_key' };
}

export function normalizeStoredPhotoKeys(raw: unknown): {
  raw_entries: string[];
  stored_keys: string[];
  broken_entries: string[];
  legacy_entries: string[];
  needs_repair: boolean;
} {
  const rawEntries = parseJsonArray(raw);
  const storedKeys: string[] = [];
  const brokenEntries: string[] = [];
  const legacyEntries: string[] = [];

  for (const entry of rawEntries) {
    const normalized = normalizeMediaReference(entry);
    if (!normalized.key) {
      brokenEntries.push(entry);
      continue;
    }
    if (normalized.kind === 'legacy_url') {
      legacyEntries.push(entry);
    }
    if (!storedKeys.includes(normalized.key)) {
      storedKeys.push(normalized.key);
    }
  }

  return {
    raw_entries: rawEntries,
    stored_keys: storedKeys,
    broken_entries: brokenEntries,
    legacy_entries: legacyEntries,
    needs_repair: legacyEntries.length > 0 || brokenEntries.length > 0 || storedKeys.length !== rawEntries.length,
  };
}

export async function resolveReportMedia(raw: unknown): Promise<ResolvedReportMedia> {
  const normalized = normalizeStoredPhotoKeys(raw);
  if (normalized.stored_keys.length === 0) {
    return {
      ...normalized,
      available_keys: [],
      missing_keys: [],
      photos: [],
      photo_count: 0,
      media_state: normalized.broken_entries.length > 0 ? 'invalid_legacy' : 'none',
      ai_media_eligibility: normalized.broken_entries.length > 0 ? 'invalid_media' : 'no_photos',
    };
  }

  const availability = await Promise.all(
    normalized.stored_keys.map(async (key) => ({ key, exists: await mediaKeyExists(key) }))
  );
  const availableKeys = availability.filter((entry) => entry.exists).map((entry) => entry.key);
  const missingKeys = availability.filter((entry) => !entry.exists).map((entry) => entry.key);
  const photos = availableKeys.length > 0 ? await buildMediaUrls(availableKeys) : [];

  let mediaState: MediaState = 'ready';
  let aiMediaEligibility: AiMediaEligibility = 'eligible';

  if (normalized.broken_entries.length > 0 && availableKeys.length === 0) {
    mediaState = 'invalid_legacy';
    aiMediaEligibility = 'invalid_media';
  } else if (missingKeys.length > 0 || normalized.broken_entries.length > 0) {
    mediaState = 'partial_missing';
    aiMediaEligibility = availableKeys.length > 0 ? 'missing_media' : (normalized.broken_entries.length > 0 ? 'invalid_media' : 'missing_media');
  }

  return {
    ...normalized,
    available_keys: availableKeys,
    missing_keys: missingKeys,
    photos,
    photo_count: normalized.stored_keys.length,
    media_state: mediaState,
    ai_media_eligibility: aiMediaEligibility,
  };
}

export function repairStoredPhotoValue(raw: unknown): {
  next_keys: string[];
  changed: boolean;
  broken_entries: string[];
  legacy_entries: string[];
} {
  const normalized = normalizeStoredPhotoKeys(raw);
  const current = parseJsonArray(raw);
  const nextKeys = normalized.stored_keys;
  const changed = JSON.stringify(current) !== JSON.stringify(nextKeys);
  return {
    next_keys: nextKeys,
    changed,
    broken_entries: normalized.broken_entries,
    legacy_entries: normalized.legacy_entries,
  };
}
