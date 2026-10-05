import { describe, expect, it } from 'vitest';
import { normalizeClassificationPayload, parseStoredClassification } from './classification';

describe('AI classification contracts', () => {
  it('handles malformed provider responses without trusting string booleans', () => {
    const result = normalizeClassificationPayload({ damage_level: 'invented', confidence: 'Infinity', urgent: 'false', debris_visible: 'true' }, 'model');
    expect(result).toMatchObject({ damage_level: 'unknown', confidence: 0, urgent: false, debris_visible: false });
    expect(normalizeClassificationPayload(null, 'model').damage_level).toBe('unknown');
    expect(parseStoredClassification('not json')).toBeNull();
  });
  it('retains valid provider fields and bounds confidence and reasoning', () => {
    expect(normalizeClassificationPayload({ damage_level: 'DESTROYED', confidence: 20, urgent: true, reasoning: 'a'.repeat(500) }, 'model'))
      .toMatchObject({ damage_level: 'destroyed', confidence: 1, urgent: true, reasoning: 'a'.repeat(160) });
  });
});
