const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadConfig } = require('../dist/core/config/loader');

async function makeWorkspace(label) {
  return mkdtemp(path.join(os.tmpdir(), `cc-harness-${label}-`));
}

test('loadConfig supports explicit per-seat adapter and model routing', async () => {
  const workspaceRoot = await makeWorkspace('seat-config');
  await writeFile(path.join(workspaceRoot, 'cc-harness.config.yaml'), `seats:
  planner:
    adapter: claude-code
    model: claude-opus-4-5
  executor:
    adapter: codex
    model: gpt-5-codex
  verifier:
    adapter: claude-code
    model: claude-opus-4-5
`, 'utf8');

  try {
    const config = await loadConfig(workspaceRoot, workspaceRoot);
    assert.equal(config.seats.planner.adapter, 'claude-code');
    assert.equal(config.seats.planner.model, 'claude-opus-4-5');
    assert.equal(config.seats.executor.adapter, 'codex');
    assert.equal(config.seats.executor.model, 'gpt-5-codex');
    assert.equal(config.seats.verifier.adapter, 'claude-code');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
