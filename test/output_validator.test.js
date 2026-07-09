const assert = require('node:assert/strict');
const test = require('node:test');

const { validatePhaseOutput } = require('../dist/core/phase_engine/output_validator');

test('validatePhaseOutput accepts missing contract', () => {
  assert.deepEqual(validatePhaseOutput(undefined, 'plain text is allowed without a contract'), {
    valid: true,
    failures: [],
  });
});

test('validatePhaseOutput accepts matching object, array, and enum fields', () => {
  const result = validatePhaseOutput(
    {
      result: 'string',
      artifacts: ['string'],
      verdict: 'pass|fail',
      metrics: {
        attempts: 'number',
        ok: 'boolean',
      },
    },
    {
      result: 'done',
      artifacts: ['a.txt'],
      verdict: 'pass',
      metrics: {
        attempts: 1,
        ok: true,
      },
    },
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.failures, []);
});

test('validatePhaseOutput reports missing required keys', () => {
  const result = validatePhaseOutput({ result: 'string', artifacts: ['string'] }, { result: 'done' });

  assert.equal(result.valid, false);
  assert.deepEqual(result.failures, ["missing required key 'artifacts'"]);
});

test('validatePhaseOutput reports wrong scalar and array item types', () => {
  const result = validatePhaseOutput(
    { result: 'string', artifacts: ['string'], count: 'number' },
    { result: 42, artifacts: ['ok', 7], count: 'three' },
  );

  assert.equal(result.valid, false);
  assert.deepEqual(result.failures, [
    "key 'result' must be a string, received number",
    "key 'artifacts[1]' must be a string, received number",
    "key 'count' must be a number, received string",
  ]);
});

test('validatePhaseOutput reports enum violations', () => {
  const result = validatePhaseOutput({ verdict: 'pass|fail' }, { verdict: 'maybe' });

  assert.equal(result.valid, false);
  assert.deepEqual(result.failures, ["key 'verdict' must be one of pass, fail, received 'maybe'"]);
});

test('validatePhaseOutput rejects non-object output when a contract exists', () => {
  const result = validatePhaseOutput({ result: 'string' }, 'not-json');

  assert.equal(result.valid, false);
  assert.deepEqual(result.failures, ['phase output must be a JSON object matching the output_contract']);
});
