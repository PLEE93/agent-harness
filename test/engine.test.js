const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { FakeAdapter } = require('../dist/adapters/fake/adapter');
const { PhaseEngine } = require('../dist/core/phase_engine/engine');

const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, 'modes', 'standard.yaml');

function response(phase, result) {
  return FakeAdapter.response(phase, result);
}

function validPlanOutput() {
  return {
    phases: [{ name: 'execute', goal: 'produce artifact' }],
    done_criteria: ['verification passed'],
  };
}

function validExecuteOutput() {
  return {
    result: 'artifact produced',
    artifacts: ['artifact.txt'],
  };
}

function validVerifyOutput() {
  return {
    verdict: 'pass',
    evidence: ['artifact.txt exists'],
  };
}

async function makeWorkspace(label) {
  return mkdtemp(path.join(os.tmpdir(), `cc-harness-${label}-`));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function runEngine(label, responses) {
  const workspaceRoot = await makeWorkspace(label);
  const sessionId = `${label}-session`;
  const adapter = new FakeAdapter({ responses });
  const engine = new PhaseEngine({
    sessionId,
    mode: 'standard',
    goal: `test ${label}`,
    workspaceRoot,
    workflowPath,
    primaryModel: 'caller',
    adapter,
  });

  try {
    const result = await engine.run();
    const sessionRoot = path.join(workspaceRoot, '.cc-harness', 'sessions', sessionId);
    return {
      result,
      adapter,
      sessionRoot,
      verdict: await readJson(path.join(sessionRoot, 'verdict.json')),
      state: await readJson(path.join(sessionRoot, 'state.json')),
      plan: await readJson(path.join(sessionRoot, 'plan.json')),
    };
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('PhaseEngine completes standard mode with fake adapter responses', async () => {
  const run = await runEngine('happy', [
    response('plan', FakeAdapter.complete(validPlanOutput())),
    response('execute', FakeAdapter.complete(validExecuteOutput(), ['artifact.txt'])),
    response('verify', FakeAdapter.complete(validVerifyOutput())),
  ]);

  assert.equal(run.result.status, 'complete');
  assert.equal(run.verdict.status, 'complete');
  assert.deepEqual(run.verdict.phases_completed, ['plan', 'execute', 'verify']);
  assert.deepEqual(run.verdict.artifacts, ['artifact.txt']);
  assert.equal(run.adapter.remainingResponses(), 0);
});

test('PhaseEngine stops blocked runs at the blocked phase', async () => {
  const run = await runEngine('blocked', [
    response('plan', FakeAdapter.complete(validPlanOutput())),
    response('execute', FakeAdapter.rateLimit('quota exhausted')),
    response('verify', FakeAdapter.complete(validVerifyOutput())),
  ]);

  assert.equal(run.result.status, 'blocked');
  assert.equal(run.verdict.status, 'blocked');
  assert.deepEqual(run.verdict.phases_completed, ['plan']);
  assert.equal(run.state.current_phase, 'execute');
  assert.equal(run.state.last_error, 'quota exhausted');
  assert.equal(run.plan.phases.find((phase) => phase.name === 'execute').status, 'blocked');
  assert.equal(run.adapter.remainingResponses(), 1);
});

test('PhaseEngine stops failed runs at the failed phase', async () => {
  const run = await runEngine('failed', [
    response('plan', FakeAdapter.complete(validPlanOutput())),
    response('execute', FakeAdapter.failed('tool crashed')),
    response('verify', FakeAdapter.complete(validVerifyOutput())),
  ]);

  assert.equal(run.result.status, 'failed');
  assert.equal(run.verdict.status, 'failed');
  assert.deepEqual(run.verdict.phases_completed, ['plan']);
  assert.equal(run.state.current_phase, 'execute');
  assert.equal(run.state.last_error, 'tool crashed');
  assert.equal(run.plan.phases.find((phase) => phase.name === 'execute').status, 'failed');
  assert.equal(run.adapter.remainingResponses(), 1);
});

test('PhaseEngine fails gracefully when phase output misses required contract fields', async () => {
  const run = await runEngine('wrong-contract', [
    response('plan', FakeAdapter.complete(validPlanOutput())),
    response('execute', FakeAdapter.wrongContract()),
    response('verify', FakeAdapter.complete(validVerifyOutput())),
  ]);

  assert.equal(run.result.status, 'failed');
  assert.equal(run.verdict.status, 'failed');
  assert.match(run.verdict.summary, /missing required key 'result'/);
  assert.match(run.verdict.summary, /missing required key 'artifacts'/);
  assert.equal(run.plan.phases.find((phase) => phase.name === 'execute').status, 'failed');
});

test('PhaseEngine treats non-object output as validation failure without throwing', async () => {
  const run = await runEngine('invalid-json-output', [
    response('plan', FakeAdapter.invalidJson('not-json')),
    response('execute', FakeAdapter.complete(validExecuteOutput())),
    response('verify', FakeAdapter.complete(validVerifyOutput())),
  ]);

  assert.equal(run.result.status, 'failed');
  assert.equal(run.verdict.status, 'failed');
  assert.deepEqual(run.verdict.phases_completed, []);
  assert.match(run.verdict.summary, /phase output must be a JSON object/);
  assert.equal(run.plan.phases.find((phase) => phase.name === 'plan').status, 'failed');
});
