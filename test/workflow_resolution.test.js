const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const { resolveWorkflowPath } = require('../dist/cli/commands/run');

const repoRoot = path.resolve(__dirname, '..');

async function withTempCwd(label, fn) {
  const originalCwd = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), `cc-harness-${label}-`));
  process.chdir(workspace);
  try {
    return await fn(workspace);
  } finally {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  }
}

test('resolveWorkflowPath finds package-bundled standard mode outside the package cwd', async () => {
  await withTempCwd('workflow-package', async (workspace) => {
    const resolved = await resolveWorkflowPath('standard');

    assert.equal(resolved, path.join(repoRoot, 'modes', 'standard.yaml'));
    assert.notEqual(resolved, path.join(workspace, 'src', 'modes', 'standard.yaml'));
  });
});

test('resolveWorkflowPath prefers project override before bundled modes', async () => {
  await withTempCwd('workflow-override', async (workspace) => {
    const override = path.join(workspace, '.cc-harness', 'modes', 'standard.yaml');
    await mkdir(path.dirname(override), { recursive: true });
    await writeFile(override, 'mode: standard\nphases: []\n', 'utf8');

    const resolved = await resolveWorkflowPath('standard');

    assert.equal(resolved, override);
  });
});

test('resolveWorkflowPath reports unknown modes clearly', async () => {
  await withTempCwd('workflow-missing', async () => {
    await assert.rejects(
      () => resolveWorkflowPath('missing-mode'),
      /mode 'missing-mode' not found.*Project override: \.cc-harness\/modes\/missing-mode\.yaml/,
    );
  });
});

test('high modes preserve base phase shape and change model routing', async () => {
  const standard = await readMode('standard');
  const standardHigh = await readMode('standard-high');
  const autonomous = await readMode('autonomous');
  const autonomousHigh = await readMode('autonomous-high');

  assert.deepEqual(phaseNames(standardHigh), phaseNames(standard));
  assert.deepEqual(phaseNames(autonomousHigh), phaseNames(autonomous));

  assert.equal(modelFor(standard, 'orient'), 'opus');
  assert.equal(modelFor(standard, 'plan'), 'opus');
  assert.equal(modelFor(standardHigh, 'orient'), 'fable');
  assert.equal(modelFor(standardHigh, 'plan'), 'fable');
  assert.equal(modelFor(standardHigh, 'execute'), modelFor(standard, 'execute'));
  assert.equal(modelFor(standardHigh, 'verify'), modelFor(standard, 'verify'));

  assert.equal(modelFor(autonomous, 'understand'), 'caller');
  assert.equal(modelFor(autonomous, 'plan'), 'caller');
  assert.equal(modelFor(autonomousHigh, 'understand'), 'fable');
  assert.equal(modelFor(autonomousHigh, 'plan'), 'fable');
  assert.equal(modelFor(autonomousHigh, 'execute'), 'caller');
  assert.equal(modelFor(autonomousHigh, 'verify'), 'caller');
});

async function readMode(mode) {
  return yaml.load(await readFile(path.join(repoRoot, 'modes', `${mode}.yaml`), 'utf8'));
}

function phaseNames(mode) {
  return mode.phases.map((phase) => phase.name);
}

function modelFor(mode, phaseName) {
  return mode.phases.find((phase) => phase.name === phaseName)?.model;
}
