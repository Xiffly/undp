

export type ClassificationResult = {
  damage_level: 'minimal' | 'partial' | 'destroyed' | 'unknown';
  confidence: number;
  reasoning: string;
  debris_visible: boolean;
  urgent: boolean;
  model: string;
  classified_at: string;
};

export function clampConfidence(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

export function normalizeClassificationPayload(value: unknown, model: string): ClassificationResult {
  const raw: Record<string, unknown> = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const allowed = new Set(['minimal', 'partial', 'destroyed']);
  const damageLevel = allowed.has(String(raw?.damage_level || '').toLowerCase())
    ? String(raw.damage_level).toLowerCase() as ClassificationResult['damage_level']
    : 'unknown';
  const classifiedAt = typeof raw?.classified_at === 'string' && raw.classified_at.trim()
    ? raw.classified_at
    : new Date().toISOString();
  return {
    damage_level: damageLevel,
    confidence: clampConfidence(raw?.confidence),
    reasoning: String(raw?.reasoning || '').trim().slice(0, 160),
    debris_visible: raw.debris_visible === true,
    urgent: raw.urgent === true,
    model,
    classified_at: classifiedAt,
  };
}

export function parseStoredClassification(raw: unknown): ClassificationResult | null {
  if (!raw) return null;
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const object = parsed as Record<string, unknown>;
    const storedModel = typeof object.model === 'string' && object.model.trim()
      ? object.model
      : 'unknown';
    return normalizeClassificationPayload(parsed, storedModel);
  } catch {
    return null;
  }
}
