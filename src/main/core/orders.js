// Orders & fulfillment: one list across channels, simple status pipeline
// (new → packed → shipped → done), manual entry for manual channels.
'use strict';

const rpc = require('../rpc');
const { get: getDb } = require('../db');
const events = require('./events');

const STATUSES = ['new', 'packed', 'shipped', 'done', 'cancelled'];

// ---------- sync upsert (called by core/sync.js) ----------

function upsertOrders(channelId, orders) {
  const db = getDb();
  let added = 0;
  const find = db.prepare('SELECT id, status FROM orders WHERE channel_id = ? AND external_id = ?');
  const ins = db.prepare(`INSERT INTO orders (channel_id, external_id, buyer, item_summary, quantity, total_cents, currency, order_date, ship_by, status, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = db.transaction(() => {
    for (const o of orders) {
      const existing = find.get(channelId, o.externalId);
      if (existing) continue; // owner drives status locally; don't clobber
      // Orders already fulfilled on the platform arrive as 'shipped'.
      const status = o.meta?.shipped ? 'shipped' : 'new';
      ins.run(channelId, o.externalId, o.buyer, o.itemSummary, o.quantity || 1,
        o.totalCents || 0, o.currency || 'USD', o.orderDate || null, o.shipBy || null,
        status, JSON.stringify(o.meta || {}));
      added++;
      if (status === 'new') events.emit('order.new', { channelId, externalId: o.externalId });
    }
  });
  tx();
  return added;
}

// ---------- RPC ----------

rpc.register('orders.list', ({ channel, activeOnly } = {}) => {
  const where = [];
  const args = [];
  if (channel) { where.push('o.channel_id = ?'); args.push(channel); }
  if (activeOnly) where.push(`o.status IN ('new','packed')`);
  return getDb().prepare(`
    SELECT o.*, c.display_name AS channel_name FROM orders o
    JOIN channels c ON c.id = o.channel_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE o.status WHEN 'new' THEN 0 WHEN 'packed' THEN 1 WHEN 'shipped' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
      COALESCE(o.ship_by, o.order_date) ASC`).all(...args);
});

rpc.register('orders.setStatus', ({ orderId, status }) => {
  if (!STATUSES.includes(status)) throw new Error(`Invalid status '${status}'`);
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Order not found');

  const shippedNow = status === 'shipped' && order.status !== 'shipped';
  db.prepare(`UPDATE orders SET status = ?, shipped_at = CASE WHEN ? THEN datetime('now') ELSE shipped_at END WHERE id = ?`)
    .run(status, shippedNow ? 1 : 0, orderId);

  if (shippedNow) {
    const onTime = !order.ship_by || new Date() <= new Date(order.ship_by);
    events.emit('order.shipped', { order: { ...order, status }, onTime });
  }
  if (status === 'done' && order.status !== 'done') {
    events.emit('sale.completed', { order: { ...order, status } });
  }
  return { done: true };
});

// Manual sales (Facebook and friends) count like any other order —
// including toward points, targets, and streaks.
rpc.register('orders.manualAdd', ({ channelId = 'facebook', buyer, itemSummary, quantity, totalCents, costCents, shipBy }) => {
  if (!itemSummary || !totalCents) throw new Error('Need at least an item and a sale amount');
  const r = getDb().prepare(`INSERT INTO orders (channel_id, external_id, buyer, item_summary, quantity, total_cents, cost_cents, order_date, ship_by, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, 'new')`)
    .run(channelId, `manual-${Date.now()}`, buyer || '', itemSummary, quantity || 1, totalCents, costCents || 0, shipBy || null);
  events.emit('order.new', { channelId, externalId: null, orderId: r.lastInsertRowid });
  return { orderId: r.lastInsertRowid };
});

// Your material cost per order — powers margin-scaled sale points.
rpc.register('orders.setCost', ({ orderId, costCents }) => {
  getDb().prepare('UPDATE orders SET cost_cents = ? WHERE id = ?').run(costCents || 0, orderId);
  return { done: true };
});

module.exports = { upsertOrders };
