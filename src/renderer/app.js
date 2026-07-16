// App shell: sidebar navigation, view router, shared helpers.
// Views self-contain their rendering; each exports { title, render(el) }.

const VIEWS = [
  { id: 'dashboard', icon: '🏆', label: 'Dashboard' },
  { id: 'inbox', icon: '💬', label: 'Inbox', badgeKey: 'unread' },
  { id: 'assistant', icon: '🤖', label: 'Assistant', badgeKey: 'approvals' },
  { id: 'composer', icon: '🪚', label: 'Products & Listings' },
  { id: 'orders', icon: '📦', label: 'Orders', badgeKey: 'openOrders' },
  { id: 'channels', icon: '🔌', label: 'Channels' },
  { id: 'settings', icon: '⚙️', label: 'Settings' }
];

const state = { current: null, badges: {} };

// ---------- shared helpers (imported by views) ----------
export async function call(method, params) {
  const res = await window.api.call(method, params);
  if (res.error) { toast('Error', res.error); throw new Error(res.error); }
  return res.result;
}
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function money(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}
export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function toast(title, body, kind = '') {
  const el = h(`<div class="toast ${kind}"><div class="t-title">${esc(title)}</div><div>${esc(body)}</div></div>`);
  document.getElementById('toast-holder').appendChild(el);
  setTimeout(() => el.remove(), 5200);
}
export function copyOut(text, label = 'Copied to clipboard') {
  window.api.copyToClipboard(text);
  toast('📋 ' + label, 'Paste it where you need it.');
}
export async function refreshBadges() {
  try {
    const b = await window.api.call('app.badges');
    if (b.result) {
      state.badges = b.result;
      renderNav();
      const pts = document.getElementById('points-total');
      if (pts && b.result.points !== undefined) pts.textContent = b.result.points.toLocaleString();
      const lvl = document.getElementById('brand-level');
      if (lvl && b.result.level) lvl.textContent = b.result.level;
    }
  } catch { /* badges are decoration; never block the UI on them */ }
}

// ---------- navigation ----------
function renderNav() {
  const holder = document.getElementById('nav-items');
  holder.innerHTML = '';
  for (const v of VIEWS) {
    const badge = v.badgeKey && state.badges[v.badgeKey] ? `<span class="badge">${state.badges[v.badgeKey]}</span>` : '';
    const el = h(`<div class="nav-item ${state.current === v.id ? 'active' : ''}" data-id="${v.id}">
      <span>${v.icon}</span><span>${v.label}</span>${badge}</div>`);
    el.onclick = () => navigate(v.id);
    holder.appendChild(el);
  }
}

export async function navigate(id) {
  state.current = id;
  renderNav();
  const viewEl = document.getElementById('view');
  viewEl.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const mod = await import(`./views/${id}.js`);
    viewEl.innerHTML = '';
    await mod.render(viewEl);
  } catch (e) {
    viewEl.innerHTML = `<div class="warn-box">This screen isn't built yet in the current stage. (${esc(e.message)})</div>`;
  }
}

// ---------- live events from main process ----------
window.api.onEvent((evt) => {
  if (evt.type === 'points') {
    toast(`${evt.points > 0 ? '+' : ''}${evt.points} points`, evt.reason, 'points');
    refreshBadges();
  } else if (evt.type === 'sync') {
    const el = document.getElementById('sync-status');
    if (el) el.textContent = evt.text;
    if (evt.done) refreshBadges();
  } else if (evt.type === 'toast') {
    toast(evt.title || 'Notice', evt.body || '');
  }
});

// ---------- boot ----------
renderNav();
refreshBadges();
setInterval(refreshBadges, 60_000);
navigate('dashboard');
