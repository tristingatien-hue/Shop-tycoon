// Products & Listings: create a product once, see exactly how each channel
// will render it, edit the per-channel templates, and publish/export.
import { call, h, esc, money, toast, copyOut, refreshBadges } from '../app.js';

let selectedProduct = null;
let previewChannel = 'ebay';

export async function render(el) {
  el.appendChild(h(`<div>
    <div class="row spread">
      <div>
        <h1 class="page-title">🪚 Products &amp; Listings</h1>
        <div class="page-sub">Write it once — the templates dress it up for each marketplace.</div>
      </div>
      <button id="btn-new-product" class="primary small">+ New product</button>
    </div>
    <div class="grid" style="grid-template-columns: 300px 1fr; align-items:start">
      <div class="panel" id="product-list"></div>
      <div id="product-detail"></div>
    </div>
  </div>`));
  el.querySelector('#btn-new-product').onclick = () => { selectedProduct = null; drawDetail(); };
  await drawList();
  drawDetail();
}

async function drawList() {
  const holder = document.getElementById('product-list');
  if (!holder) return;
  const products = await call('products.list');
  holder.innerHTML = '<h2>Catalog</h2>';
  if (!products.length) holder.appendChild(h('<div class="empty-state small-text">No products yet.<br>Add your first piece →</div>'));
  for (const p of products) {
    const item = h(`<div class="thread-item ${selectedProduct === p.id ? 'active' : ''}">
      <div class="row spread"><span class="who">${esc(p.title)}</span><span class="muted small-text">${money(p.price_cents)}</span></div>
      <div class="prev">${p.live_count ? `<span class="pill green">${p.live_count} live</span>` : '<span class="pill gray">not listed</span>'}</div>
    </div>`);
    item.onclick = () => { selectedProduct = p.id; drawList(); drawDetail(); };
    holder.appendChild(item);
  }
}

async function drawDetail() {
  const holder = document.getElementById('product-detail');
  if (!holder) return;
  const p = selectedProduct ? await call('products.get', { id: selectedProduct }) : {};
  holder.innerHTML = '';

  // ---- product form ----
  const form = h(`<div class="panel">
    <h2>${p.id ? 'Edit product' : 'New product'}</h2>
    <div class="grid cols-2">
      <label class="field"><span class="lbl">Title</span><input data-k="title" value="${esc(p.title || '')}"></label>
      <label class="field"><span class="lbl">SKU (optional)</span><input data-k="sku" value="${esc(p.sku || '')}"></label>
    </div>
    <label class="field"><span class="lbl">Description (plain words — templates format it per channel)</span>
      <textarea data-k="description" rows="4">${esc(p.description || '')}</textarea></label>
    <div class="grid cols-4">
      <label class="field"><span class="lbl">Price ($)</span><input data-k="price" type="number" step="0.01" value="${p.price_cents ? (p.price_cents / 100).toFixed(2) : ''}"></label>
      <label class="field"><span class="lbl">Material cost ($)</span><input data-k="cost" type="number" step="0.01" value="${p.cost_cents ? (p.cost_cents / 100).toFixed(2) : ''}"></label>
      <label class="field"><span class="lbl">Quantity</span><input data-k="quantity" type="number" value="${p.quantity ?? 1}"></label>
      <label class="field"><span class="lbl">Dimensions</span><input data-k="dimensions" value="${esc(p.dimensions || '')}" placeholder='12" x 8" x 1.5"'></label>
    </div>
    <div class="grid cols-2">
      <label class="field"><span class="lbl">Materials</span><input data-k="materials" value="${esc(p.materials || '')}" placeholder="black walnut, food-safe mineral oil"></label>
      <label class="field"><span class="lbl">Tags (comma separated)</span><input data-k="tags" value="${esc(p.tags || '')}" placeholder="cutting board, walnut, kitchen"></label>
    </div>
    <label class="field"><span class="lbl">Photo URLs (one per line — eBay needs hosted https images)</span>
      <textarea data-k="photos" rows="2">${esc(JSON.parse(p.photos || '[]').join('\n'))}</textarea></label>
    <div class="row">
      <button class="primary" data-save>${p.id ? 'Save changes' : 'Create product'}</button>
      <button data-ai-draft title="The AI drafts a description and tags from your title/materials/dimensions — you review before saving">🤖 AI draft copy</button>
      <button data-ai-price title="Price range computed from your material cost and target margin — never changes anything by itself">💲 Suggest price</button>
      ${p.id ? '<button class="danger" data-del>Delete</button>' : ''}
    </div>
    <div data-ai-out></div>
  </div>`);
  form.querySelector('[data-save]').onclick = async () => {
    const v = {};
    form.querySelectorAll('[data-k]').forEach(i => v[i.dataset.k] = i.value);
    const res = await call('products.save', {
      id: p.id, title: v.title, sku: v.sku, description: v.description,
      price_cents: Math.round(parseFloat(v.price || '0') * 100),
      cost_cents: Math.round(parseFloat(v.cost || '0') * 100),
      quantity: parseInt(v.quantity || '1', 10),
      dimensions: v.dimensions, materials: v.materials, tags: v.tags,
      photos: v.photos.split('\n').map(s => s.trim()).filter(Boolean)
    });
    selectedProduct = res.id;
    toast('Saved', 'Product saved.');
    drawList(); drawDetail();
  };
  form.querySelector('[data-ai-draft]').onclick = async () => {
    const get = (k) => form.querySelector(`[data-k=${k}]`).value;
    toast('AI', 'Drafting copy with your local model…');
    const d = await call('ai.draftListing', { title: get('title'), materials: get('materials'), dimensions: get('dimensions'), notes: get('description') });
    form.querySelector('[data-k=description]').value = d.description;
    if (d.tags && !get('tags')) form.querySelector('[data-k=tags]').value = d.tags;
    const out = form.querySelector('[data-ai-out]');
    out.innerHTML = '';
    if (d.titleIdeas?.length) {
      out.appendChild(h(`<div class="info-box" style="margin-top:10px"><b>Title ideas</b> (click to use):
        ${d.titleIdeas.map(t => `<div class="tab" style="margin-top:6px;display:inline-block">${esc(t)}</div>`).join(' ')}</div>`));
      out.querySelectorAll('.tab').forEach(tab => tab.onclick = () => { form.querySelector('[data-k=title]').value = tab.textContent; });
    }
    toast('AI draft ready', 'Review the description — nothing is saved until you click Save.');
  };
  form.querySelector('[data-ai-price]').onclick = async () => {
    const cost = Math.round(parseFloat(form.querySelector('[data-k=cost]').value || '0') * 100);
    const r = await call('ai.suggestPrice', { costCents: cost });
    const out = form.querySelector('[data-ai-out]');
    out.innerHTML = '';
    out.appendChild(h(`<div class="info-box" style="margin-top:10px"><b>Price range</b> —
      floor $${r.floor.toFixed(2)} · target (${r.targetMarginPct}% margin) <b>$${r.target.toFixed(2)}</b> · premium $${r.premium.toFixed(2)}
      <div class="muted small-text" style="margin-top:4px">${esc(r.note)}</div></div>`));
  };
  const del = form.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (!confirm('Delete this product and its listing history?')) return;
    await call('products.delete', { id: p.id });
    selectedProduct = null;
    drawList(); drawDetail();
  };
  holder.appendChild(form);

  if (!p.id) return;

  // ---- per-channel preview + template editor + publish ----
  const channels = await call('channels.list');
  const box = h(`<div class="panel">
    <h2>Channel previews</h2>
    <div class="tabs" data-tabs></div>
    <div data-preview></div>
    <hr class="sep">
    <div class="row spread">
      <div class="row wrap" data-publish-checks></div>
      <button class="primary" data-publish>Post to selected channels</button>
    </div>
    <div data-publish-results></div>
  </div>`);
  holder.appendChild(box);

  const tabs = box.querySelector('[data-tabs]');
  for (const c of channels) {
    const t = h(`<div class="tab ${previewChannel === c.id ? 'active' : ''}">${esc(c.display_name)}${c.kind === 'manual' ? ' 📋' : ''}</div>`);
    t.onclick = () => { previewChannel = c.id; drawDetail(); };
    tabs.appendChild(t);
  }

  await drawPreview(box.querySelector('[data-preview]'), p);

  const checks = box.querySelector('[data-publish-checks]');
  for (const c of channels) {
    const publishable = c.capabilities?.publish;
    checks.appendChild(h(`<label class="row" style="gap:5px" title="${esc(c.detail || '')}">
      <input type="checkbox" style="width:auto" value="${c.id}" ${publishable ? '' : 'disabled'} ${publishable && c.id === previewChannel ? 'checked' : ''}>
      ${esc(c.display_name)} ${publishable ? '' : '<span class="pill gray">not connected</span>'}
    </label>`));
  }
  box.querySelector('[data-publish]').onclick = async () => {
    const ids = [...checks.querySelectorAll('input:checked')].map(i => i.value);
    const results = await call('listings.publish', { productId: p.id, channelIds: ids });
    const out = box.querySelector('[data-publish-results]');
    out.innerHTML = '';
    for (const r of results) {
      if (r.exported) {
        out.appendChild(h(`<div class="info-box" style="margin-top:10px"><b>${esc(r.channelId)}:</b> formatted listing ready — it's a manual channel, so paste it into the site yourself.
          <div class="preview-card" style="margin-top:8px">${esc(r.exported)}</div>
          <button class="small" style="margin-top:8px">📋 Copy listing</button></div>`));
        out.lastElementChild.querySelector('button').onclick = () => copyOut(r.exported, 'Listing copied — paste into Facebook');
      } else if (r.error) {
        out.appendChild(h(`<div class="warn-box" style="margin-top:10px"><b>${esc(r.channelId)}:</b> ${esc(r.error)}</div>`));
      } else {
        out.appendChild(h(`<div class="info-box" style="margin-top:10px"><b>${esc(r.channelId)}:</b> ✅ published (listing ${esc(r.externalId)})</div>`));
      }
    }
    refreshBadges(); drawList();
  };

  // ---- listing history ----
  const history = await call('listings.forProduct', { productId: p.id });
  if (history.length) {
    const hist = h(`<div class="panel"><h2>Listing history</h2><table class="list"><tbody></tbody></table></div>`);
    const tb = hist.querySelector('tbody');
    for (const l of history.slice(0, 8)) {
      tb.appendChild(h(`<tr><td>${esc(l.channel_name)}</td>
        <td><span class="pill ${l.status === 'published' ? 'green' : l.status === 'exported' ? 'blue' : l.status === 'error' ? 'red' : 'gray'}">${esc(l.status)}</span></td>
        <td class="muted small-text">${esc(l.external_id || '')}</td>
        <td class="muted small-text">${esc(l.updated_at)}</td>
        <td class="small-text" style="color:var(--red)">${esc(l.error || '')}</td></tr>`));
    }
    holder.appendChild(hist);
  }
}

async function drawPreview(holder, product) {
  const [rendered, template] = await Promise.all([
    call('listings.render', { productId: product.id, channelId: previewChannel }),
    call('templates.get', { channelId: previewChannel })
  ]);
  holder.innerHTML = '';
  if (rendered.notes) holder.appendChild(h(`<p class="muted small-text" style="margin-bottom:10px">ℹ️ ${esc(rendered.notes)}</p>`));

  const grid = h('<div class="grid cols-2" style="align-items:start"></div>');

  // Live preview (left)
  const prev = h('<div><b class="small-text">Live preview</b></div>');
  for (const [name, f] of Object.entries(rendered.fields)) {
    prev.appendChild(h(`<div style="margin-top:8px">
      <div class="row spread"><span class="stat-label">${esc(name)}</span>
        ${f.limit ? `<span class="char-count ${f.over ? 'over' : ''}">${f.length}/${f.limit}${f.over ? ' — will be cut off!' : ''}</span>` : ''}</div>
      <div class="preview-card">${esc(f.value) || '<span class="muted">(empty)</span>'}</div>
    </div>`));
  }
  grid.appendChild(prev);

  // Template editor (right)
  const edit = h(`<div><b class="small-text">Template (uses {{variables}} — edits apply to every product on this channel)</b><div data-fields></div>
    <div class="row" style="margin-top:10px">
      <button class="small primary" data-save-tpl>Save template</button>
      <button class="small" data-reset-tpl>Reset to default</button>
    </div>
    <p class="muted small-text" style="margin-top:8px">Variables: {{title}} {{description}} {{price}} {{dimensions}} {{materials}} {{tags}} {{tags_hashtags}} {{sku}} {{quantity}} {{shop_name}}</p>
  </div>`);
  const fieldsHolder = edit.querySelector('[data-fields]');
  for (const [name, spec] of Object.entries(template.fields)) {
    fieldsHolder.appendChild(h(`<label class="field" style="margin-top:8px"><span class="lbl">${esc(name)}${spec.maxLen ? ` (max ${spec.maxLen})` : ''}</span>
      <textarea data-tpl-field="${esc(name)}" rows="${spec.template.includes('\n') ? 6 : 2}">${esc(spec.template)}</textarea></label>`));
  }
  edit.querySelector('[data-save-tpl]').onclick = async () => {
    const t = JSON.parse(JSON.stringify(template));
    edit.querySelectorAll('[data-tpl-field]').forEach(i => { t.fields[i.dataset.tplField].template = i.value; });
    await call('templates.save', { channelId: previewChannel, template: t });
    toast('Template saved', `${previewChannel} listings now use your format.`);
    drawDetail();
  };
  edit.querySelector('[data-reset-tpl]').onclick = async () => {
    await call('templates.reset', { channelId: previewChannel });
    toast('Template reset', 'Back to the built-in default.');
    drawDetail();
  };
  grid.appendChild(edit);
  holder.appendChild(grid);
}
