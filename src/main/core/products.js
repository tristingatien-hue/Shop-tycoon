// Product catalog: create a product once, list it everywhere.
'use strict';

const rpc = require('../rpc');
const { get: getDb } = require('../db');

rpc.register('products.list', () => {
  return getDb().prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM listings l WHERE l.product_id = p.id AND l.status IN ('published','exported')) AS live_count
    FROM products p ORDER BY p.updated_at DESC`).all();
});

rpc.register('products.get', ({ id }) => {
  const p = getDb().prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) throw new Error('Product not found');
  return p;
});

rpc.register('products.save', (p) => {
  const db = getDb();
  const photos = JSON.stringify(Array.isArray(p.photos) ? p.photos : []);
  if (p.id) {
    db.prepare(`UPDATE products SET sku=?, title=?, description=?, price_cents=?, cost_cents=?, quantity=?,
      dimensions=?, materials=?, tags=?, photos=?, updated_at=datetime('now') WHERE id=?`)
      .run(p.sku || null, p.title, p.description || '', p.price_cents || 0, p.cost_cents || 0, p.quantity || 1,
        p.dimensions || '', p.materials || '', p.tags || '', photos, p.id);
    return { id: p.id };
  }
  if (!p.title) throw new Error('A product needs at least a title');
  const r = db.prepare(`INSERT INTO products (sku, title, description, price_cents, cost_cents, quantity, dimensions, materials, tags, photos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(p.sku || null, p.title, p.description || '', p.price_cents || 0, p.cost_cents || 0, p.quantity || 1,
      p.dimensions || '', p.materials || '', p.tags || '', photos);
  return { id: r.lastInsertRowid };
});

rpc.register('products.delete', ({ id }) => {
  const db = getDb();
  db.prepare('DELETE FROM listings WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  return { done: true };
});

module.exports = {};
