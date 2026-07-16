// Unified inbox: all channels in one place. Reply routes through the
// channel's adapter; manual channels put the reply on your clipboard.
import { call, h, esc, timeAgo, toast, copyOut, refreshBadges } from '../app.js';

let filter = '';
let currentThread = null;

export async function render(el) {
  el.appendChild(h(`<div>
    <div class="row spread">
      <div>
        <h1 class="page-title">💬 Inbox</h1>
        <div class="page-sub">Every marketplace, one inbox. Replies go out through each channel's own door.</div>
      </div>
      <div class="row">
        <button id="btn-new-manual" class="small">+ Log a Facebook message</button>
        <button id="btn-sync" class="small">↻ Sync now</button>
      </div>
    </div>
    <div class="tabs" id="channel-tabs"></div>
    <div class="inbox-layout">
      <div class="panel thread-list" id="thread-list"></div>
      <div class="panel msg-pane" id="msg-pane"><div class="empty-state">Pick a conversation</div></div>
    </div>
  </div>`));

  el.querySelector('#btn-sync').onclick = async () => { await call('sync.now'); await drawThreads(); toast('Sync', 'Done.'); };
  el.querySelector('#btn-new-manual').onclick = () => manualThreadDialog(el);

  await drawTabs(el);
  await drawThreads();
}

async function drawTabs(el) {
  const channels = await call('channels.list');
  const tabs = el.querySelector('#channel-tabs');
  tabs.innerHTML = '';
  const mk = (id, label) => {
    const t = h(`<div class="tab ${filter === id ? 'active' : ''}">${esc(label)}</div>`);
    t.onclick = () => { filter = id; drawTabs(el); drawThreads(); };
    tabs.appendChild(t);
  };
  mk('', 'All channels');
  for (const c of channels) mk(c.id, c.display_name);
}

async function drawThreads() {
  const list = document.getElementById('thread-list');
  if (!list) return;
  const threads = await call('inbox.threads', filter ? { channel: filter } : {});
  list.innerHTML = threads.length ? '' : '<div class="empty-state">No messages yet.<br>Connected channels sync automatically;<br>Facebook messages are logged manually.</div>';
  for (const t of threads) {
    const item = h(`<div class="thread-item ${t.unread ? 'unread' : ''} ${currentThread === t.id ? 'active' : ''}">
      <div class="row spread">
        <span class="who">${esc(t.counterpart || t.subject)}</span>
        <span class="muted small-text">${timeAgo(t.last_message_at)}</span>
      </div>
      <div class="row spread">
        <span class="prev">${esc((t.preview || '').slice(0, 60))}</span>
        <span class="pill ${t.channel_kind === 'manual' ? 'blue' : 'amber'}" style="flex-shrink:0">${esc(t.channel_name)}</span>
      </div>
    </div>`);
    item.onclick = () => openThread(t.id);
    list.appendChild(item);
  }
}

async function openThread(threadId) {
  currentThread = threadId;
  const pane = document.getElementById('msg-pane');
  const { thread, messages } = await call('inbox.messages', { threadId });
  await call('inbox.markRead', { threadId });
  refreshBadges();
  drawThreads();

  const isManual = thread.channel_kind === 'manual';
  pane.innerHTML = '';
  pane.appendChild(h(`<div class="row spread" style="padding-bottom:10px;border-bottom:1px solid var(--border)">
    <div>
      <b>${esc(thread.counterpart)}</b> <span class="pill ${isManual ? 'blue' : 'amber'}">${esc(thread.channel_name)}</span>
      ${thread.listing_ref ? `<span class="muted small-text"> · listing ${esc(thread.listing_ref)}</span>` : ''}
      <div class="muted small-text">${esc(thread.subject || '')}</div>
    </div>
    <div class="row">
      ${isManual ? '<button class="small" data-add-incoming>+ Their message</button>' : ''}
      <button class="small" data-resolve>${thread.status === 'resolved' ? 'Resolved ✔' : 'Mark resolved'}</button>
    </div>
  </div>`));

  const scroll = h('<div class="msg-scroll"></div>');
  for (const m of messages) {
    scroll.appendChild(h(`<div class="msg ${m.direction === 'out' ? 'out' : ''} ${m.status === 'draft' ? 'draft' : ''}">${esc(m.body)}
      <div class="msg-meta">${m.direction === 'out' ? 'you' : esc(m.sender)} · ${timeAgo(m.sent_at || m.created_at)}${m.status === 'exported' ? ' · copied out ↗' : ''}</div>
    </div>`));
  }
  pane.appendChild(scroll);
  scroll.scrollTop = scroll.scrollHeight;

  const composer = h(`<div style="padding-top:10px">
    <textarea placeholder="Write your reply…"></textarea>
    <div class="row spread" style="margin-top:8px">
      <span class="muted small-text">${isManual
        ? 'Manual channel: your reply is copied to the clipboard to paste into Messenger.'
        : 'Sends through the channel’s official API.'}</span>
      <button class="primary">${isManual ? '📋 Copy reply out' : 'Send reply'}</button>
    </div>
  </div>`);
  composer.querySelector('button').onclick = async () => {
    const body = composer.querySelector('textarea').value;
    try {
      const res = await call('inbox.reply', { threadId, body });
      if (res.exported) copyOut(res.exported, 'Reply copied — paste it into Facebook');
      else toast('Sent', 'Reply delivered via ' + thread.channel_name);
      openThread(threadId);
    } catch { /* toasted by call(); if eBay can't reply, user copies manually */ }
  };
  pane.appendChild(composer);

  pane.querySelector('[data-resolve]').onclick = async () => {
    await call('inbox.resolve', { threadId });
    toast('Thread resolved', 'Nice — resolved threads score points once the game engine is on.');
    openThread(threadId);
  };
  const addIncoming = pane.querySelector('[data-add-incoming]');
  if (addIncoming) addIncoming.onclick = async () => {
    const body = prompt(`Paste what ${thread.counterpart} wrote:`);
    if (body) { await call('inbox.manualIncoming', { threadId, body }); openThread(threadId); drawThreads(); }
  };
}

function manualThreadDialog(el) {
  const pane = document.getElementById('msg-pane');
  pane.innerHTML = '';
  const form = h(`<div>
    <h2 style="margin-bottom:10px">Log a Facebook conversation</h2>
    <p class="muted small-text" style="margin-bottom:12px">Paste what the buyer sent you on Messenger. It becomes a normal inbox thread: you get reply drafting, tracking, and points, and your replies are copied back out to paste.</p>
    <label class="field"><span class="lbl">Buyer name</span><input data-k="counterpart"></label>
    <label class="field"><span class="lbl">About which item? (optional)</span><input data-k="listingRef"></label>
    <label class="field"><span class="lbl">Their message</span><textarea data-k="body"></textarea></label>
    <button class="primary">Add to inbox</button>
  </div>`);
  form.querySelector('button').onclick = async () => {
    const vals = {};
    form.querySelectorAll('[data-k]').forEach(i => vals[i.dataset.k] = i.value);
    const res = await call('inbox.manualThread', vals);
    await drawThreads();
    openThread(res.threadId);
  };
  pane.appendChild(form);
}
