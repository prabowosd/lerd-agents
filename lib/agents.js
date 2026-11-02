'use strict';
// Shared logic: read herdr and Orca, map their agents onto a lerd site's
// checkouts, open a checkout in either tool, and send lerd notifications.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// lerd's daemon runs plugins with a narrow PATH, so also look where these tools install.
const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(os.homedir(), '.local/bin'),
  path.join(os.homedir(), '.cargo/bin'), '/Applications/Orca.app/Contents/Resources/bin'];

/**
 * The Orca CLI's name. On Linux it is orca-ide, since /usr/bin/orca is GNOME's
 * screen reader, so bare orca is never tried there.
 */
function orcaName(platform = process.platform, env = process.env) {
  return env.ORCA_BIN || env.ORCA_CLI_COMMAND || (platform === 'linux' ? 'orca-ide' : 'orca');
}

/** Absolute path of an executable on PATH or in the usual install dirs, or null. */
function findOnPath(name) {
  if (name.includes('/')) return name;
  for (const dir of [...(process.env.PATH || '').split(':'), ...EXTRA_DIRS]) {
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // keep looking
    }
  }
  return null;
}

// Each call's timeout is capped by an optional deadline, so a hook stays inside lerd's 30 second limit.
let deadline = Infinity;
function setDeadline(ms) {
  deadline = Date.now() + ms;
}
function budget(ms) {
  const left = deadline - Date.now();
  if (left < 500) throw new Error('out of time');
  return Math.min(ms, left);
}

/** True when out parses as Orca's JSON answer, which always carries a boolean ok. */
function isOrcaAnswer(out) {
  try {
    return typeof JSON.parse(out).ok === 'boolean';
  } catch {
    return false;
  }
}

const resolved = {};
/** The binary for herdr or orca, or null. Orca counts only once it answers with Orca's JSON. */
function tool(cmd) {
  if (cmd in resolved) return resolved[cmd];
  let bin = null;
  if (cmd === 'herdr') {
    bin = findOnPath(process.env.HERDR_BIN || 'herdr');
  } else if (cmd === 'orca') {
    const found = findOnPath(orcaName());
    try {
      const out = found && execFileSync(found, ['status', '--json'], { encoding: 'utf8', timeout: budget(5000), stdio: ['ignore', 'pipe', 'ignore'] });
      bin = found && isOrcaAnswer(out) ? found : null;
    } catch (e) {
      // Orca exits non-zero with its JSON on stdout when its runtime is down.
      bin = found && isOrcaAnswer((e.stdout || '').toString()) ? found : null;
    }
  } else {
    bin = findOnPath(cmd);
  }
  resolved[cmd] = bin;
  return bin;
}

/** Run a CLI and parse its JSON answer; null when the tool is missing or not running. */
function runJson(cmd, args, timeout = 8000) {
  try {
    const bin = tool(cmd);
    if (!bin) return null;
    const out = execFileSync(bin, args, { encoding: 'utf8', timeout: budget(timeout), stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Run a CLI for its side effect; throws with the tool's own error text. */
function runOrThrow(cmd, args, timeout = 15000) {
  const bin = tool(cmd);
  if (!bin) throw new Error(`${cmd === 'orca' ? orcaName() : cmd} was not found, or is not Orca's CLI`);
  try {
    return execFileSync(bin, args, { encoding: 'utf8', timeout: budget(timeout), stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString().trim();
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed: ${msg}`);
  }
}

/**
 * The site's checkouts from git: the main one first, then each worktree,
 * with the name git keeps it under in .git/worktrees (what lerd's events send).
 */
function siteFolders(sitePath) {
  let out = '';
  try {
    out = execFileSync('git', ['-C', sitePath, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return [{ path: sitePath, branch: '', name: '' }];
  }
  return parseWorktreeList(out).map((w, i) => ({ ...w, name: i === 0 ? '' : worktreeName(w.path) }));
}

/** Parse `git worktree list --porcelain` into [{path, branch}]. */
function parseWorktreeList(text) {
  const rows = [];
  for (const block of text.split(/\n\n+/)) {
    const p = block.match(/^worktree (.+)$/m);
    if (!p) continue;
    const b = block.match(/^branch refs\/heads\/(.+)$/m);
    rows.push({ path: p[1], branch: b ? b[1] : '' });
  }
  return rows;
}

/** The admin dir name git gave a linked worktree, read from its .git file. */
function worktreeName(dir) {
  try {
    const m = fs.readFileSync(path.join(dir, '.git'), 'utf8').match(/worktrees[\\/]([^\\/\s]+)\s*$/);
    return m ? m[1] : path.basename(dir);
  } catch {
    return path.basename(dir);
  }
}

/** The deepest folder that holds dir, so a nested worktree wins over the main checkout. */
function ownerFolder(dir, folders) {
  if (!dir) return null;
  let best = null;
  for (const f of folders) {
    if ((dir === f.path || dir.startsWith(f.path + '/')) && (!best || f.path.length > best.path.length)) best = f;
  }
  return best;
}

/** herdr's live agents, or null when its server is not running. */
function herdrAgents() {
  const res = runJson('herdr', ['agent', 'list']);
  return res && res.result ? res.result.agents || [] : null;
}

/** Orca's worktrees with their agents, or null when Orca is not running. */
function orcaWorktrees() {
  const res = runJson('orca', ['worktree', 'ps', '--json', '--limit', '1000']);
  return res && res.ok ? res.result.worktrees || [] : null;
}

/** Normalise both tools into one row shape per agent, keyed to the site's folders. */
function collectRows(folders, herdr = herdrAgents(), orca = orcaWorktrees()) {
  const rows = [];
  for (const a of herdr || []) {
    const f = ownerFolder(a.foreground_cwd || a.cwd, folders);
    if (!f) continue;
    rows.push({
      tool: 'herdr', id: `herdr:${a.pane_id}`, folder: f.path, branch: f.branch,
      agent: a.agent || a.kind || 'agent', name: a.name || a.pane_id,
      state: a.agent_status || 'unknown', summary: '',
    });
  }
  for (const w of orca || []) {
    const f = folders.find((x) => x.path === w.path);
    if (!f) continue;
    for (const a of w.agents || []) {
      rows.push({
        tool: 'orca', id: `orca:${a.paneKey}`, folder: f.path, branch: f.branch,
        agent: a.agentType || 'agent', name: a.displayName || a.taskTitle || a.agentType || 'agent',
        state: a.state || 'unknown', summary: clip(a.lastAssistantMessage || a.prompt || '', 200),
      });
    }
  }
  return rows;
}

function clip(text, n) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Status of one site: which tools answer, and every agent in its checkouts. */
function siteStatus(sitePath) {
  const folders = siteFolders(sitePath);
  const herdr = herdrAgents();
  const orca = orcaWorktrees();
  return {
    tools: { herdr: herdr !== null, orca: orca !== null },
    folders,
    agents: collectRows(folders, herdr, orca),
  };
}

/** Focus the herdr workspace already in dir, or create one there. */
function openInHerdr(dir, label, focus = true) {
  const panes = runJson('herdr', ['pane', 'list']);
  if (!panes || !panes.result) throw new Error('herdr is not running. Open herdr first, then try again.');
  const hit = (panes.result.panes || []).find((p) => p.cwd === dir || p.foreground_cwd === dir);
  if (hit) {
    if (focus) runOrThrow('herdr', ['workspace', 'focus', hit.workspace_id]);
    return { workspace_id: hit.workspace_id, created: false };
  }
  const res = JSON.parse(runOrThrow('herdr', ['workspace', 'create', '--cwd', dir, '--label', label, focus ? '--focus' : '--no-focus']));
  return { workspace_id: res.result.workspace.workspace_id, created: true };
}

/** Make sure Orca knows the site's repo and shows worktrees it did not create. */
function ensureOrcaRepo(sitePath) {
  if (!tool('orca')) throw new Error(`Orca's CLI (${orcaName()}) was not found, or did not answer like Orca. Install Orca, or set ORCA_BIN.`);
  const repos = runJson('orca', ['repo', 'list', '--json']);
  if (!repos || !repos.ok) throw new Error('Orca is not running. Open Orca first, then try again.');
  const repo = (repos.result.repos || []).find((r) => r.path === sitePath);
  if (!repo) runOrThrow('orca', ['repo', 'add', '--path', sitePath, '--json']);
  if (!repo || repo.externalWorktreeVisibility !== 'show') {
    runOrThrow('orca', ['repo', 'set', '--repo', `path:${sitePath}`, '--external-worktree-visibility', 'show', '--json']);
  }
}

/** Switch Orca to a terminal in dir, creating one when the checkout has none. */
function openInOrca(sitePath, dir) {
  ensureOrcaRepo(sitePath);
  const list = runJson('orca', ['terminal', 'list', '--worktree', `path:${dir}`, '--json']);
  const term = list && list.ok ? (list.result.terminals || []).find((t) => t.connected) : null;
  if (term) {
    runOrThrow('orca', ['terminal', 'switch', '--terminal', term.handle, '--json']);
    return { terminal: term.handle, created: false };
  }
  runOrThrow('orca', ['terminal', 'create', '--worktree', `path:${dir}`, '--focus', '--json']);
  return { created: true };
}

/** Send a lerd notification; silently skipped when the user has not allowed them. */
async function notify({ title, body, url, tag }) {
  const res = await fetch(`${process.env.LERD_API_URL}/api/notifications/plugin`, {
    method: 'POST',
    headers: { 'X-Lerd-Plugin-Token': process.env.LERD_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: clip(title, 100), body: clip(body || '', 300), url, tag }),
  });
  return res.status;
}

/** lerd's sites with their paths, through its API. */
async function lerdSites() {
  const res = await fetch(`${process.env.LERD_API_URL}/api/sites`, {
    headers: { 'X-Lerd-Plugin-Token': process.env.LERD_API_TOKEN },
  });
  if (!res.ok) throw new Error(`lerd /api/sites answered ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : data.sites || []).filter((s) => s.path);
}

/** JSON file in the plugin's own data folder. */
function store(file) {
  const p = path.join(process.env.LERD_PLUGIN_DATA, file);
  return {
    read() { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } },
    write(v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); },
  };
}

/** The checkout a site command or endpoint runs in, refused unless it belongs to the site. */
function resolveDir(sitePath, dir) {
  const folders = siteFolders(sitePath);
  const real = fs.realpathSync(dir);
  const f = folders.find((x) => x.path === dir || x.path === real);
  if (!f) throw new Error(`${dir} is not a checkout of this site`);
  return f;
}

module.exports = {
  orcaName, isOrcaAnswer, setDeadline, runJson, siteFolders, parseWorktreeList, worktreeName, ownerFolder, collectRows, clip,
  herdrAgents, orcaWorktrees, siteStatus, openInHerdr, ensureOrcaRepo, openInOrca,
  notify, lerdSites, store, resolveDir,
};
