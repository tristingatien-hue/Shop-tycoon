// AI Assistant screen: triage the inbox, review the approval queue
// (accept / edit / reject), and get target coaching. Every outbound action
// requires your click — the AI only ever drafts.
import { call, h, esc, toast, copyOut, refreshBadges } from '../app.js';

export async function render(el) {
  const status = await call('ai.status');
  el.appendChild(h(`<div>
    <div class="row spread">
      <div>
        <h1 class="page-title">🤖 Assistant</h1>
        <div class="page-sub">Drafts, triage, and coaching from your local model. Nothing sends without your approval.</div>
      </div>
      <div class="row">
        <button id="btn-triage" class="primary small" ${status.enabled ? '' : 'disabled'}>📥 Triage inbox now</button>
        <button id="btn-coach" class="small" ${status.enabled ? '' : 'disabled'}>🎯 Coach me</button>
      </div>
    </div>

    ${status.enabled
      ? `<div class="info-box">Backend: <span class="mono">${esc(status.backend.baseUrl)}</span> · model <span class="mono">${esc(status.backend.model || 'auto-detect')}</span> · ${status.backend.reachable ? '<span class="pill green">reachable</span>' : '<span class="pill red">not responding</span> — start your model runner (Ollama / LM Studio)'}</div>`
      : `<div class="warn-box">The assistant is <b>off</b>. Turn it on in <b>Settings → Local AI assistant</b> once your DeepSeek runner is up. The approval queue below still works.</div>`}

    <div id="coach-box"></div>
    <div class="panel"><h2>✅ Approval queue</h2>
      <p class="muted small-text" style="margin-bottom:10px">Everything the AI proposes lands here. Approve sends it through the channel's normal pipeline (or copies it out for manual channels). Edit freely before approving — it's your voice.</p>
      <div id="approvals"></div>
    </div>
  </div>`));

  el.querySelector('#btn-triage').onclick = async () => {
    toast('Triage', 'Reading unanswered threads… (local model, may take a minute)');
    const res = await call('ai.triageInbox');
    toast('Triage done', res.queued ? `${res.queued} draft repl${res.queued > 1 ? 'ies' : 'y'} queued for your approval.` : 'Nothing needs a reply right now.');
    const errs = res.results.filter(r => r.error);
    if (errs.length) toast('Some threads failed', errs.map(e => `${e.counterpart}: ${e.error}`).join(' · '));
    drawQueue(); refreshBadges();
  };

  el.querySelector('#btn-coach').onclick = async () => {
    const box = el.querySelector('#coach-box');
    box.innerHTML = '<div class="panel"><div class="empty-state">Thinking…</div></div>';
    try {
      const res = await call('ai.coach');
      box.innerHTML = '';
      box.appendChild(h(`<div class="panel"><h2>🎯 Coach</h2><div style="white-space:pre-wrap">${esc(res.advice)}</div></div>`));
    } catch { box.innerHTML = ''; }
  };

  await drawQueue();
}

async function drawQueue() {
  const holder = document.getElementById('approvals');
  if (!holder) return;
  const items = await call('approvals.list');
  holder.innerHTML = items.length ? '' : '<div class="empty-state">Queue is clear. Run a triage to fill it.</div>';
  for (const item of items) {
    const p = item.payload;
    const card = h(`<div class="challenge">
      <div class="c-head">
        <span class="c-name">${p.urgent ? '🚨 ' : ''}Reply to ${esc(p.counterpart)} <span class="pill ${p.channelKind === 'manual' ? 'blue' : 'amber'}">${esc(p.channel)}</span></span>
        <span class="muted small-text">${esc(item.created_at)}</span>
      </div>
      <div class="c-desc">${esc(p.summary || '')}</div>
      <textarea rows="4">${esc(p.draft)}</textarea>
      <div class="row" style="margin-top:8px">
        <button class="primary small" data-approve>${p.channelKind === 'manual' ? '👍 Approve & copy out' : '👍 Approve & send'}</button>
        <button class="small danger" data-reject>👎 Reject</button>
      </div>
    </div>`);
    card.querySelector('[data-approve]').onclick = async () => {
      try {
        const res = await call('approvals.approve', { id: item.id, editedDraft: card.querySelector('textarea').value });
        if (res.exported) copyOut(res.exported, 'Approved — reply copied for Facebook');
        else toast('Sent', `Reply delivered to ${p.counterpart}.`);
        drawQueue(); refreshBadges();
      } catch { /* error toasted; queue item stays for retry */ }
    };
    card.querySelector('[data-reject]').onclick = async () => {
      await call('approvals.reject', { id: item.id });
      drawQueue(); refreshBadges();
    };
    holder.appendChild(card);
  }
}
