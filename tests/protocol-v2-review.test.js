import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateRunRecordV2 } from '../protocol/v2/validate.js';

function withPartialUsage(tokens) {
  const record = JSON.parse(readFileSync(new URL('../protocol/v2/fixtures/cloud-focus-week-report-normal.json', import.meta.url), 'utf8'));
  record.usage[0].completeness = 'partial';
  record.usage[0].tokens = tokens;
  return record;
}

for (const tokens of [
  { input: 10, total: 5 },
  { output: 10, total: 5 },
  { inputCached: 10, total: 5 },
  { outputReasoning: 10, total: 5 },
  { inputCached: 7, output: 4, total: 10 },
  { input: 4, outputReasoning: 7, total: 10 },
  { inputCached: 6, outputReasoning: 6, total: 10 },
]) {
  test(`partial usage cannot have a total below observed token subsets: ${JSON.stringify(tokens)}`, () => {
    assert.equal(validateRunRecordV2(withPartialUsage(tokens)).ok, false);
  });
}

for (const tokens of [
  { input: 0, total: 0 },
  { inputCached: 7, total: 10 },
  { inputCached: 7, output: 3, total: 10 },
  { inputCached: 2, input: 7, outputReasoning: 3, total: 10 },
  { inputCached: 7, outputReasoning: 3 },
]) {
  test(`consistent partial usage preserves unknown dimensions: ${JSON.stringify(tokens)}`, () => {
    const record = withPartialUsage(tokens);
    const before = JSON.stringify(record);
    const result = validateRunRecordV2(record);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(JSON.stringify(record), before, 'Validation must not invent missing counts or add subsets twice');
  });
}
