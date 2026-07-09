const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { FakeAdapter } = require('../dist/adapters/fake/adapter');
const { resolveModelSeat } = require('../dist/core/phase_engine/cognition');
const { PhaseEngine } = require('../dist/core/phase_engine/engine');

const repoRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(repoRoot, 'modes', 'standard.yaml');

function response(phase, result) {
  return FakeAdapter.response(phase, result);
}

function validOrientOutput() {
  return {
    reasoning_class: 'software build',
    finished_result_image: 'artifact exists and verification passes',
    done_criteria: ['verification passed'],
  };
}

function validResearchOutput() {
  return {
    sources_read: [{ url: 'local source', depth: 'core', key_extract: 'standard harness source shape' }],
    gaps: [],
  };
}

function validPlanOutput() {
  return {
    architecture: { components: [{ name: 'artifact writer', prevents: 'missing artifact', contract: 'write file' }] },
    file_changes: [{ path: 'artifact.txt', action: 'create', purpose: 'test artifact' }],
    sequence: [{ step: 1, action: 'produce artifact', depends_on: [] }],
    risks: [],
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
    commands_run: [{ command: 'npm test', exit_code: 0, stdout_excerpt: 'pass' }],
    files_checked: ['artifact.txt'],
    residual_risk: [],
  };
}

function validRedTeamOutput() {
  return {
    vulnerabilities_found: [],
    ship_verdict: 'SAFE_TO_SHIP',
  };
}

function validSynthesizeOutput() {
  return {
    plain_language_summary: 'artifact was produced and verified',
    key_takeaways: ['verified'],
  };
}

function standardResponses(overrides = {}) {
  const byPhase = {
    orient: FakeAdapter.complete(validOrientOutput()),
    research: FakeAdapter.complete(validResearchOutput()),
    plan: FakeAdapter.complete(validPlanOutput()),
    execute: FakeAdapter.complete(validExecuteOutput(), ['artifact.txt']),
    verify: FakeAdapter.complete(validVerifyOutput()),
    red_team: FakeAdapter.complete(validRedTeamOutput()),
    synthesize: FakeAdapter.complete(validSynthesizeOutput()),
    ...overrides,
  };
  return Object.entries(byPhase).map(([phase, result]) => response(phase, result));
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
  const run = await runEngine('happy', standardResponses());

  assert.equal(run.result.status, 'complete');
  assert.equal(run.verdict.status, 'complete');
  assert.equal(run.verdict.execution_status, 'complete');
  assert.equal(run.verdict.verification_status, 'pass');
  assert.equal(run.verdict.final_status, 'success');
  assert.deepEqual(run.verdict.phases_completed, ['orient', 'research', 'plan', 'execute', 'verify', 'red_team', 'synthesize']);
  assert.deepEqual(run.verdict.artifacts, ['artifact.txt']);
  assert.equal(run.verdict.artifact_manifest[0].exists, true);
  assert.equal(run.verdict.artifact_manifest[0].inside_workspace, true);
  assert.equal(typeof run.verdict.artifact_manifest[0].sha256, 'string');
  assert.equal(run.adapter.remainingResponses(), 0);
});

test('PhaseEngine stops blocked runs at the blocked phase', async () => {
  const run = await runEngine('blocked', standardResponses({
    execute: FakeAdapter.rateLimit('quota exhausted'),
  }));

  assert.equal(run.result.status, 'blocked');
  assert.equal(run.verdict.status, 'blocked');
  assert.deepEqual(run.verdict.phases_completed, ['orient', 'research', 'plan']);
  assert.equal(run.state.current_phase, 'execute');
  assert.equal(run.state.last_error, 'quota exhausted');
  assert.equal(run.plan.phases.find((phase) => phase.name === 'execute').status, 'blocked');
  assert.equal(run.adapter.remainingResponses(), 3);
});

test('PhaseEngine fails final status when verifier returns fail', async () => {
  const run = await runEngine('verify-fail', standardResponses({
    verify: FakeAdapter.complete({
      verdict: 'fail',
      evidence: ['artifact is wrong'],
      commands_run: [{ command: 'npm test', exit_code: 1, stdout_excerpt: 'failed' }],
      files_checked: ['artifact.txt'],
      residual_risk: ['needs fix'],
    }),
  }));

  assert.equal(run.result.status, 'failed');
  assert.equal(run.verdict.status, 'failed');
  assert.equal(run.verdict.execution_status, 'complete');
  assert.equal(run.verdict.verification_status, 'fail');
  assert.equal(run.verdict.final_status, 'failed_verification');
  assert.deepEqual(run.verdict.phases_completed, ['orient', 'research', 'plan', 'execute', 'verify', 'red_team', 'synthesize']);
});

test('PhaseEngine rejects claimed artifacts that do not exist inside the workspace', async () => {
  const workspaceRoot = await makeWorkspace('bad-artifact');
  const sessionId = 'bad-artifact-session';
  const adapter = new FakeAdapter({
    responses: standardResponses({
      execute: {
        status: 'complete',
        output: { result: 'claimed bad artifact', artifacts: ['../outside.txt'] },
        artifacts: ['../outside.txt'],
        raw_transcript: '{}',
      },
    }),
  });
  const engine = new PhaseEngine({
    sessionId,
    mode: 'standard',
    goal: 'test bad artifact',
    workspaceRoot,
    workflowPath,
    primaryModel: 'caller',
    adapter,
  });

  try {
    const result = await engine.run();
    const verdict = await readJson(path.join(workspaceRoot, '.cc-harness', 'sessions', sessionId, 'verdict.json'));
    assert.equal(result.status, 'failed');
    assert.equal(verdict.final_status, 'failed_artifact');
    assert.match(verdict.summary, /outside the workspace/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('PhaseEngine stops failed runs at the failed phase', async () => {
  const run = await runEngine('failed', standardResponses({
    execute: FakeAdapter.failed('tool crashed'),
  }));

  assert.equal(run.result.status, 'failed');
  assert.equal(run.verdict.status, 'failed');
  assert.deepEqual(run.verdict.phases_completed, ['orient', 'research', 'plan']);
  assert.equal(run.state.current_phase, 'execute');
  assert.equal(run.state.last_error, 'tool crashed');
  assert.equal(run.plan.phases.find((phase) => phase.name === 'execute').status, 'failed');
  assert.equal(run.adapter.remainingResponses(), 3);
});

test('PhaseEngine fails gracefully when phase output misses required contract fields', async () => {
  const run = await runEngine('wrong-contract', standardResponses({
    execute: FakeAdapter.wrongContract(),
  }));

  assert.equal(run.result.status, 'failed');
  assert.equal(run.verdict.status, 'failed');
  assert.match(run.verdict.summary, /missing required key 'result'/);
  assert.match(run.verdict.summary, /missing required key 'artifacts'/);
  assert.equal(run.plan.phases.find((phase) => phase.name === 'execute').status, 'failed');
});

test('PhaseEngine treats non-object output as validation failure without throwing', async () => {
  const run = await runEngine('invalid-json-output', standardResponses({
    plan: FakeAdapter.invalidJson('not-json'),
  }));

  assert.equal(run.result.status, 'failed');
  assert.equal(run.verdict.status, 'failed');
  assert.deepEqual(run.verdict.phases_completed, ['orient', 'research']);
  assert.match(run.verdict.summary, /phase output must be a JSON object/);
  assert.equal(run.plan.phases.find((phase) => phase.name === 'plan').status, 'failed');
});


test('PhaseEngine injects cognition packs and writes phase flight recorder artifacts', async () => {
  const workspaceRoot = await makeWorkspace('trace');
  const sessionId = 'trace-session';
  const workflowPath = path.join(workspaceRoot, 'trace-mode.yaml');
  await require('node:fs/promises').writeFile(workflowPath, `mode: trace
phases:
  - name: diagnose
    type: analyze
    model: planner
    cognition: senior_engineer_debug
    max_turns: 7
    max_tool_calls: 11
    output_contract:
      result: string
      artifacts: [string]
`, 'utf8');

  const adapter = new FakeAdapter({
    responses: [response('diagnose', FakeAdapter.complete({ result: 'fixed', artifacts: ['a.txt'] }))],
  });
  const engine = new PhaseEngine({
    sessionId,
    mode: 'trace',
    goal: 'trace the phase',
    workspaceRoot,
    workflowPath,
    primaryModel: 'caller',
    modelAliases: { planner: 'claude-opus-4-5' },
    adapter,
  });

  try {
    const result = await engine.run();
    const traceRoot = path.join(workspaceRoot, '.cc-harness', 'sessions', sessionId, 'traces', 'diagnose');
    const prompt = await readFile(path.join(traceRoot, 'prompt.txt'), 'utf8');
    const invocation = await readJson(path.join(traceRoot, 'adapter_invocation.json'));
    const validation = await readJson(path.join(traceRoot, 'validation.json'));
    const parsed = await readJson(path.join(traceRoot, 'parsed_output.json'));
    const timing = await readJson(path.join(traceRoot, 'timing.json'));
    const raw = await readFile(path.join(traceRoot, 'raw_transcript.jsonl'), 'utf8');

    assert.equal(result.status, 'complete');
    assert.match(prompt, /Cognition pack:\*\* senior_engineer_debug/);
    assert.match(prompt, /Use hypothesis isolation before editing/);
    assert.equal(invocation.adapter, 'fake');
    assert.equal(invocation.model, 'claude-opus-4-5');
    assert.equal(invocation.max_turns, 7);
    assert.equal(invocation.max_tool_calls, 11);
    assert.equal(validation.valid, true);
    assert.deepEqual(parsed, { result: 'fixed', artifacts: ['a.txt'] });
    assert.equal(typeof timing.duration_ms, 'number');
    assert.match(raw, /fixed/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('resolveModelSeat preserves literal high-tier model names', () => {
  assert.deepEqual(resolveModelSeat('caller', 'claude-sonnet-4-5'), {
    requested: 'caller',
    resolved: 'claude-sonnet-4-5',
    source: 'caller',
  });
  assert.deepEqual(resolveModelSeat('fable', 'claude-sonnet-4-5'), {
    requested: 'fable',
    resolved: 'fable',
    source: 'literal',
  });
  assert.deepEqual(resolveModelSeat('planner', 'claude-sonnet-4-5', { planner: 'fable' }), {
    requested: 'planner',
    resolved: 'fable',
    source: 'alias',
  });
});
