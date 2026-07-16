// The Shop Tycoon dashboard — the first thing you see. Points, rank,
// challenges, streaks, budget gauge, targets, and the running point feed.
import { call, h, esc, money, toast, timeAgo, refreshBadges } from '../app.js';

export async function render(el) {
  const [cfg, s, feed] = await Promise.all([
    call('config.get'), call('game.summary'), call('game.feed', { limit: 30 })
  ]);

  const lvl = s.level;
  const revPct = Math.min(100, (s.month.revenue / s.month.revenueTarget) * 100 || 0);
  const unitPct = Math.min(100, (s.month.units / s.month.unitsTarget) * 100 || 0);
  const budgetPct = Math.min(100, (s.month.spent / s.month.budget) * 100 || 0);
  const overBudget = s.month.spent > s.month.budget;

  el.appendChild(h(`<div>
    <div class="row spread">
      <div>
        <h1 class="page-title">🏆 ${esc(cfg.shopName)}</h1>
        <div class="page-sub">${s.pendingOrders ? `📦 ${s.pendingOrders} order${s.pendingOrders > 1 ? 's' : ''} waiting to ship` : 'No pending shipments'} · ${s.unread ? `💬 ${s.unread} unread` : 'inbox clear'}</div>
      </div>
      <div class="row">
        <button class="small" id="btn-review">⭐ Log a review</button>
        <button class="small" id="btn-expense">💰 Log an expense</button>
      </div>
    </div>
    <div id="quick-forms"></div>

    <div class="grid cols-4">
      <div class="panel">
        <div class="stat-label">Rank</div>
        <div class="stat-big" style="color:var(--accent)">${esc(lvl.name)}</div>
        ${lvl.next ? `<div class="bar" style="margin-top:8px"><i style="width:${Math.round(lvl.progress * 100)}%"></i></div>
        <div class="muted small-text" style="margin-top:4px">${lvl.pointsToNext.toLocaleString()} pts to ${esc(lvl.next)}</div>`
        : '<div class="muted small-text" style="margin-top:8px">Top rank reached. 🎩</div>'}
      </div>
      <div class="panel">
        <div class="stat-label">Points</div>
        <div class="stat-big">★ ${s.points.toLocaleString()}</div>
        <div class="muted small-text" style="margin-top:8px">Today: ${money(s.today.revenue * 100)} · ${s.today.units} sold</div>
      </div>
      <div class="panel">
        <div class="stat-label">Monthly target</div>
        <div class="stat-big">${money(s.month.revenue * 100)}</div>
        <div class="bar green" style="margin-top:8px"><i style="width:${revPct}%"></i></div>
        <div class="muted small-text" style="margin-top:4px">of ${money(s.month.revenueTarget * 100)} · units ${s.month.units}/${s.month.unitsTarget}</div>
        <div class="bar blue" style="margin-top:4px"><i style="width:${unitPct}%"></i></div>
      </div>
      <div class="panel">
        <div class="stat-label">Budget ${overBudget ? '⚠' : ''}</div>
        <div class="stat-big" style="${overBudget ? 'color:var(--red)' : ''}">${money(s.month.spent * 100)}</div>
        <div class="bar ${overBudget ? 'red' : ''}" style="margin-top:8px"><i style="width:${budgetPct}%"></i></div>
        <div class="muted small-text" style="margin-top:4px">of ${money(s.month.budget * 100)} this month${overBudget ? ' — over budget!' : ''}</div>
      </div>
    </div>

    <div class="grid cols-2" style="align-items:start">
      <div>
        <div class="panel">
          <h2>🔥 Streaks</h2>
          <div class="row" style="gap:24px">
            <div><span class="streak-flame">🔥</span> <b>${s.streaks.dailyShip.count}</b> day ship streak <span class="muted small-text">(best ${s.streaks.dailyShip.best})</span></div>
            <div><span class="streak-flame">🎯</span> <b>${s.streaks.weeklyTarget.count}</b> week target streak <span class="muted small-text">(best ${s.streaks.weeklyTarget.best})</span></div>
          </div>
        </div>
        <div class="panel" id="challenges-panel"><h2>🗡 Challenges</h2></div>
      </div>
      <div class="panel">
        <h2>📜 Point log</h2>
        <div id="feed"></div>
      </div>
    </div>
  </div>`));

  // Challenges
  const cp = el.querySelector('#challenges-panel');
  const bySection = { daily: '☀️ Today', weekly: '📅 This week', season: '🎇 Season' };
  for (const scope of ['daily', 'weekly', 'season']) {
    const items = s.challenges.filter(c => c.scope === scope && (scope !== 'season' || c.active || c.past));
    if (!items.length) continue;
    cp.appendChild(h(`<div class="stat-label" style="margin-top:10px">${bySection[scope]}</div>`));
    for (const c of items) {
      const done = c.completed;
      let barHtml = '';
      if (c.scope === 'season' && c.season) {
        const rp = Math.min(100, (c.season.revenue.progress / (c.season.revenue.goal || 1)) * 100);
        const up = Math.min(100, (c.season.units.progress / (c.season.units.goal || 1)) * 100);
        barHtml = `<div class="muted small-text">$${c.season.revenue.progress.toFixed(0)} / $${c.season.revenue.goal} revenue</div>
          <div class="bar green"><i style="width:${rp}%"></i></div>
          <div class="muted small-text" style="margin-top:4px">${c.season.units.progress} / ${c.season.units.goal} pieces · runs ${esc(c.season.start)} → ${esc(c.season.end)}</div>
          <div class="bar blue"><i style="width:${up}%"></i></div>`;
      } else {
        const pct = done ? 100 : Math.min(100, (c.progress / (c.goal || 1)) * 100);
        barHtml = `<div class="bar ${done ? 'green' : ''}"><i style="width:${pct}%"></i></div>
          <div class="muted small-text" style="margin-top:3px">${esc(c.label || `${typeof c.progress === 'number' ? (Math.round(c.progress * 100) / 100) : c.progress} / ${c.goal}`)}</div>`;
      }
      cp.appendChild(h(`<div class="challenge ${done ? 'done' : ''}">
        <div class="c-head"><span class="c-name">${esc(c.name)}</span><span class="c-pts">+${c.points}</span></div>
        <div class="c-desc">${esc(c.desc || '')}</div>
        ${barHtml}
      </div>`));
    }
  }

  // Feed
  const feedEl = el.querySelector('#feed');
  feedEl.innerHTML = feed.length ? '' : '<div class="empty-state">No points yet. Ship something! 🚚</div>';
  for (const f of feed) {
    feedEl.appendChild(h(`<div class="feed-item">
      <span class="pts ${f.points >= 0 ? 'pos' : 'neg'}">${f.points >= 0 ? '+' : ''}${f.points}</span>
      <span>${esc(f.reason)}</span>
      <span class="when">${timeAgo(f.ts)}</span>
    </div>`));
  }

  // Quick forms
  el.querySelector('#btn-expense').onclick = () => quickForm(el, 'expense');
  el.querySelector('#btn-review').onclick = () => quickForm(el, 'review');
}

function quickForm(el, kind) {
  const holder = el.querySelector('#quick-forms');
  holder.innerHTML = '';
  if (kind === 'expense') {
    const f = h(`<div class="panel"><h2>Log an expense (counts against this month's budget)</h2>
      <div class="row">
        <input data-k="amount" type="number" step="0.01" placeholder="Amount $" style="width:120px">
        <select data-k="category" style="width:160px"><option>materials</option><option>tools</option><option>shipping supplies</option><option>fees</option><option>other</option></select>
        <input data-k="note" placeholder="What was it?">
        <button class="primary">Add</button><button data-x>✕</button>
      </div></div>`);
    f.querySelector('.primary').onclick = async () => {
      const amount = parseFloat(f.querySelector('[data-k=amount]').value || '0');
      await call('expenses.add', { amountCents: Math.round(amount * 100), category: f.querySelector('[data-k=category]').value, note: f.querySelector('[data-k=note]').value });
      toast('Expense logged', 'Budget gauge updated.');
      el.innerHTML = ''; render(el); refreshBadges();
    };
    f.querySelector('[data-x]').onclick = () => holder.innerHTML = '';
    holder.appendChild(f);
  } else {
    const f = h(`<div class="panel"><h2>Log a customer review</h2>
      <div class="row">
        <select data-k="positive" style="width:140px"><option value="1">⭐ Positive</option><option value="0">Neutral/negative</option></select>
        <input data-k="note" placeholder="Which item / what they said (optional)">
        <button class="primary">Record</button><button data-x>✕</button>
      </div></div>`);
    f.querySelector('.primary').onclick = async () => {
      await call('game.recordReview', { positive: f.querySelector('[data-k=positive]').value === '1', note: f.querySelector('[data-k=note]').value });
      el.innerHTML = ''; render(el); refreshBadges();
    };
    f.querySelector('[data-x]').onclick = () => holder.innerHTML = '';
    holder.appendChild(f);
  }
}
