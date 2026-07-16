// Listings: render products through per-channel templates, preview,
// publish via each channel's adapter (API post or manual export).
'use strict';

const rpc = require('../rpc');
const { get: getDb } = require('../db');
const templates = require('./templates');
const events = require('./events');

rpc.register('templates.get', ({ channelId }) => templates.getTemplate(channelId));
rpc.register('templates.save', ({ channelId, template }) => { templates.saveTemplate(channelId, template); return { done: true }; });
rpc.register('templates.reset', ({ channelId }) => templates.resetTemplate(channelId));

rpc.register('listings.render', async ({ productId, channelId }) => {
  const product = getDb().prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');
  return templates.render(product, channelId);
});

rpc.register('listings.forProduct', ({ productId }) => {
  return getDb().prepare(`SELECT l.*, c.display_name AS channel_name FROM listings l
    JOIN channels c ON c.id = l.channel_id WHERE l.product_id = ? ORDER BY l.updated_at DESC`).all(productId);
});

// Publish to selected channels. API channels post through their adapter;
// manual channels return the formatted text for the owner to copy/paste.
// Each channel result is independent — one failing doesn't block the rest.
rpc.register('listings.publish', async ({ productId, channelIds }) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Product not found');
  if (!channelIds?.length) throw new Error('Pick at least one channel');

  const adapters = require('../adapters');
  const results = [];
  for (const channelId of channelIds) {
    const rendered = templates.render(product, channelId);
    const upsert = (status, extra = {}) => {
      db.prepare(`INSERT INTO listings (product_id, channel_id, external_id, status, rendered, error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
        .run(productId, channelId, extra.externalId || null, status, JSON.stringify(rendered.flat), extra.error || '');
    };
    try {
      const adapter = adapters.get(channelId);
      if (!adapter.capabilities.publish) throw new Error(`${adapter.displayName} doesn't support publishing yet (adapter not connected).`);
      const res = await adapter.publishListing(product, rendered.flat);
      if (res.exported) {
        upsert('exported');
        results.push({ channelId, exported: res.exported });
      } else {
        upsert('published', { externalId: res.externalId });
        results.push({ channelId, externalId: res.externalId });
      }
      events.emit('listing.published', { productId, channelId });
    } catch (e) {
      upsert('error', { error: e.message });
      results.push({ channelId, error: e.message });
    }
  }
  return results;
});

module.exports = {};
