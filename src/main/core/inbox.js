// Unified inbox: every channel's messages normalized into threads/messages,
// replies routed back out through the right adapter (or exported for
// copy/paste on manual channels).
'use strict';

const rpc = require('../rpc');
const { get: getDb } = require('../db');
const events = require('./events');

// ---------- sync upsert (called by core/sync.js) ----------

function upsertThreads(channelId, threads) {
  const db = getDb();
  let newIncoming = 0;
  const findThread = db.prepare('SELECT id FROM threads WHERE channel_id = ? AND external_thread_id = ?');
  const insThread = db.prepare(`INSERT INTO threads (channel_id, external_thread_id, subject, counterpart, listing_ref, order_ref, last_message_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insMsg = db.prepare(`INSERT OR IGNORE INTO messages (thread_id, external_id, direction, sender, body, sent_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'received')`);
  const touch = db.prepare(`UPDATE threads SET last_message_at = MAX(COALESCE(last_message_at,''), ?), unread = unread + ?, status = 'open' WHERE id = ?`);

  const tx = db.transaction(() => {
    for (const t of threads) {
      let row = findThread.get(channelId, t.externalThreadId);
      if (!row) {
        const r = insThread.run(channelId, t.externalThreadId, t.subject || '', t.counterpart || '', t.listingRef || '', t.orderRef || '', null);
        row = { id: r.lastInsertRowid };
      }
      let added = 0, latest = '';
      for (const m of t.messages || []) {
        const r = insMsg.run(row.id, m.externalId, m.direction, m.sender || '', m.body || '', m.sentAt || null);
        if (r.changes > 0 && m.direction === 'in') added++;
        if (m.sentAt && m.sentAt > latest) latest = m.sentAt;
      }
      if (added > 0) { touch.run(latest, added, row.id); newIncoming += added; }
    }
  });
  tx();
  return newIncoming;
}

// ---------- RPC ----------

rpc.register('inbox.threads', ({ channel, status } = {}) => {
  const db = getDb();
  const where = [];
  const args = [];
  if (channel) { where.push('t.channel_id = ?'); args.push(channel); }
  if (status) { where.push('t.status = ?'); args.push(status); }
  return db.prepare(`
    SELECT t.*, c.display_name AS channel_name, c.kind AS channel_kind,
      (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY COALESCE(m.sent_at, m.created_at) DESC LIMIT 1) AS preview
    FROM threads t JOIN channels c ON c.id = t.channel_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(t.last_message_at, '') DESC, t.id DESC`).all(...args);
});

rpc.register('inbox.messages', ({ threadId }) => {
  const db = getDb();
  const thread = db.prepare(`SELECT t.*, c.display_name AS channel_name, c.kind AS channel_kind
    FROM threads t JOIN channels c ON c.id = t.channel_id WHERE t.id = ?`).get(threadId);
  if (!thread) throw new Error('Thread not found');
  const messages = db.prepare(`SELECT * FROM messages WHERE thread_id = ? ORDER BY COALESCE(sent_at, created_at), id`).all(threadId);
  return { thread, messages };
});

rpc.register('inbox.markRead', ({ threadId }) => {
  getDb().prepare('UPDATE threads SET unread = 0 WHERE id = ?').run(threadId);
  return { done: true };
});

rpc.register('inbox.resolve', ({ threadId }) => {
  getDb().prepare(`UPDATE threads SET status = 'resolved', unread = 0 WHERE id = ?`).run(threadId);
  events.emit('thread.resolved', { threadId });
  return { done: true };
});

// Reply routing. API channels send through their adapter; manual channels
// get the text back as { exported } for the UI to copy to the clipboard.
rpc.register('inbox.reply', async ({ threadId, body }) => {
  if (!body || !body.trim()) throw new Error('Reply is empty');
  const db = getDb();
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId);
  if (!thread) throw new Error('Thread not found');
  const adapter = require('../adapters').get(thread.channel_id);

  const lastIn = db.prepare(`SELECT COALESCE(sent_at, created_at) AS at FROM messages
    WHERE thread_id = ? AND direction = 'in' ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 1`).get(threadId);

  const result = await adapter.sendReply(thread, body);
  const status = result.sent ? 'sent' : 'exported';
  db.prepare(`INSERT INTO messages (thread_id, direction, sender, body, sent_at, status)
    VALUES (?, 'out', 'me', ?, datetime('now'), ?)`).run(threadId, body, status);
  db.prepare(`UPDATE threads SET unread = 0, last_message_at = datetime('now') WHERE id = ?`).run(threadId);

  const lastInDate = lastIn ? (lastIn.at.includes('T') ? new Date(lastIn.at) : new Date(lastIn.at.replace(' ', 'T') + 'Z')) : null;
  const responseMinutes = lastInDate ? Math.max(0, (Date.now() - lastInDate.getTime()) / 60000) : null;
  events.emit('message.replied', { threadId, channelId: thread.channel_id, responseMinutes });
  return result;
});

// Manual entry — how Facebook (and any future manual channel) messages get in.
rpc.register('inbox.manualThread', ({ channelId = 'facebook', counterpart, subject, listingRef, body }) => {
  if (!counterpart || !body) throw new Error('Need at least a name and the message text');
  const db = getDb();
  const r = db.prepare(`INSERT INTO threads (channel_id, external_thread_id, subject, counterpart, listing_ref, last_message_at, unread)
    VALUES (?, ?, ?, ?, ?, datetime('now'), 1)`)
    .run(channelId, `manual-${Date.now()}`, subject || `Chat with ${counterpart}`, counterpart, listingRef || '');
  db.prepare(`INSERT INTO messages (thread_id, direction, sender, body, sent_at, status)
    VALUES (?, 'in', ?, ?, datetime('now'), 'received')`).run(r.lastInsertRowid, counterpart, body);
  return { threadId: r.lastInsertRowid };
});

rpc.register('inbox.manualIncoming', ({ threadId, body }) => {
  if (!body) throw new Error('Message text is empty');
  const db = getDb();
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId);
  if (!thread) throw new Error('Thread not found');
  db.prepare(`INSERT INTO messages (thread_id, direction, sender, body, sent_at, status)
    VALUES (?, 'in', ?, ?, datetime('now'), 'received')`).run(threadId, thread.counterpart, body);
  db.prepare(`UPDATE threads SET unread = unread + 1, last_message_at = datetime('now'), status = 'open' WHERE id = ?`).run(threadId);
  return { done: true };
});

module.exports = { upsertThreads };
