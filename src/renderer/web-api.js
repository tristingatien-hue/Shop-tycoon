// Browser shim for the mobile companion. Inside Electron the preload script
// exposes window.api first, so this whole file is inert on the desktop.
// In a phone browser it provides the same window.api surface over HTTP:
// RPC via fetch('/rpc'), live events via SSE ('/events'), clipboard via
// the browser (with a fallback, since plain-http LAN pages can't always
// use navigator.clipboard).
if (!window.api) {
  const handlers = [];

  window.api = {
    call: async (method, params) => {
      let res;
      try {
        res = await fetch('/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, params })
        });
      } catch {
        return { error: 'Lost connection to the app on your PC.' };
      }
      if (res.status === 401) { location.href = '/pair'; return { error: 'Not paired' }; }
      return res.json();
    },

    copyToClipboard: async (text) => {
      try {
        await navigator.clipboard.writeText(String(text));
      } catch {
        const ta = document.createElement('textarea');
        ta.value = String(text);
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    },

    onEvent: (handler) => handlers.push(handler)
  };

  // EventSource reconnects on its own if the desktop app restarts.
  const es = new EventSource('/events');
  es.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data);
      for (const h of handlers) h(payload);
    } catch { /* keep-alive comments etc. */ }
  };
}
