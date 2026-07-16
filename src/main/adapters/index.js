// Adapter registry + Channels screen RPC.
// To add a new marketplace: write one adapter file, add one line here.
'use strict';

const rpc = require('../rpc');
const { get: getDb } = require('../db');
const { EbayAdapter } = require('./ebay');
const { FacebookManualAdapter } = require('./facebook-manual');
const { AmazonAdapter } = require('./amazon');
const { WalmartAdapter } = require('./walmart');

const adapters = new Map();
for (const a of [new EbayAdapter(), new FacebookManualAdapter(), new AmazonAdapter(), new WalmartAdapter()]) {
  adapters.set(a.id, a);
}

function get(id) {
  const a = adapters.get(id);
  if (!a) throw new Error(`No adapter for channel '${id}'`);
  return a;
}

function all() { return [...adapters.values()]; }

async function refreshStatus(id) {
  const a = get(id);
  const s = await a.getStatus();
  getDb().prepare(`UPDATE channels SET status = ?, status_detail = ?,
    connected_at = CASE WHEN ? = 'connected' AND connected_at IS NULL THEN datetime('now') ELSE connected_at END
    WHERE id = ?`).run(s.status, s.detail, s.status, id);
  return s;
}

// ---------- RPC for the Channels screen ----------

rpc.register('channels.list', async () => {
  const rows = getDb().prepare('SELECT * FROM channels').all();
  const out = [];
  for (const row of rows) {
    const a = adapters.get(row.id);
    let status = { status: row.status, detail: row.status_detail };
    if (a) {
      try { status = await refreshStatus(row.id); } catch (e) { status = { status: 'error', detail: e.message }; }
    }
    out.push({ ...row, ...status, kind: a?.kind || row.kind, capabilities: a?.capabilities || {} });
  }
  return out;
});

rpc.register('channels.beginConnect', ({ id }) => get(id).beginConnect());
rpc.register('channels.completeConnect', async ({ id, params }) => {
  const res = await get(id).completeConnect(params);
  await refreshStatus(id);
  return res;
});
rpc.register('channels.disconnect', async ({ id }) => {
  await get(id).disconnect();
  await refreshStatus(id);
  return { done: true };
});

// eBay-specific helpers surfaced on the Channels screen.
rpc.register('channels.ebay.saveCredentials', (params) => get('ebay').saveCredentials(params));
rpc.register('channels.ebay.fetchAccountSetup', () => get('ebay').fetchAccountSetup());
rpc.register('channels.ebay.publishChecklist', () => get('ebay').publishChecklist());

module.exports = { get, all, refreshStatus };
