// Tiny domain-event bus decoupling business modules from the gamification
// engine. Modules emit real business events; the game engine (stage 5)
// listens and scores them. Nothing here blocks business logic — a listener
// error is logged (without payload contents) and swallowed.
'use strict';

const listeners = new Map();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
}

function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { fn(payload); } catch (e) { console.error(`event listener for '${event}' failed: ${e.message}`); }
  }
}

module.exports = { on, emit };
