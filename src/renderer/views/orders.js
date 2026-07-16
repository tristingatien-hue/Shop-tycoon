// Orders & fulfillment: one pipeline across channels (new → packed → shipped → done).
import { call, h, esc, money, toast, refreshBadges } from '../app.js';

const NEXT = { new: 'packed', packed: 'shipped', shipped: 'done' };
const PILL = { new: 'red', packed: 'amber', shipped: 'blue', done: 'green', cancelled: 'gray' };

export async function render(el) {
  el.appendChild(h(`<div>
    <div class="row spread">
      <div>
        <h1 class="page-title">📦 Orders</h1>
        <div class="page-sub">Ship before the ship-by date to bank the on-time bonus.</div>
      </div>
      <div class="row">
        <button id="btn-manual-order" class="small">+ Record a Facebook sale</button>
        <button id="btn-sync-orders" class="small">↻ Sync now</button>
      </div>
    </div>
    <div id="order-form"></div>
    <div class="panel"><table class="list"><thead><tr>
      <th>Status</th><th>Item</th><th>Buyer</th><th>Channel</th><th>Total</th><th>My cost</th><th>Ship by</th><th></th>
    </tr></thead><tbody id="order-rows"></tbody></table></div>
  </div>`));

  el.querySelector('#btn-sync-orders').onclick = async () => { await call('sync.now'); await drawRows(); toast('Sync', 'Done.'); };
  el.querySelector('#btn-manual-order').onclick = () => manualOrderForm(el.querySelector('#order-form'));
  await drawRows();
}

async function drawRows() {
  const tbody = document.getElementById('order-rows');
  if (!tbody) return;
  const orders = await call('orders.list');
  tbody.innerHTML = orders.length ? '' : '<tr><td colspan="8" class="empty-state">No orders yet. They appear here automatically from connected channels; Facebook sales are recorded manually.</td></tr>';
  for (const o of orders) {
    const shipBy = o.ship_by ? new Date(o.ship_by) : null;
    const late = shipBy && !['shipped', 'done'].includes(o.status) && shipBy < new Date();
    const tr = h(`<tr>
      <td><span class="pill ${PILL[o.status] || 'gray'}">${esc(o.status)}</span></td>
      <td>${esc(o.item_summary)} ${o.quantity > 1 ? `×${o.quantity}` : ''}</td>
      <td>${esc(o.buyer)}</td>
      <td>${esc(o.channel_name)}</td>
      <td>${money(o.total_cents, o.currency)}</td>
      <td><input class="small-cost" style="width:80px" value="${o.cost_cents ? (o.cost_cents / 100).toFixed(2) : ''}" placeholder="0.00" title="Your material cost — powers margin-scaled points"></td>
      <td>${shipBy ? `<span class="${late ? 'mono' : ''}" style="${late ? 'color:var(--red);font-weight:700' : ''}">${shipBy.toLocaleDateString()}${late ? ' ⚠ LATE' : ''}</span>` : '<span class="muted">—</span>'}</td>
      <td class="row">${NEXT[o.status] ? `<button class="small primary" data-adv>→ ${NEXT[o.status]}</button>` : ''}</td>
    </tr>`);
    const adv = tr.querySelector('[data-adv]');
    if (adv) adv.onclick = async () => {
      await call('orders.setStatus', { orderId: o.id, status: NEXT[o.status] });
      refreshBadges();
      drawRows();
    };
    tr.querySelector('.small-cost').onchange = async (e) => {
      await call('orders.setCost', { orderId: o.id, costCents: Math.round(parseFloat(e.target.value || '0') * 100) });
      toast('Saved', 'Material cost recorded.');
    };
    tbody.appendChild(tr);
  }
}

function manualOrderForm(holder) {
  holder.innerHTML = '';
  const form = h(`<div class="panel">
    <h2>Record a Facebook (or offline) sale</h2>
    <div class="grid cols-4">
      <label class="field"><span class="lbl">Item</span><input data-k="itemSummary"></label>
      <label class="field"><span class="lbl">Buyer</span><input data-k="buyer"></label>
      <label class="field"><span class="lbl">Sale amount ($)</span><input data-k="total" type="number" step="0.01"></label>
      <label class="field"><span class="lbl">My material cost ($)</span><input data-k="cost" type="number" step="0.01"></label>
    </div>
    <div class="row">
      <label class="field" style="margin-bottom:0"><span class="lbl">Ship by (optional)</span><input data-k="shipBy" type="date"></label>
      <button class="primary" style="align-self:flex-end">Add order</button>
      <button style="align-self:flex-end" data-cancel>Cancel</button>
    </div>
  </div>`);
  form.querySelector('.primary').onclick = async () => {
    const v = {};
    form.querySelectorAll('[data-k]').forEach(i => v[i.dataset.k] = i.value);
    await call('orders.manualAdd', {
      itemSummary: v.itemSummary, buyer: v.buyer,
      totalCents: Math.round(parseFloat(v.total || '0') * 100),
      costCents: Math.round(parseFloat(v.cost || '0') * 100),
      shipBy: v.shipBy || null
    });
    holder.innerHTML = '';
    refreshBadges();
    drawRows();
    toast('Order added', 'Manual sales count toward points and targets like any other.');
  };
  form.querySelector('[data-cancel]').onclick = () => holder.innerHTML = '';
  holder.appendChild(form);
}
