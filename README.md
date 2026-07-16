# 🪵 Shop Tycoon Console

A desktop selling console for a solo woodworking business. One app on your own
PC that pulls every marketplace into one place — listings, messages, orders —
and makes running the shop feel like playing a tycoon game. Everything runs
locally: local database, local config, and (in stage 6) a local AI model.
**No paid cloud services required to function.**

## What's built and working (stages 1–6)

| Screen | What it does |
|---|---|
| 🏆 **Dashboard** | Points, rank, daily/weekly/seasonal challenges with progress bars, streaks, budget gauge, monthly target bars, running point log |
| 💬 **Inbox** | Every channel's messages in one place, unread counts, channel filter, reply from the app (API channels send; Facebook replies are copied out) |
| 🤖 **Assistant** | Local-AI inbox triage (summary + urgency + drafted reply per thread), approval queue (accept/edit/reject in one click), listing copy drafting, price ranges from your cost + margin, target coaching |
| 🪚 **Products & Listings** | Enter a product once; per-channel editable templates render it for eBay / Amazon / Walmart / Facebook with real character limits and live preview; publish or export |
| 📦 **Orders** | One pipeline across channels: new → packed → shipped → done, ship-by warnings, manual entry for Facebook sales, material cost per order |
| 🔌 **Channels** | Connect eBay via OAuth, health indicators, eBay listing setup helper, honest "not yet connected" stubs for Amazon/Walmart |
| ⚙️ **Settings** | Tune every point value, target, and budget; pick your local AI backend |

## Channel reality check (read before connecting)

- **eBay** — fully wired via official Sell APIs. You need a free eBay developer
  account: follow **[docs/SETUP-EBAY.md](docs/SETUP-EBAY.md)** step by step.
- **Facebook Marketplace** — **manual-assist only, by design.** Facebook has no
  official listing API for individual sellers, and tools that fake it with
  hidden browsers violate Meta's ToS and get accounts banned. This app drafts
  and formats listings/replies for you to copy/paste, and manual sales still
  count toward your points and targets.
- **Amazon (SP-API)** and **Walmart Marketplace** — official APIs exist and the
  adapter slots are ready, but they require paid/approved seller accounts.
  They currently show as *not connected* rather than pretending to work.
- Adding a future channel (Etsy, Shopify, Kijiji…) = one new adapter file in
  `src/main/adapters/` implementing the common interface. Zero core changes.

## Install on Windows 11

1. Install **Node.js LTS** from <https://nodejs.org> (accept the defaults).
2. Download this repository (green **Code** button → *Download ZIP*) and unzip
   it somewhere permanent, e.g. `C:\ShopTycoon`.
3. Open the folder, click the address bar, type `cmd`, press Enter, then run:

   ```
   npm install
   npm start
   ```

That's it — the app window opens. To make a double-clickable installer later,
`npm run dist` builds a Windows installer (requires the `electron-builder`
dev dependency; add it when you want packaging).

Your data (database, config, encrypted tokens) lives in
`%APPDATA%\shop-tycoon-console\shop-data\` — back that folder up and you've
backed up the business.

## Verify the core anytime

```
npm run check
```

runs 54 self-tests over the database, adapters, templates, inbox, orders, and
game engine without touching your real data.

## Security posture

- OAuth tokens and API secrets are encrypted at rest via Windows DPAPI
  (Electron `safeStorage`); nothing secret is ever logged or stored plaintext.
- The renderer is sandboxed (context isolation, CSP, no node integration);
  external links open in your browser, never inside the app.
- No telemetry. Nothing leaves your PC except calls to marketplaces you
  connected.

## The game (and why it can't be cheated)

Points come **only** from real business events: completed sales (scaled by
margin), on-time shipments, fast replies, resolved threads, reviews, staying
under budget, hitting targets. Challenges verify against real rows — "zero
late shipments" requires actual shipments; "inbox zero" requires real
messages. When the AI assistant lands in stage 6 it optimizes those same
points, so its best strategy is identical to yours: do good, honest work.
Everything is tunable in Settings (or `config.json`).

## Setting up the AI (DeepSeek or any local model)

The assistant talks to any OpenAI-compatible local endpoint. With **DeepSeek
already on your PC**:

- **Via Ollama**: make sure it's running (`ollama serve`, usually automatic)
  and you have a DeepSeek model pulled (e.g. `ollama pull deepseek-r1:8b`).
  Endpoint: `http://localhost:11434/v1`.
- **Via LM Studio**: start the local server (Developer tab → Start Server).
  Endpoint: `http://localhost:1234/v1`.

Then in the app: **Settings → Local AI assistant → Test connection** (it lists
your models), pick one or leave blank for auto, set Enabled → On, Save. The
`<think>` reasoning that DeepSeek-R1 models produce is stripped automatically
so it can never leak into a customer reply.

**Guardrails are code, not vibes:** the AI's only write path is the approval
queue — the send action is your click, drafts are grounded in the product
facts you entered, price suggestions are pure math off your cost and target
margin, and manual channels (Facebook) can only ever export text.

## Roadmap

7. **Amazon SP-API adapter**, then **Walmart**, then seasonal polish and an
   optional auto-send-for-FAQs toggle (off by default).

## Project layout

```
src/main/            Electron main process (all business logic)
  adapters/          one file per marketplace behind a common interface
  core/              db-backed modules: inbox, orders, products, listings,
                     templates, game engine, sync, event bus
  ai/                swappable local-model provider + assistant scaffold
src/renderer/        the UI (plain HTML/CSS/JS modules, no build step)
scripts/check.js     self-tests (npm run check)
docs/                per-channel setup guides
```
