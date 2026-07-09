const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile, mkdir } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runHarnessEval } = require('../dist/core/evals/runner');

test('runHarnessEval reports deterministic cases, baseline comparisons, and mined failure cases', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'cc-harness-eval-report-'));
  try {
    const indexRoot = path.join(workspaceRoot, '.cc-harness', 'index');
    await mkdir(indexRoot, { recursive: true });
    await writeFile(
      path.join(indexRoot, 'failures.jsonl'),
      `${JSON.stringify({
        session_id: 'session-123',
        goal: 'fix broken output',
        mode: 'standard',
        failure_type: 'contract_violation',
        detail: "phase 'execute': missing required key 'result'",
        recorded_at: '2026-07-09T00:00:00.000Z',
      })}\n`,
      'utf8',
    );

    const report = await runHarnessEval({ workspaceRoot, writeReport: true });
    assert.equal(report.status, 'pass');
    assert.equal(report.failed_cases, 0);
    assert.equal(report.generated_failure_cases, 1);
    assert.equal(report.baseline_comparisons.length, 3);
    assert.deepEqual(new Set(report.baseline_comparisons.map((item) => item.winner)), new Set(['harness']));
    assert.ok(report.quality_claims.some((claim) => /baseline comparison/.test(claim.claim) && claim.status === 'pass'));

    const generated = await readFile(path.join(workspaceRoot, '.cc-harness', 'evals', 'generated', 'failures.jsonl'), 'utf8');
    assert.match(generated, /failure-session-123-1/);
    assert.match(generated, /Harness must stop the phase/);

    const persistedReport = JSON.parse(
      await readFile(path.join(workspaceRoot, '.cc-harness', 'evals', 'latest-report.json'), 'utf8'),
    );
    assert.equal(persistedReport.status, 'pass');
    assert.equal(persistedReport.baseline_comparisons[0].winner, 'harness');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
