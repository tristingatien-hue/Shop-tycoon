// Background sync: polls every connected API channel for new messages and
// orders on a config-driven interval. Manual channels are never polled —
// their data arrives by owner entry.
'use strict';

const rpc = require('../rpc');
const config = require('../config');
const adapters = require('../adapters');
const inbox = require('./inbox');
const orders = require('./orders');

let timer = null;
let running = false;
let broadcastFn = () => {};

async function syncAll() {
  if (running) return { skipped: 'sync already running' };
  running = true;
  const summary = [];
  try {
    for (const a of adapters.all()) {
      if (a.kind !== 'api') continue;
      const status = await a.getStatus();
      if (status.status !== 'connected') continue;
      broadcastFn({ type: 'sync', text: `syncing ${a.displayName}…` });
      try {
        let newMsgs = 0, newOrders = 0;
        if (a.capabilities.messages) newMsgs = inbox.upsertThreads(a.id, await a.syncMessages());
        if (a.capabilities.orders) newOrders = orders.upsertOrders(a.id, await a.syncOrders());
        summary.push({ channel: a.id, newMsgs, newOrders });
        await adapters.refreshStatus(a.id);
      } catch (e) {
        summary.push({ channel: a.id, error: e.message });
        broadcastFn({ type: 'toast', title: `${a.displayName} sync failed`, body: e.message });
      }
    }
  } finally {
    running = false;
  }
  const when = new Date().toLocaleTimeString();
  broadcastFn({ type: 'sync', text: `last sync ${when}`, done: true });
  return summary;
}

function start({ broadcast }) {
  broadcastFn = broadcast || broadcastFn;
  const minutes = Math.max(2, config.load().syncIntervalMinutes || 10);
  if (timer) clearInterval(timer);
  timer = setInterval(syncAll, minutes * 60_000);
  setTimeout(syncAll, 3_000); // first sync shortly after launch
}

rpc.register('sync.now', () => syncAll());

module.exports = { start, syncAll };
