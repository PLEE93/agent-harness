const assert = require('node:assert/strict');
const test = require('node:test');

const { routeTask } = require('../dist/core/router/task_router');

test('routeTask does not treat ordinary code work as high mode', () => {
  assert.equal(routeTask('fix the broken parser').mode, 'standard');
  assert.equal(routeTask('build the CLI feature').mode, 'standard');
  assert.equal(routeTask('audit the repo').mode, 'standard');
});

test('routeTask selects high modes only for explicit high-tier routing language', () => {
  assert.equal(routeTask('fix the broken parser with fable planning').mode, 'standard-high');
  assert.equal(routeTask('autonomous long-running build with fable planning').mode, 'autonomous-high');
});
