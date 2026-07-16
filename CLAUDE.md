# Shop Tycoon Console

Electron desktop selling console for a solo woodworking business — listings,
messages, and orders from every marketplace in one local app, gamified like a
tycoon game. `README.md` has the feature map and stage history; channel setup
guides live in `docs/`.

Ground rules:

- Everything runs locally: local SQLite database, local config, local AI
  backend. Never add a required paid cloud service.
- Runtime data lives in `data/` (or the Electron userData dir) and is
  gitignored — never commit databases, `secrets.key`, or anything from it.
- Facebook Marketplace stays manual-assist only (no headless-browser
  automation — it violates Meta's ToS and gets accounts banned).
- `node scripts/check.js` is the sanity check to run after changes.
