// Pairing page logic: POST the PIN, get the session cookie, enter the app.
const pinEl = document.getElementById('pin');
const goEl = document.getElementById('go');
const errEl = document.getElementById('err');

async function pair() {
  errEl.textContent = '';
  goEl.disabled = true;
  try {
    const res = await fetch('/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinEl.value.trim() })
    });
    const data = await res.json();
    if (data.ok) { location.href = '/'; return; }
    errEl.textContent = data.error || 'Pairing failed.';
  } catch {
    errEl.textContent = 'Could not reach the app — is it still running on your PC?';
  }
  goEl.disabled = false;
}

goEl.onclick = pair;
pinEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') pair(); });
pinEl.addEventListener('input', () => { pinEl.value = pinEl.value.replace(/\D/g, '').slice(0, 6); });
