// SQLite storage. One local file, versioned migrations, no cloud.
'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { dataDir } = require('./paths');

let db = null;

const MIGRATIONS = [
  // v1 — core schema
  `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    sku TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    price_cents INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    dimensions TEXT DEFAULT '',
    materials TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    photos TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE channels (
    id TEXT PRIMARY KEY,             -- 'ebay', 'facebook', 'amazon', 'walmart'
    display_name TEXT NOT NULL,
    kind TEXT NOT NULL,              -- 'api' | 'manual'
    status TEXT NOT NULL DEFAULT 'not_connected', -- not_connected|connected|expired|error|manual
    status_detail TEXT DEFAULT '',
    connected_at TEXT
  );

  CREATE TABLE listings (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    channel_id TEXT NOT NULL REFERENCES channels(id),
    external_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft', -- draft|queued|published|exported|error
    rendered TEXT DEFAULT '{}',          -- channel-formatted fields as JSON
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE templates (
    channel_id TEXT PRIMARY KEY,
    template TEXT NOT NULL            -- JSON: fields, limits, layout
  );

  CREATE TABLE threads (
    id INTEGER PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    external_thread_id TEXT,
    subject TEXT DEFAULT '',
    counterpart TEXT DEFAULT '',      -- buyer username/name
    listing_ref TEXT DEFAULT '',
    order_ref TEXT DEFAULT '',
    last_message_at TEXT,
    unread INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',  -- open|resolved
    UNIQUE(channel_id, external_thread_id)
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    thread_id INTEGER NOT NULL REFERENCES threads(id),
    external_id TEXT,
    direction TEXT NOT NULL,          -- 'in' | 'out'
    sender TEXT DEFAULT '',
    body TEXT NOT NULL,
    sent_at TEXT,
    status TEXT NOT NULL DEFAULT 'received', -- received|draft|queued|sent|exported|error
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(thread_id, external_id)
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    external_id TEXT,
    buyer TEXT DEFAULT '',
    item_summary TEXT DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 1,
    total_cents INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,  -- your material cost, for margin scoring
    currency TEXT DEFAULT 'USD',
    order_date TEXT,
    ship_by TEXT,
    status TEXT NOT NULL DEFAULT 'new',     -- new|packed|shipped|done|cancelled
    shipped_at TEXT,
    meta TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(channel_id, external_id)
  );

  CREATE TABLE points_ledger (
    id INTEGER PRIMARY KEY,
    ts TEXT DEFAULT (datetime('now')),
    points INTEGER NOT NULL,
    reason TEXT NOT NULL,
    meta TEXT DEFAULT '{}'
  );

  CREATE TABLE challenge_state (
    id INTEGER PRIMARY KEY,
    challenge_id TEXT NOT NULL,
    period_key TEXT NOT NULL,         -- e.g. '2026-07-07' or '2026-W28' or season id
    completed_at TEXT,
    points_awarded INTEGER DEFAULT 0,
    UNIQUE(challenge_id, period_key)
  );

  CREATE TABLE streaks (
    key TEXT PRIMARY KEY,             -- 'daily_ship', 'weekly_target'
    count INTEGER NOT NULL DEFAULT 0,
    best INTEGER NOT NULL DEFAULT 0,
    last_period TEXT DEFAULT ''
  );

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY,
    ts TEXT DEFAULT (datetime('now')),
    amount_cents INTEGER NOT NULL,
    category TEXT DEFAULT 'materials',
    note TEXT DEFAULT ''
  );

  CREATE TABLE approval_queue (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,               -- 'reply' | 'listing' | 'price_change'
    payload TEXT NOT NULL,            -- JSON
    status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE TABLE secrets (
    key TEXT PRIMARY KEY,
    value BLOB NOT NULL               -- encrypted at rest, see secrets.js
  );

  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `
];

function get() {
  if (db) return db;
  db = new Database(path.join(dataDir(), 'shop.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedChannels(db);
  return db;
}

function migrate(d) {
  const v = d.pragma('user_version', { simple: true });
  for (let i = v; i < MIGRATIONS.length; i++) {
    d.exec('BEGIN');
    try {
      d.exec(MIGRATIONS[i]);
      d.pragma(`user_version = ${i + 1}`);
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  }
}

function seedChannels(d) {
  const ins = d.prepare(
    `INSERT OR IGNORE INTO channels (id, display_name, kind, status, status_detail) VALUES (?, ?, ?, ?, ?)`
  );
  ins.run('ebay', 'eBay', 'api', 'not_connected', '');
  ins.run('facebook', 'Facebook Marketplace', 'manual', 'manual',
    'Manual-assist: no official listing API for individual sellers. The app drafts and formats; you copy/paste.');
  ins.run('amazon', 'Amazon', 'api', 'not_connected', 'Adapter planned (SP-API). Not yet connected.');
  ins.run('walmart', 'Walmart Marketplace', 'api', 'not_connected', 'Adapter planned (Marketplace API). Not yet connected.');
}

function close() {
  if (db) { db.close(); db = null; }
}

module.exports = { get, close };
