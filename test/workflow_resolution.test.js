const assert = require('node:assert/strict');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

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
