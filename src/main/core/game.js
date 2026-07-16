// "Shop Tycoon" gamification engine.
//
// Points only ever come from real business events emitted by the core
// modules (sales, shipments, replies, reviews, budgets, targets). The
// honest strategy — fast accurate replies, on-time shipping, fair margins —
// is by construction the highest-scoring one: there is no event the owner
// (or the AI assistant) can farm without doing the actual work.
'use strict';

const rpc = require('../rpc');
const { get: getDb } = require('../db');
const config = require('../config');
const events = require('./events');

let broadcastFn = () => {};

// ---------- period helpers ----------

function parseDbDate(s) {
  if (!s) return null;
  return s.includes('T') ? new Date(s) : new Date(s.replace(' ', 'T') + 'Z');
}
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthKey(d = new Date()) { return dayKey(d).slice(0, 7); }
function weekKey(d = new Date()) {
  // ISO week
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const week1 = new Date(t.getFullYear(), 0, 4);
  const w = 1 + Math.round(((t - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-W${String(w).padStart(2, '0')}`;
}
function periodRange(scope, now = new Date()) {
  if (scope === 'daily') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return { start, end, key: dayKey(now) };
  }
  if (scope === 'weekly') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return { start, end, key: weekKey(now) };
  }
  if (scope === 'monthly') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end, key: monthKey(now) };
  }
  throw new Error(`unknown scope ${scope}`);
}
function prevPeriodKey(scope, now = new Date()) {
  const d = new Date(now);
  if (scope === 'daily') d.setDate(d.getDate() - 1);
  if (scope === 'weekly') d.setDate(d.getDate() - 7);
  if (scope === 'monthly') d.setMonth(d.getMonth() - 1);
  return scope === 'daily' ? dayKey(d) : scope === 'weekly' ? weekKey(d) : monthKey(d);
}

// ---------- points ledger ----------

function award(points, reason, meta = {}) {
  if (!points) return;
  getDb().prepare('INSERT INTO points_ledger (points, reason, meta) VALUES (?, ?, ?)')
    .run(Math.round(points), reason, JSON.stringify(meta));
  broadcastFn({ type: 'points', points: Math.round(points), reason });
}

function totalPoints() {
  return getDb().prepare('SELECT COALESCE(SUM(points),0) p FROM points_ledger').get().p;
}

// ---------- metrics (all computed from real rows, in-period) ----------

function ordersIn(start, end, dateCol = 'order_date') {
  return getDb().prepare(`SELECT * FROM orders WHERE status != 'cancelled'`).all()
    .filter(o => {
      const d = parseDbDate(o[dateCol] || o.created_at);
      return d && d >= start && d < end;
    });
}

function metricValue(metric, value, { start, end }) {
  const db = getDb();
  switch (metric) {
    case 'units_sold': {
      const units = ordersIn(start, end).reduce((n, o) => n + (o.quantity || 1), 0);
      return { progress: units, goal: value, done: units >= value };
    }
    case 'revenue': {
      const cents = ordersIn(start, end).reduce((n, o) => n + (o.total_cents || 0), 0);
      return { progress: cents / 100, goal: value, done: cents / 100 >= value };
    }
    case 'listings_published': {
      const n = db.prepare(`SELECT created_at FROM listings WHERE status IN ('published','exported')`).all()
        .filter(l => { const d = parseDbDate(l.created_at); return d >= start && d < end; }).length;
      return { progress: n, goal: value, done: n >= value };
    }
    case 'orders_all_shipped': {
      const pending = db.prepare(`SELECT COUNT(*) c FROM orders WHERE status IN ('new','packed')`).get().c;
      const shipped = ordersIn(start, end, 'shipped_at').filter(o => o.shipped_at).length;
      return { progress: pending === 0 && shipped > 0 ? 1 : 0, goal: 1, done: pending === 0 && shipped > 0, label: pending ? `${pending} still pending` : (shipped ? 'all shipped ✔' : 'nothing shipped yet') };
    }
    case 'late_shipments_max': {
      const shippedRows = ordersIn(start, end, 'shipped_at').filter(o => o.shipped_at);
      const late = shippedRows.filter(o => o.ship_by && parseDbDate(o.shipped_at) > parseDbDate(o.ship_by)).length;
      // Requires at least one real shipment — an empty week is not "zero late".
      return { progress: late, goal: value, done: shippedRows.length > 0 && late <= value, label: `${late} late / ${shippedRows.length} shipped`, invert: true };
    }
    case 'replies_all_within_minutes': {
      const msgs = db.prepare(`SELECT m.*, (
          SELECT MIN(COALESCE(o.sent_at, o.created_at)) FROM messages o
          WHERE o.thread_id = m.thread_id AND o.direction = 'out'
            AND COALESCE(o.sent_at, o.created_at) >= COALESCE(m.sent_at, m.created_at)
        ) AS replied_at
        FROM messages m WHERE m.direction = 'in'`).all()
        .filter(m => { const d = parseDbDate(m.sent_at || m.created_at); return d >= start && d < end; });
      if (msgs.length === 0) return { progress: 0, goal: 1, done: false, label: 'no messages yet today' };
      let okCount = 0;
      let allOk = true;
      for (const m of msgs) {
        const inAt = parseDbDate(m.sent_at || m.created_at);
        const outAt = parseDbDate(m.replied_at);
        if (outAt && (outAt - inAt) / 60000 <= value) okCount++;
        else if (outAt) allOk = false;
        else if ((Date.now() - inAt) / 60000 > value) allOk = false; // clock ran out
        else allOk = false; // not replied yet — still time, but not done
      }
      return { progress: okCount, goal: msgs.length, done: allOk && okCount === msgs.length, label: `${okCount}/${msgs.length} within ${value}m` };
    }
    default:
      return { progress: 0, goal: 1, done: false, label: `unknown metric ${metric}` };
  }
}

// ---------- challenges ----------

function challengeStates() {
  const cfg = config.load().game.challenges;
  const out = [];
  for (const scope of ['daily', 'weekly']) {
    const range = periodRange(scope);
    for (const c of cfg[scope] || []) {
      const state = getDb().prepare('SELECT * FROM challenge_state WHERE challenge_id = ? AND period_key = ?').get(c.id, range.key);
      const m = metricValue(c.metric, c.value, range);
      out.push({ ...c, scope, periodKey: range.key, completed: !!state?.completed_at, ...m });
    }
  }
  // Seasons
  const now = new Date();
  for (const s of cfg.seasons || []) {
    const start = new Date(s.start + 'T00:00:00');
    const end = new Date(s.end + 'T23:59:59');
    const active = now >= start && now <= end;
    const past = now > end;
    if (!active && !past) continue;
    const range = { start, end };
    const rev = metricValue('revenue', s.targets?.revenue || 0, range);
    const units = metricValue('units_sold', s.targets?.units || 0, range);
    const state = getDb().prepare('SELECT * FROM challenge_state WHERE challenge_id = ? AND period_key = ?').get(s.id, s.id);
    out.push({
      id: s.id, name: s.name, desc: s.theme, scope: 'season', points: s.points,
      periodKey: s.id, active, past, completed: !!state?.completed_at,
      season: { revenue: rev, units, start: s.start, end: s.end },
      done: rev.done && units.done
    });
  }
  return out;
}

function evaluateChallenges() {
  const db = getDb();
  for (const c of challengeStates()) {
    if (c.completed || !c.done) continue;
    if (c.scope === 'season' && !(c.active || c.past)) continue;
    const r = db.prepare(`INSERT OR IGNORE INTO challenge_state (challenge_id, period_key, completed_at, points_awarded)
      VALUES (?, ?, datetime('now'), ?)`).run(c.id, c.periodKey, c.points);
    if (r.changes > 0) {
      const tag = c.scope === 'daily' ? 'Daily' : c.scope === 'weekly' ? 'Weekly' : 'Season';
      award(c.points, `🏅 ${tag} challenge complete: ${c.name}`);
      if (c.scope === 'weekly' && c.metric === 'revenue') bumpStreak('weekly_target', c.periodKey, 'weekly');
    }
  }
  evaluateMonthlyRollovers();
}

// ---------- streaks ----------

function bumpStreak(key, periodKeyNow, scope) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM streaks WHERE key = ?').get(key) || { count: 0, best: 0, last_period: '' };
  if (row.last_period === periodKeyNow) return row.count;
  const prev = prevPeriodKey(scope);
  const count = row.last_period === prev ? row.count + 1 : 1;
  const best = Math.max(count, row.best);
  db.prepare(`INSERT INTO streaks (key, count, best, last_period) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET count = excluded.count, best = excluded.best, last_period = excluded.last_period`)
    .run(key, count, best, periodKeyNow);
  const cfg = config.load().game.streaks;
  if (count >= 2) {
    if (key === 'daily_ship') award(cfg.dailyShipStreakBonus, `🔥 Ship streak: ${count} days in a row`);
    if (key === 'weekly_target') award(cfg.weeklyTargetStreakBonus, `🔥 Target streak: ${count} weeks in a row`);
  }
  return count;
}

function currentStreak(key, scope) {
  const row = getDb().prepare('SELECT * FROM streaks WHERE key = ?').get(key);
  if (!row) return { count: 0, best: 0 };
  const nowKey = scope === 'daily' ? dayKey() : weekKey();
  // A streak is alive if it was extended this period or last period.
  const alive = row.last_period === nowKey || row.last_period === prevPeriodKey(scope);
  return { count: alive ? row.count : 0, best: row.best };
}

// ---------- monthly rollover bonuses (budget + targets) ----------

function monthStats(mKey) {
  const [y, m] = mKey.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const orders = ordersIn(start, end);
  const revenue = orders.reduce((n, o) => n + o.total_cents, 0) / 100;
  const units = orders.reduce((n, o) => n + (o.quantity || 1), 0);
  const spent = getDb().prepare('SELECT ts, amount_cents FROM expenses').all()
    .filter(e => { const d = parseDbDate(e.ts); return d >= start && d < end; })
    .reduce((n, e) => n + e.amount_cents, 0) / 100;
  return { revenue, units, spent };
}

function evaluateMonthlyRollovers() {
  const db = getDb();
  const nowMonth = monthKey();
  const last = db.prepare(`SELECT value FROM kv WHERE key = 'lastMonthEvaluated'`).get()?.value;
  if (last === nowMonth) return;
  db.prepare(`INSERT INTO kv (key, value) VALUES ('lastMonthEvaluated', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(nowMonth);
  if (!last) return; // first ever run: nothing to settle

  const g = config.load().game;
  const s = monthStats(last);
  if (s.revenue >= g.targets.monthlyRevenue) award(g.points.monthlyRevenueTargetBonus, `🎯 Monthly revenue target hit for ${last} ($${s.revenue.toFixed(0)})`);
  if (s.units >= g.targets.monthlyUnits) award(g.points.monthlyUnitsTargetBonus, `🎯 Monthly unit goal hit for ${last} (${s.units} pieces)`);
  if (s.spent <= g.targets.monthlyBudget) award(g.points.monthlyBudgetBonus, `💰 Stayed in budget for ${last} ($${s.spent.toFixed(0)} of $${g.targets.monthlyBudget})`);
}

// ---------- event scoring ----------

function activeSeason() {
  const now = new Date();
  return (config.load().game.challenges.seasons || []).find(s =>
    now >= new Date(s.start + 'T00:00:00') && now <= new Date(s.end + 'T23:59:59'));
}

function wireEvents() {
  const p = () => config.load().game.points;

  events.on('sale.completed', ({ order }) => {
    const pts = p();
    let base = pts.saleBase;
    let note = '';
    if (pts.saleMarginScale && order.total_cents > 0) {
      const marginPct = ((order.total_cents - (order.cost_cents || 0)) / order.total_cents) * 100;
      const scale = Math.min(1.5, Math.max(0.25, marginPct / pts.targetMarginPct));
      base = Math.round(pts.saleBase * scale);
      note = ` (${marginPct.toFixed(0)}% margin)`;
    }
    award(base, `💵 Sale completed: ${order.item_summary}${note}`);
    const season = activeSeason();
    if (season?.bonusPerSale) award(season.bonusPerSale, `🎄 ${season.name} bonus sale`);
    evaluateChallenges();
  });

  events.on('order.shipped', ({ order, onTime }) => {
    const pts = p();
    if (onTime) award(pts.shipOnTimeBonus, `📦 Shipped on time: ${order.item_summary}`);
    else award(pts.shipLatePenalty, `🐌 Shipped late: ${order.item_summary}`);
    bumpStreak('daily_ship', dayKey(), 'daily');
    evaluateChallenges();
  });

  events.on('message.replied', ({ responseMinutes }) => {
    const pts = p();
    award(pts.replyBase, '💬 Replied to a customer');
    if (responseMinutes !== null && responseMinutes <= pts.fastReplyMinutes) {
      award(pts.fastReplyBonus, `⚡ Fast reply (${Math.round(responseMinutes)} min)`);
    }
    evaluateChallenges();
  });

  events.on('thread.resolved', () => {
    award(p().threadResolvedBonus, '✅ Conversation resolved');
    evaluateChallenges();
  });

  events.on('listing.published', () => {
    award(p().listingPublishedBonus, '🪧 Listing posted');
    evaluateChallenges();
  });
}

// ---------- dashboard summary ----------

function levelInfo(points) {
  const levels = config.load().game.levels;
  let current = levels[0], next = null;
  for (const l of levels) {
    if (points >= l.at) current = l;
    else { next = l; break; }
  }
  return {
    name: current.name,
    next: next?.name || null,
    progress: next ? (points - current.at) / (next.at - current.at) : 1,
    pointsToNext: next ? next.at - points : 0
  };
}

function summary() {
  const g = config.load().game;
  const points = totalPoints();
  const day = periodRange('daily');
  const week = periodRange('weekly');
  const month = periodRange('monthly');
  const stat = (r) => {
    const os = ordersIn(r.start, r.end);
    return { revenue: os.reduce((n, o) => n + o.total_cents, 0) / 100, units: os.reduce((n, o) => n + (o.quantity || 1), 0) };
  };
  const spentMonth = monthStats(month.key).spent;
  return {
    points,
    level: levelInfo(points),
    today: stat(day),
    week: { ...stat(week), revenueTarget: g.targets.weeklyRevenue, unitsTarget: g.targets.weeklyUnits },
    month: {
      ...stat(month),
      revenueTarget: g.targets.monthlyRevenue,
      unitsTarget: g.targets.monthlyUnits,
      budget: g.targets.monthlyBudget,
      spent: spentMonth
    },
    streaks: {
      dailyShip: currentStreak('daily_ship', 'daily'),
      weeklyTarget: currentStreak('weekly_target', 'weekly')
    },
    challenges: challengeStates(),
    pendingOrders: getDb().prepare(`SELECT COUNT(*) c FROM orders WHERE status IN ('new','packed')`).get().c,
    unread: getDb().prepare('SELECT COALESCE(SUM(unread),0) u FROM threads').get().u
  };
}

// ---------- RPC + init ----------

function init({ broadcast }) {
  broadcastFn = broadcast || broadcastFn;
  wireEvents();
  evaluateChallenges(); // settle any month rollover on launch
}

rpc.register('game.summary', () => { evaluateChallenges(); return summary(); });
rpc.register('game.feed', ({ limit = 40 } = {}) =>
  getDb().prepare('SELECT * FROM points_ledger ORDER BY id DESC LIMIT ?').all(limit));
rpc.register('game.recordReview', ({ positive = true, note = '' }) => {
  if (positive) award(config.load().game.points.positiveReviewBonus, `⭐ Positive review${note ? ': ' + note : ''}`);
  else award(0, `📝 Review noted${note ? ': ' + note : ''}`);
  return { done: true };
});
rpc.register('expenses.add', ({ amountCents, category, note }) => {
  if (!amountCents) throw new Error('Amount required');
  getDb().prepare('INSERT INTO expenses (amount_cents, category, note) VALUES (?, ?, ?)')
    .run(amountCents, category || 'materials', note || '');
  return { done: true };
});
rpc.register('expenses.list', () =>
  getDb().prepare('SELECT * FROM expenses ORDER BY ts DESC LIMIT 100').all());

module.exports = { init, award, evaluateChallenges, summary, totalPoints, _test: { metricValue, periodRange, bumpStreak, monthStats, levelInfo } };
