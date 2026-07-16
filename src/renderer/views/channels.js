// Channels screen: connect/disconnect marketplaces, health indicators,
// eBay credential + listing setup, Facebook manual-assist notes.
import { call, h, esc, toast } from '../app.js';

const PILL = {
  connected: ['green', 'Connected'],
  not_connected: ['gray', 'Not connected'],
  expired: ['amber', 'Expired'],
  error: ['red', 'Error'],
  manual: ['blue', 'Manual-assist']
};

export async function render(el) {
  el.appendChild(h(`<div>
    <h1 class="page-title">🔌 Channels</h1>
    <div class="page-sub">Link each marketplace. API channels sync automatically; manual-assist channels format content for you to copy/paste.</div>
    <div id="channel-cards"></div>
  </div>`));
  await drawCards(el.querySelector('#channel-cards'));
}

async function drawCards(holder) {
  holder.innerHTML = '<div class="empty-state">Checking channel health…</div>';
  const channels = await call('channels.list');
  holder.innerHTML = '';
  for (const ch of channels) {
    const [color, label] = PILL[ch.status] || ['gray', ch.status];
    const card = h(`<div class="panel">
      <div class="row spread">
        <h2 style="margin-bottom:0">${esc(ch.display_name)} <span class="pill ${color}">${label}</span></h2>
        <div class="row" data-actions></div>
      </div>
      <p class="muted small-text" style="margin-top:8px">${esc(ch.detail || '')}</p>
      <div data-body></div>
    </div>`);
    holder.appendChild(card);
    const actions = card.querySelector('[data-actions]');
    const body = card.querySelector('[data-body]');

    if (ch.id === 'ebay') renderEbay(ch, actions, body, () => drawCards(holder));
    if (ch.id === 'facebook') renderFacebook(body);
  }
}

function renderEbay(ch, actions, body, redraw) {
  if (ch.status === 'connected') {
    const btn = h(`<button class="danger small">Disconnect</button>`);
    btn.onclick = async () => { await call('channels.disconnect', { id: 'ebay' }); toast('eBay', 'Disconnected. Tokens removed from this PC.'); redraw(); };
    actions.appendChild(btn);
    renderEbayListingSetup(body);
    return;
  }

  const btn = h(`<button class="primary small">Connect…</button>`);
  btn.onclick = async () => {
    const info = await call('channels.beginConnect', { id: 'ebay' });
    body.innerHTML = '';
    if (info.fields) {
      // Credentials not saved yet — show the one-time credential form.
      const form = h(`<div class="info-box" style="margin-top:12px">
        <b>One-time setup:</b> ${esc(info.instructions)}
        ${info.fields.map(f => `
          <label class="field" style="margin-top:8px"><span class="lbl">${esc(f.label)}</span>
          <input data-key="${f.key}" type="${f.secret ? 'password' : 'text'}" ${f.key === 'env' ? 'value="production"' : ''}></label>`).join('')}
        <button class="primary">Save credentials</button>
      </div>`);
      form.querySelector('button').onclick = async () => {
        const vals = {};
        form.querySelectorAll('input').forEach(i => vals[i.dataset.key] = i.value);
        await call('channels.ebay.saveCredentials', vals);
        toast('eBay', 'Credentials saved (encrypted). Click Connect again to sign in.');
        redraw();
      };
      body.appendChild(form);
    } else if (info.authUrl) {
      window.open(info.authUrl); // opens in the system browser
      const paste = h(`<div class="info-box" style="margin-top:12px">
        ${esc(info.instructions)}
        <div class="row" style="margin-top:8px">
          <input placeholder="Paste the redirect URL or code here">
          <button class="primary">Finish connect</button>
        </div>
      </div>`);
      paste.querySelector('button').onclick = async () => {
        await call('channels.completeConnect', { id: 'ebay', params: { code: paste.querySelector('input').value } });
        toast('eBay', '✅ Connected! Messages and orders will sync automatically.');
        redraw();
      };
      body.appendChild(paste);
    }
  };
  actions.appendChild(btn);
}

async function renderEbayListingSetup(body) {
  const missing = await call('channels.ebay.publishChecklist');
  const cfg = await call('config.get');
  const e = cfg.channels.ebay;
  const box = h(`<div style="margin-top:10px">
    <hr class="sep">
    <div class="row spread">
      <b class="small-text">Listing setup ${missing.length ? `<span class="pill amber">${missing.length} missing</span>` : '<span class="pill green">Ready</span>'}</b>
      <button class="small">Fetch my policies from eBay</button>
    </div>
    <p class="muted small-text" style="margin:6px 0">Publishing listings needs your eBay business policies and an inventory location. Click fetch, then pick from the lists.</p>
    <div class="grid cols-2" data-fields>
      ${field('fulfillmentPolicyId', 'Shipping (fulfillment) policy ID', e.fulfillmentPolicyId)}
      ${field('paymentPolicyId', 'Payment policy ID', e.paymentPolicyId)}
      ${field('returnPolicyId', 'Return policy ID', e.returnPolicyId)}
      ${field('merchantLocationKey', 'Inventory location key', e.merchantLocationKey)}
      ${field('defaultCategoryId', 'Default eBay category ID (e.g. 20091 for woodworking crafts)', e.defaultCategoryId)}
    </div>
    <div data-fetched class="small-text muted"></div>
    <button class="primary small" style="margin-top:8px">Save listing setup</button>
  </div>`);

  box.querySelector('button').onclick = async () => {
    try {
      const setup = await call('channels.ebay.fetchAccountSetup');
      const fmt = (arr, what) => arr.length
        ? arr.map(p => `<div>• <span class="mono">${esc(p.id || p.key)}</span> — ${esc(p.name)}</div>`).join('')
        : `<div class="muted">No ${what} found — create one in eBay Seller Hub first.</div>`;
      box.querySelector('[data-fetched]').innerHTML = `
        <hr class="sep"><b>Shipping policies</b>${fmt(setup.fulfillmentPolicies, 'shipping policies')}
        <b>Payment policies</b>${fmt(setup.paymentPolicies, 'payment policies')}
        <b>Return policies</b>${fmt(setup.returnPolicies, 'return policies')}
        <b>Inventory locations</b>${fmt(setup.locations, 'locations')}`;
    } catch { /* error already toasted by call() */ }
  };
  box.querySelectorAll('button')[1].onclick = async () => {
    const vals = {};
    box.querySelectorAll('input').forEach(i => vals[i.dataset.key] = i.value.trim());
    await call('config.save', { channels: { ebay: vals } });
    toast('eBay', 'Listing setup saved.');
  };
  body.appendChild(box);
}

function field(key, label, value) {
  return `<label class="field"><span class="lbl">${esc(label)}</span>
    <input data-key="${key}" value="${esc(value || '')}"></label>`;
}

function renderFacebook(body) {
  body.appendChild(h(`<div class="warn-box" style="margin-top:10px">
    <b>Why is Facebook manual-only?</b><br>
    Facebook Marketplace has no official API for individual sellers to list items or send messages.
    Tools that automate it use hidden browser sessions, which violate Meta's Terms of Service and
    regularly get personal accounts banned. That's not a risk worth your account.<br><br>
    <b>How it works instead:</b> create listings in Products &amp; Listings and pick Facebook —
    the app formats the whole post and copies it to your clipboard. Paste buyer messages into the
    Inbox to track them and get drafted replies to copy back. Record Facebook sales in Orders so
    they count toward your points and targets.
  </div>`));
}
