// Shared by the site tab and the Overview card: poll the status endpoint and draw it.
(() => {
  const root = document.getElementById('agents');
  const compact = root.dataset.compact === '1';
  const site = lerd.context.site;
  const pill = { working: 'accent', blocked: 'warn', done: 'ok', idle: '', unknown: '' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  async function open(tool, folder) {
    try {
      await lerd.api('open?site=' + encodeURIComponent(site), { method: 'POST', body: { tool, folder } });
    } catch (e) {
      alertBox(e.message);
    }
  }

  function alertBox(msg) {
    const p = document.getElementById('error');
    p.textContent = msg;
    p.hidden = !msg;
  }

  function draw(s) {
    const down = Object.entries(s.tools).filter(([, up]) => !up).map(([t]) => t);
    const note = down.length ? `<p class="lerd-muted">Not running: ${esc(down.join(', '))}</p>` : '';
    if (compact) {
      const counts = {};
      s.agents.forEach((a) => { counts[a.state] = (counts[a.state] || 0) + 1; });
      const pills = Object.entries(counts).map(([k, n]) => `<span class="lerd-pill ${pill[k] || ''}">${n} ${esc(k)}</span>`).join(' ');
      root.innerHTML = (pills || '<span class="lerd-muted">No agents in this site</span>') + note;
      return;
    }
    const rows = s.agents.map((a) => `<tr>
        <td><span class="lerd-pill ${pill[a.state] || ''}">${esc(a.state)}</span></td>
        <td>${esc(a.tool)}</td><td>${esc(a.agent)}</td>
        <td class="lerd-mono">${esc(a.branch || a.folder)}</td>
        <td class="lerd-muted">${esc(a.summary)}</td></tr>`).join('');
    const folders = s.folders.map((f) => `<div class="lerd-row">
        <span class="lerd-mono">${esc(f.branch || f.path)}</span><span class="spacer"></span>
        <button data-tool="herdr" data-folder="${esc(f.path)}" ${s.tools.herdr ? '' : 'disabled'}>herdr</button>
        <button data-tool="orca" data-folder="${esc(f.path)}" ${s.tools.orca ? '' : 'disabled'}>Orca</button></div>`).join('');
    root.innerHTML = `${note}
      <div class="lerd-section"><span class="lerd-label">Agents</span>
        ${rows ? `<div class="lerd-card flush"><table><thead><tr><th>State</th><th>Tool</th><th>Agent</th><th>Checkout</th><th>Last message</th></tr></thead><tbody>${rows}</tbody></table></div>`
               : '<div class="lerd-empty"><strong>No agents</strong>Nothing from herdr or Orca is working in this site.</div>'}
      </div>
      <div class="lerd-section"><span class="lerd-label">Open a checkout</span>
        <div class="lerd-card flush">${folders}</div></div>`;
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tool]');
    if (b) open(b.dataset.tool, b.dataset.folder);
  });

  // Each poll spawns CLIs on the host: skip while hidden, never overlap, cards poll slower.
  let busy = false;
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const body = await lerd.api('status?site=' + encodeURIComponent(site));
      draw(typeof body === 'string' ? JSON.parse(body) : body);
      alertBox('');
    } catch (e) {
      alertBox(e.message);
    } finally {
      busy = false;
    }
  }
  refresh();
  setInterval(refresh, compact ? 30000 : 5000);
  document.addEventListener('visibilitychange', refresh);
})();
