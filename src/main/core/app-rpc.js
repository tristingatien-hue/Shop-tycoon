// General app-level RPC: config read/write, app info.
'use strict';

const rpc = require('../rpc');
const config = require('../config');

rpc.register('config.get', () => config.load());
rpc.register('config.save', (partial) => config.save(partial));
rpc.register('app.info', () => ({
  version: require('../../../package.json').version,
  dataDir: require('../paths').dataDir()
}));

// Sidebar badges + points chip. Cheap to compute, called often.
rpc.register('app.badges', () => {
  const db = require('../db').get();
  const points = db.prepare('SELECT COALESCE(SUM(points),0) AS p FROM points_ledger').get().p;
  const unread = db.prepare('SELECT COALESCE(SUM(unread),0) AS u FROM threads').get().u;
  const openOrders = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status IN ('new','packed')`).get().c;
  const approvals = db.prepare(`SELECT COUNT(*) AS c FROM approval_queue WHERE status = 'pending'`).get().c;
  const levels = config.load().game.levels;
  let level = levels[0]?.name || '';
  for (const l of levels) if (points >= l.at) level = l.name;
  return { points, unread, openOrders, approvals, level };
});
