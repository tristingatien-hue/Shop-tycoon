// Settings: shop basics, game tuning (targets, budget, point values),
// sync interval, AI backend — all backed by the same editable config.json.
import { call, h, esc, toast } from '../app.js';

export async function render(el) {
  const [cfg, info] = await Promise.all([call('config.get'), call('app.info')]);
  const g = cfg.game;

  el.appendChild(h(`<div>
    <h1 class="page-title">⚙️ Settings</h1>
    <div class="page-sub">Everything here lives in <span class="mono">${esc(info.dataDir)}\\config.json</span> — tune the game as the business grows.</div>

    <div class="panel"><h2>Shop</h2>
      <div class="grid cols-3">
        <label class="field"><span class="lbl">Shop name</span><input data-c="shopName" value="${esc(cfg.shopName)}"></label>
        <label class="field"><span class="lbl">Currency</span><input data-c="currency" value="${esc(cfg.currency)}"></label>
        <label class="field"><span class="lbl">Sync every (minutes)</span><input data-c="syncIntervalMinutes" type="number" value="${cfg.syncIntervalMinutes}"></label>
      </div>
    </div>

    <div class="panel"><h2>🎯 Targets &amp; budget</h2>
      <div class="grid cols-3">
        <label class="field"><span class="lbl">Monthly revenue target ($)</span><input data-t="monthlyRevenue" type="number" value="${g.targets.monthlyRevenue}"></label>
        <label class="field"><span class="lbl">Monthly unit goal</span><input data-t="monthlyUnits" type="number" value="${g.targets.monthlyUnits}"></label>
        <label class="field"><span class="lbl">Monthly budget ($)</span><input data-t="monthlyBudget" type="number" value="${g.targets.monthlyBudget}"></label>
        <label class="field"><span class="lbl">Weekly revenue target ($)</span><input data-t="weeklyRevenue" type="number" value="${g.targets.weeklyRevenue}"></label>
        <label class="field"><span class="lbl">Weekly unit goal</span><input data-t="weeklyUnits" type="number" value="${g.targets.weeklyUnits}"></label>
      </div>
    </div>

    <div class="panel"><h2>★ Point values</h2>
      <div class="grid cols-4" id="points-grid"></div>
      <p class="muted small-text">Points reward real outcomes only — sales, on-time shipping, fast honest replies. There is deliberately no way to farm points without doing the work.</p>
    </div>

    <div class="panel"><h2>🤖 Local AI assistant</h2>
      <p class="muted small-text" style="margin-bottom:10px">Any OpenAI-compatible local endpoint works — DeepSeek via <b>Ollama</b> is
      <span class="mono">http://localhost:11434/v1</span>, via <b>LM Studio</b> <span class="mono">http://localhost:1234/v1</span>.
      Leave the model blank to auto-use whatever's loaded. Nothing is ever sent to the cloud.</p>
      <div class="grid cols-3">
        <label class="field"><span class="lbl">Endpoint URL</span><input data-a="baseUrl" value="${esc(cfg.ai.baseUrl)}"></label>
        <label class="field"><span class="lbl">Model (blank = auto)</span><input data-a="model" value="${esc(cfg.ai.model)}" list="ai-models"><datalist id="ai-models"></datalist></label>
        <label class="field"><span class="lbl">Enabled</span><select data-a="enabled">
          <option value="false" ${cfg.ai.enabled ? '' : 'selected'}>Off</option>
          <option value="true" ${cfg.ai.enabled ? 'selected' : ''}>On</option>
        </select></label>
      </div>
      <button class="small" id="test-ai">Test connection</button>
      <span class="small-text muted" id="test-ai-result"></span>
    </div>

    <div class="panel" id="mobile-panel"><h2>📱 Mobile companion</h2></div>

    <div class="panel"><h2>🎇 Seasons &amp; challenges</h2>
      <p class="muted small-text">Daily/weekly challenges and seasonal arcs (like the Christmas Market) are defined in
      <span class="mono">config.json → game.challenges</span>. Edit that file to add your own — each season needs an id,
      name, start/end dates, revenue/unit targets, and a payout. The app picks changes up on restart.</p>
    </div>

    <button class="primary" id="save-settings">Save settings</button>
  </div>`));

  const pg = el.querySelector('#points-grid');
  for (const [key, val] of Object.entries(g.points)) {
    if (typeof val !== 'number') continue;
    pg.appendChild(h(`<label class="field"><span class="lbl">${esc(key)}</span><input data-p="${key}" type="number" value="${val}"></label>`));
  }

  await drawMobilePanel(el.querySelector('#mobile-panel'));

  el.querySelector('#test-ai').onclick = async () => {
    const out = el.querySelector('#test-ai-result');
    out.textContent = 'testing…';
    try {
      const r = await call('ai.testConnection', { baseUrl: el.querySelector('[data-a=baseUrl]').value });
      out.textContent = r.models.length ? `✅ Found: ${r.models.join(', ')}` : '✅ Reachable (no models reported — load one in your runner)';
      const dl = el.querySelector('#ai-models');
      dl.innerHTML = r.models.map(m => `<option value="${esc(m)}">`).join('');
    } catch (e) { out.textContent = '❌ ' + e.message; }
  };

  el.querySelector('#save-settings').onclick = async () => {
    const partial = { game: { targets: {}, points: {} }, ai: {} };
    el.querySelectorAll('[data-c]').forEach(i => partial[i.dataset.c] = i.type === 'number' ? Number(i.value) : i.value);
    el.querySelectorAll('[data-t]').forEach(i => partial.game.targets[i.dataset.t] = Number(i.value));
    el.querySelectorAll('[data-p]').forEach(i => partial.game.points[i.dataset.p] = Number(i.value));
    el.querySelectorAll('[data-a]').forEach(i => {
      partial.ai[i.dataset.a] = i.dataset.a === 'enabled' ? i.value === 'true' : i.value;
    });
    await call('config.save', partial);
    toast('Saved', 'Settings updated. Sync interval applies on next launch.');
  };
}

// The mobile companion serves this same console to your phone's browser over
// your own Wi-Fi — LAN only, PIN-paired, nothing in the cloud. The panel
// redraws itself after every action so the URL/PIN shown is always live.
async function drawMobilePanel(panel) {
  const s = await call('mobile.status');
  panel.innerHTML = '<h2>📱 Mobile companion</h2>';

  panel.appendChild(h(`<div>
    <p class="muted small-text" style="margin-bottom:10px">Use the whole console from your phone's browser while you're in the
    workshop. Works only on your own Wi-Fi — nothing goes through the cloud. Your phone must enter the PIN below once;
    restarting the app signs every phone out.</p>
    <div class="row wrap" style="margin-bottom:10px">
      <label class="field" style="margin-bottom:0"><span class="lbl">Companion</span><select data-m="enabled">
        <option value="false" ${s.enabled ? '' : 'selected'}>Off</option>
        <option value="true" ${s.enabled ? 'selected' : ''}>On</option>
      </select></label>
      <label class="field" style="margin-bottom:0;max-width:120px"><span class="lbl">Port</span><input data-m="port" type="number" value="${s.port}"></label>
      <button class="small" data-apply style="align-self:flex-end">Apply</button>
    </div>
    ${s.running ? `
      <hr class="sep">
      <div class="grid cols-2">
        <div>
          <div class="stat-label">Open on your phone</div>
          ${s.urls.length
            ? s.urls.map(u => `<div class="mono" style="font-size:15px;padding:2px 0">${esc(u)}</div>`).join('')
            : '<div class="muted small-text">No Wi-Fi/LAN address found — is this PC on the network?</div>'}
          <div class="muted small-text" style="margin-top:6px">Phone and PC must be on the same Wi-Fi. In your phone's browser menu, "Add to Home Screen" makes it feel like an app.</div>
        </div>
        <div>
          <div class="stat-label">Pairing PIN</div>
          <div class="pin-display">${esc(s.pin)}</div>
          <div class="muted small-text">${s.devices.length} device${s.devices.length === 1 ? '' : 's'} paired</div>
          <div class="row" style="margin-top:8px">
            <button class="small" data-newpin>New PIN</button>
            <button class="small danger" data-disconnect>Sign out all phones</button>
          </div>
        </div>
      </div>` : (s.enabled ? '<div class="warn-box">Enabled but not running — the port may be in use. Try another port and Apply.</div>' : '')}
  </div>`));

  panel.querySelector('[data-apply]').onclick = async () => {
    await call('mobile.set', {
      enabled: panel.querySelector('[data-m=enabled]').value === 'true',
      port: Number(panel.querySelector('[data-m=port]').value)
    });
    await drawMobilePanel(panel);
    toast('Mobile companion', 'Setting applied.');
  };
  const newpin = panel.querySelector('[data-newpin]');
  if (newpin) newpin.onclick = async () => { await call('mobile.newPin'); await drawMobilePanel(panel); };
  const disc = panel.querySelector('[data-disconnect]');
  if (disc) disc.onclick = async () => {
    await call('mobile.disconnectAll');
    await drawMobilePanel(panel);
    toast('Mobile companion', 'All phones signed out — they\'ll need the PIN again.');
  };
}
