import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { needsLabel, parseCrisisInput, parseNeedsInput } from './messages';

describe('whatsapp message parsers', () => {
  it('parses website-aligned crisis types from numeric input', () => {
    assert.equal(parseCrisisInput('1'), 'earthquake');
    assert.equal(parseCrisisInput('4'), 'hurricane');
    assert.equal(parseCrisisInput('9'), 'civil_unrest');
  });

  it('parses pressing needs as a deduplicated list', () => {
    assert.deepEqual(parseNeedsInput('1,3,7'), ['food_water', 'healthcare', 'infrastructure']);
    assert.deepEqual(parseNeedsInput('1,1,10'), ['food_water', 'other']);
  });

  it('rejects invalid pressing-needs input', () => {
    assert.equal(parseNeedsInput(''), null);
    assert.equal(parseNeedsInput('11'), null);
    assert.equal(parseNeedsInput('1,abc'), null);
  });

  it('renders freeform other-need detail cleanly in confirmations', () => {
    assert.equal(needsLabel(['food_water', 'other:generator fuel'], 'en'), 'Food assistance and safe drinking water, generator fuel');
  });
});
