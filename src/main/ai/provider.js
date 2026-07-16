// Local AI provider — swappable backend, no hardcoded vendor.
//
// Talks to any OpenAI-compatible chat-completions endpoint. Ollama exposes
// one at http://localhost:11434/v1 (the default in config), LM Studio at
// http://localhost:1234/v1, llama.cpp's server too. Change config.ai.baseUrl
// and config.ai.model to swap models; nothing else in the app knows or cares
// which model runs. Runs 100% on this PC — no cloud required.
'use strict';

const config = require('../config');

async function detectModel(baseUrl) {
  const res = await fetch(baseUrl + '/models', { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`No model configured and ${baseUrl}/models returned ${res.status}`);
  const first = (await res.json()).data?.[0]?.id;
  if (!first) throw new Error('No model configured and the runner reports none loaded');
  return first;
}

async function chat(messages, { temperature = 0.4, maxTokens = 700 } = {}) {
  const ai = config.load().ai;
  const baseUrl = ai.baseUrl.replace(/\/$/, '');
  const model = ai.model || await detectModel(baseUrl); // auto-pick if unset
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens })
  }).catch((e) => { throw new Error(`Can't reach the local AI at ${ai.baseUrl} — is your model runner (Ollama/LM Studio) started? (${e.message})`); });
  if (!res.ok) throw new Error(`Local AI returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error('Local AI returned an empty response');
  return text;
}

async function available() {
  try {
    const ai = config.load().ai;
    const res = await fetch(ai.baseUrl.replace(/\/$/, '') + '/models', { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch { return false; }
}

module.exports = { chat, available };
