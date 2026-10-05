import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveInfraCategoryFromTypes } from './intakeMapping';

describe('deriveInfraCategoryFromTypes', () => {
  it('maps house-first selections to residential', () => {
    assert.equal(deriveInfraCategoryFromTypes(['house', 'water']), 'residential');
  });

  it('maps utility selections to utility', () => {
    assert.equal(deriveInfraCategoryFromTypes(['power']), 'utility');
    assert.equal(deriveInfraCategoryFromTypes(['water']), 'utility');
  });

  it('maps school and hospital selections to community', () => {
    assert.equal(deriveInfraCategoryFromTypes(['school']), 'community');
    assert.equal(deriveInfraCategoryFromTypes(['hospital']), 'community');
  });

  it('falls back to other for unknown or empty selections', () => {
    assert.equal(deriveInfraCategoryFromTypes([]), 'other');
    assert.equal(deriveInfraCategoryFromTypes(['unknown']), 'other');
  });
});
