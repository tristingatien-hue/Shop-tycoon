// Single RPC registry bridging the renderer to main-process modules.
// The renderer calls window.api.call('method.name', params); every method
// lives here or is registered by a feature module. Errors return as
// { error: message } so the UI can surface them instead of crashing.
'use strict';

const methods = new Map();

function register(name, fn) {
  if (methods.has(name)) throw new Error(`RPC method already registered: ${name}`);
  methods.set(name, fn);
}

async function dispatch(name, params) {
  const fn = methods.get(name);
  if (!fn) return { error: `Unknown RPC method: ${name}` };
  try {
    const result = await fn(params || {});
    return { result: result === undefined ? null : result };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

module.exports = { register, dispatch };
