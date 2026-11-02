'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseWorktreeList, ownerFolder, collectRows } = require('../lib/agents');
const { transitions } = require('../bin/watch');

const folders = [
  { path: '/www/shop', branch: 'dev', name: '' },
  { path: '/www/shop/shop-feat-x', branch: 'feat-x', name: 'shop-feat-x' },
];

test('parses git worktree porcelain, detached heads included', () => {
  const text = 'worktree /www/shop\nHEAD abc\nbranch refs/heads/dev\n\nworktree /tmp/wt\nHEAD def\ndetached\n';
  assert.deepStrictEqual(parseWorktreeList(text), [
    { path: '/www/shop', branch: 'dev' },
    { path: '/tmp/wt', branch: '' },
  ]);
});

test('a nested worktree wins over the main checkout, a sibling prefix does not match', () => {
  assert.strictEqual(ownerFolder('/www/shop/shop-feat-x/app', folders).branch, 'feat-x');
  assert.strictEqual(ownerFolder('/www/shop/app', folders).branch, 'dev');
  assert.strictEqual(ownerFolder('/www/shopping', folders), null);
});

test('collects herdr and orca agents for the site only', () => {
  const herdr = [
    { pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', cwd: '/www/shop', foreground_cwd: '/www/shop/shop-feat-x' },
    { pane_id: 'w2:p1', agent: 'codex', agent_status: 'idle', cwd: '/elsewhere' },
  ];
  const orca = [
    { path: '/www/shop', agents: [{ paneKey: 'k1', agentType: 'claude', state: 'done', lastAssistantMessage: 'All\n done' }] },
    { path: '/other', agents: [{ paneKey: 'k2', agentType: 'codex', state: 'working' }] },
  ];
  const rows = collectRows(folders, herdr, orca);
  assert.deepStrictEqual(rows.map((r) => [r.id, r.branch, r.state]), [
    ['herdr:w1:p1', 'feat-x', 'working'],
    ['orca:k1', 'dev', 'done'],
  ]);
  assert.strictEqual(rows[1].summary, 'All done');
});

test('a tool that is not running contributes nothing', () => {
  assert.deepStrictEqual(collectRows(folders, null, null), []);
});

test('notifies on working to done and on newly blocked, never on first sight', () => {
  const prev = new Map([['a', 'working'], ['b', 'working'], ['c', 'idle'], ['d', 'blocked']]);
  const rows = [
    { id: 'a', state: 'done' },
    { id: 'b', state: 'blocked' },
    { id: 'c', state: 'done' },
    { id: 'd', state: 'blocked' },
    { id: 'e', state: 'blocked' },
  ];
  assert.deepStrictEqual(transitions(prev, rows).map((e) => [e.id, e.kind]), [['a', 'done'], ['b', 'blocked']]);
});

const { orcaName, isOrcaAnswer, setDeadline, runJson } = require('../lib/agents');

test('Linux looks up orca-ide only, never the screen reader name', () => {
  assert.strictEqual(orcaName('linux', {}), 'orca-ide');
  assert.strictEqual(orcaName('darwin', {}), 'orca');
  assert.strictEqual(orcaName('linux', { ORCA_BIN: '/opt/orca/bin/orca-ide' }), '/opt/orca/bin/orca-ide');
  assert.strictEqual(orcaName('linux', { ORCA_CLI_COMMAND: 'orca-dev' }), 'orca-dev');
});

test("a binary counts as Orca only when it answers with Orca's JSON", () => {
  assert.ok(isOrcaAnswer('{"id":"x","ok":true,"result":{}}'));
  assert.ok(isOrcaAnswer('{"ok":false,"error":{"code":"runtime_unreachable"}}'));
  assert.ok(!isOrcaAnswer('The following are not valid: --json'));
  assert.ok(!isOrcaAnswer('{"result":{}}'));
});

test('a spent deadline skips calls instead of running them', () => {
  setDeadline(0);
  assert.strictEqual(runJson('git', ['--version']), null);
  setDeadline(Infinity);
});
