// Per-channel listing templates.
//
// A template is a set of named fields, each with a {{variable}} template
// string and an optional hard character limit (the marketplace's real limit).
// Templates are editable in the UI and stored in the DB; these defaults are
// used until the owner customizes them.
//
// Available variables (from the product + config):
//   {{title}} {{description}} {{dimensions}} {{materials}} {{sku}} {{quantity}}
//   {{price}}        → "$45.00"      {{price_number}} → "45.00"
//   {{tags}}         → "a, b, c"     {{tags_hashtags}} → "#a #b #c"
//   {{shop_name}}
'use strict';

const { get: getDb } = require('../db');
const config = require('../config');

const DEFAULT_TEMPLATES = {
  ebay: {
    label: 'eBay',
    notes: 'Title ≤ 80 chars, keyword-forward (buyers search, they don\'t browse). Description allows basic HTML.',
    fields: {
      title: { template: '{{title}} Handmade {{materials}} - Solid Wood', maxLen: 80 },
      description: {
        template:
`{{description}}

DETAILS
• Materials: {{materials}}
• Dimensions: {{dimensions}}
• Handmade in my workshop — each piece is one of a kind, so grain and color vary slightly.

Ships carefully packed. Message me with any questions — I'm happy to help.`
      },
      categoryId: { template: '', maxLen: 20 }
    }
  },
  amazon: {
    label: 'Amazon',
    notes: 'Title ≤ 200 chars: Brand + Product + Key Attributes. Description reads best as feature bullets.',
    fields: {
      title: { template: '{{shop_name}} {{title}}, Handmade {{materials}}, {{dimensions}}', maxLen: 200 },
      description: {
        template:
`ABOUT THIS ITEM
- Handcrafted from {{materials}}
- Size: {{dimensions}}
- {{description}}
- Made to order by a solo woodworker; slight natural variation in every piece`
      }
    }
  },
  walmart: {
    label: 'Walmart',
    notes: 'Title ≤ 200 chars. Plain, factual descriptions perform best.',
    fields: {
      title: { template: '{{title}} - Handmade {{materials}} - {{dimensions}}', maxLen: 200 },
      description: { template: '{{description}}\n\nMaterials: {{materials}}. Dimensions: {{dimensions}}. Handmade.' }
    }
  },
  facebook: {
    label: 'Facebook Marketplace',
    notes: 'Casual and local. Title ≤ 99 chars. Hashtags help local search. This channel is copy/paste — the app formats, you post.',
    fields: {
      title: { template: '{{title}} — handmade {{materials}}', maxLen: 99 },
      price: { template: '{{price}}' },
      description: {
        template:
`{{description}}

Handmade by me from {{materials}} • {{dimensions}}
Local pickup or can meet nearby. Message me!`
      },
      tags: { template: '{{tags_hashtags}} #handmade #woodworking #shoplocal' }
    }
  }
};

function money(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}

function variablesFor(product) {
  const cfg = config.load();
  const tags = String(product.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  return {
    title: product.title || '',
    description: product.description || '',
    dimensions: product.dimensions || '',
    materials: product.materials || '',
    sku: product.sku || '',
    quantity: String(product.quantity ?? 1),
    price: money(product.price_cents, cfg.currency),
    price_number: ((product.price_cents || 0) / 100).toFixed(2),
    tags: tags.join(', '),
    tags_hashtags: tags.map(t => '#' + t.replace(/\s+/g, '')).join(' '),
    shop_name: cfg.shopName
  };
}

function fill(templateStr, vars) {
  return String(templateStr || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`))
    .replace(/[ \t]+\n/g, '\n').trim();
}

function getTemplate(channelId) {
  const row = getDb().prepare('SELECT template FROM templates WHERE channel_id = ?').get(channelId);
  if (row) return JSON.parse(row.template);
  const def = DEFAULT_TEMPLATES[channelId];
  if (!def) throw new Error(`No template defined for channel '${channelId}'`);
  return def;
}

function saveTemplate(channelId, template) {
  getDb().prepare('INSERT INTO templates (channel_id, template) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET template = excluded.template')
    .run(channelId, JSON.stringify(template));
}

function resetTemplate(channelId) {
  getDb().prepare('DELETE FROM templates WHERE channel_id = ?').run(channelId);
  return DEFAULT_TEMPLATES[channelId];
}

/**
 * Render a product through a channel's template.
 * Returns { fields: { name: { value, limit, over, length } }, flat: { name: value } }
 * — `flat` truncated to limits, ready for the adapter; `fields` for the preview UI.
 */
function render(product, channelId) {
  const tpl = getTemplate(channelId);
  const vars = variablesFor(product);
  const fields = {};
  const flat = {};
  for (const [name, spec] of Object.entries(tpl.fields)) {
    const value = fill(spec.template, vars);
    const limit = spec.maxLen || null;
    fields[name] = { value, limit, length: value.length, over: !!(limit && value.length > limit) };
    flat[name] = limit ? value.slice(0, limit) : value;
  }
  return { fields, flat, notes: tpl.notes || '' };
}

module.exports = { getTemplate, saveTemplate, resetTemplate, render, DEFAULT_TEMPLATES, variablesFor };
