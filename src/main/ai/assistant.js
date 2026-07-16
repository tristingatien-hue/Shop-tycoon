// The local AI assistant (build stage 6).
//
// HARD GUARDRAILS — enforced here in code, not just in prompts:
//   1. The assistant's ONLY write path is the approval_queue table. It cannot
//      send messages or post listings; sending happens exclusively in
//      approvals.approve (an owner click), which routes through the same
//      inbox.reply pipeline the owner uses by hand. Manual channels
//      (Facebook) physically cannot auto-post — their adapters only export.
//   2. Prompts contain only data the owner entered (product rows, thread
//      text, config rules). The model is instructed to never invent specs,
//      prices, discounts, or delivery promises, and every draft is reviewed
//      by the owner before anything leaves the app.
//   3. Pricing suggestions are computed deterministically from cost + target
//      margin config; the model never changes a live price (no code path
//      exists for it to do so).
//   4. Points are the optimization signal, but points only accrue from real
//      outcomes (game.js), so honest work is always the best strategy.
//
// Backend: any OpenAI-compatible local endpoint via config.ai — DeepSeek
// through Ollama (http://localhost:11434/v1) or LM Studio
// (http://localhost:1234/v1) both work. Reasoning models like deepseek-r1
// emit <think>…</think> blocks; provider output is scrubbed of them so
// internal reasoning can never leak into a customer-facing draft.
'use strict';

const rpc = require('../rpc');
const { get: getDb } = require('../db');
const config = require('../config');
const provider = require('./provider');

function requireEnabled() {
  if (!config.load().ai.enabled) {
    throw new Error('The AI assistant is turned off. Enable it in Settings → Local AI assistant (and make sure your local model is running).');
  }
}

// Reasoning models think out loud; customers must never see it.
function scrub(text) {
  return String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// Models sometimes wrap JSON in prose or code fences; dig it out.
function parseJson(text) {
  const cleaned = scrub(text).replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The model did not return usable JSON — try again or try a different model.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function voice() {
  const cfg = config.load();
  return `You are the writing assistant for "${cfg.shopName}", a one-person handmade woodworking shop.
Write as the owner: warm, brief, plain language, no corporate tone, no emojis unless the customer used them.
STRICT RULES:
- Use ONLY facts given in this prompt. NEVER invent materials, dimensions, prices, discounts, stock, shipping times, or return terms.
- If the customer asks something the facts don't answer, the reply should say you'll check and get back to them.
- Never promise anything about delivery dates, custom work, or holds unless it is stated in the facts.`;
}

// ---------- inbox triage ----------

function threadsNeedingReply() {
  // Open threads whose latest message is from the customer.
  return getDb().prepare(`
    SELECT t.*, c.display_name AS channel_name, c.kind AS channel_kind
    FROM threads t JOIN channels c ON c.id = t.channel_id
    WHERE t.status = 'open' AND (
      SELECT m.direction FROM messages m WHERE m.thread_id = t.id
      ORDER BY COALESCE(m.sent_at, m.created_at) DESC, m.id DESC LIMIT 1
    ) = 'in'`).all();
}

async function triageThread(thread) {
  const db = getDb();
  const msgs = db.prepare(`SELECT direction, sender, body FROM messages WHERE thread_id = ?
    ORDER BY COALESCE(sent_at, created_at), id`).all(thread.id).slice(-12);
  const transcript = msgs.map(m => `${m.direction === 'in' ? thread.counterpart : 'me (owner)'}: ${m.body}`).join('\n');

  // Ground the draft in the product row when the thread references a listing.
  let facts = 'No product facts available for this conversation.';
  if (thread.listing_ref) {
    const prod = db.prepare(`SELECT p.* FROM products p JOIN listings l ON l.product_id = p.id
      WHERE l.external_id = ? OR p.title LIKE '%' || ? || '%' LIMIT 1`).get(thread.listing_ref, thread.listing_ref)
      || db.prepare(`SELECT * FROM products WHERE title LIKE '%' || ? || '%' LIMIT 1`).get(thread.listing_ref);
    if (prod) {
      facts = `Product facts (the ONLY product claims allowed): title: ${prod.title}; price: $${(prod.price_cents / 100).toFixed(2)}; materials: ${prod.materials || 'not specified'}; dimensions: ${prod.dimensions || 'not specified'}; description: ${prod.description}`;
    }
  }

  const out = await provider.chat([
    { role: 'system', content: voice() },
    { role: 'user', content: `Conversation on ${thread.channel_name} with ${thread.counterpart}:\n${transcript}\n\n${facts}\n\nReturn ONLY JSON: {"summary": "one sentence, what they need", "urgent": true|false (urgent = angry customer, order problem, or time-sensitive), "draft": "the reply to send"}` }
  ]);
  const parsed = parseJson(out);
  return { summary: String(parsed.summary || ''), urgent: !!parsed.urgent, draft: scrub(String(parsed.draft || '')) };
}

rpc.register('ai.triageInbox', async () => {
  requireEnabled();
  const db = getDb();
  const results = [];
  for (const thread of threadsNeedingReply()) {
    const dupe = db.prepare(`SELECT 1 FROM approval_queue WHERE kind = 'reply' AND status = 'pending'
      AND json_extract(payload, '$.threadId') = ?`).get(thread.id);
    if (dupe) continue;
    try {
      const t = await triageThread(thread);
      db.prepare(`INSERT INTO approval_queue (kind, payload) VALUES ('reply', ?)`).run(JSON.stringify({
        threadId: thread.id, channel: thread.channel_name, channelKind: thread.channel_kind,
        counterpart: thread.counterpart, summary: t.summary, urgent: t.urgent, draft: t.draft
      }));
      results.push({ threadId: thread.id, counterpart: thread.counterpart, summary: t.summary, urgent: t.urgent });
    } catch (e) {
      results.push({ threadId: thread.id, counterpart: thread.counterpart, error: e.message });
    }
  }
  return { queued: results.filter(r => !r.error).length, results };
});

// ---------- approval queue (accept / edit / reject with one click) ----------

rpc.register('approvals.list', () =>
  getDb().prepare(`SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY id DESC`).all()
    .map(r => ({ ...r, payload: JSON.parse(r.payload) })));

rpc.register('approvals.approve', async ({ id, editedDraft }) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM approval_queue WHERE id = ? AND status = 'pending'`).get(id);
  if (!row) throw new Error('Approval not found (already handled?)');
  const payload = JSON.parse(row.payload);

  if (row.kind === 'reply') {
    // The owner's click IS the send action — same pipeline as a hand-typed reply.
    const res = await rpc.dispatch('inbox.reply', { threadId: payload.threadId, body: editedDraft || payload.draft });
    if (res.error) throw new Error(res.error);
    db.prepare(`UPDATE approval_queue SET status = 'approved', resolved_at = datetime('now') WHERE id = ?`).run(id);
    return res.result; // {sent:true} or {exported: text} for manual channels
  }
  throw new Error(`Unknown approval kind '${row.kind}'`);
});

rpc.register('approvals.reject', ({ id }) => {
  getDb().prepare(`UPDATE approval_queue SET status = 'rejected', resolved_at = datetime('now') WHERE id = ? AND status = 'pending'`).run(id);
  return { done: true };
});

// ---------- listing drafting (fills the form; owner reviews and saves) ----------

rpc.register('ai.draftListing', async ({ title, materials, dimensions, notes }) => {
  requireEnabled();
  if (!title) throw new Error('Give the piece at least a working title first');
  const out = await provider.chat([
    { role: 'system', content: voice() },
    { role: 'user', content: `Draft sales copy for a handmade piece. Facts (use nothing else): title: ${title}; materials: ${materials || 'not specified'}; dimensions: ${dimensions || 'not specified'}; owner notes: ${notes || 'none'}.\n\nReturn ONLY JSON: {"description": "2 short paragraphs, no invented specs", "tags": "6-10 comma-separated search tags", "titleIdeas": ["3 alternative titles under 60 chars"]}` }
  ], { temperature: 0.7 });
  const parsed = parseJson(out);
  return {
    description: scrub(String(parsed.description || '')),
    tags: String(parsed.tags || ''),
    titleIdeas: (parsed.titleIdeas || []).map(t => scrub(String(t)))
  };
});

// ---------- pricing (deterministic math from YOUR numbers; never auto-applied) ----------

rpc.register('ai.suggestPrice', ({ costCents }) => {
  if (!costCents) throw new Error('Enter the material cost first');
  const target = config.load().game.points.targetMarginPct;
  const at = (m) => Math.round(costCents / (1 - m / 100)) / 100;
  return {
    targetMarginPct: target,
    floor: at(Math.max(10, target - 15)),
    target: at(target),
    premium: at(Math.min(85, target + 15)),
    note: `Computed from your $${(costCents / 100).toFixed(2)} cost. Floor barely clears materials — remember your hours aren't free. This never changes a live price; it's input for you.`
  };
});

// ---------- target coaching ----------

rpc.register('ai.coach', async () => {
  requireEnabled();
  const s = require('../core/game').summary();
  const facts = {
    weekRevenue: s.week.revenue, weekTarget: s.week.revenueTarget,
    monthRevenue: s.month.revenue, monthTarget: s.month.revenueTarget,
    monthUnits: s.month.units, monthUnitsTarget: s.month.unitsTarget,
    budgetSpent: s.month.spent, budget: s.month.budget,
    pendingOrders: s.pendingOrders, unreadMessages: s.unread,
    shipStreakDays: s.streaks.dailyShip.count,
    openChallenges: s.challenges.filter(c => !c.completed && c.scope !== 'season').map(c => `${c.name} (+${c.points}): ${c.desc}`)
  };
  const out = await provider.chat([
    { role: 'system', content: `You are a friendly business coach inside a shop-management game for a solo woodworker. Be concrete and numeric. Only legitimate advice: ship on time, reply fast, list more, watch spend. Never suggest spam, fake urgency, review manipulation, or anything against marketplace rules.` },
    { role: 'user', content: `Current numbers: ${JSON.stringify(facts)}. In under 120 words, give the 2-3 highest-point next actions, citing the numbers (e.g. "$40 short of the week's target").` }
  ], { temperature: 0.5 });
  return { advice: scrub(out) };
});

// ---------- status ----------

rpc.register('ai.status', async () => {
  const ai = config.load().ai;
  const reachable = await provider.available();
  return { enabled: ai.enabled, backend: { baseUrl: ai.baseUrl, model: ai.model, reachable } };
});

rpc.register('ai.testConnection', async ({ baseUrl } = {}) => {
  const url = (baseUrl || config.load().ai.baseUrl).replace(/\/$/, '');
  const res = await fetch(url + '/models', { signal: AbortSignal.timeout(4000) })
    .catch((e) => { throw new Error(`Nothing answering at ${url} — is your model runner started? (${e.message})`); });
  if (!res.ok) throw new Error(`${url}/models returned ${res.status}`);
  const body = await res.json();
  const models = (body.data || []).map(m => m.id);
  return { ok: true, models };
});

module.exports = { _test: { scrub, parseJson, threadsNeedingReply } };
