// App configuration: a single editable config.json in the data directory,
// deep-merged over the defaults below so new settings appear automatically
// after upgrades. Everything the gamification system and AI use is tunable here,
// and the Settings screen edits this same file.
'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

const DEFAULTS = {
  shopName: 'My Woodworking Shop',
  currency: 'USD',

  // Local AI backend — swappable. Any OpenAI-compatible endpoint works:
  // DeepSeek via Ollama → http://localhost:11434/v1 (model e.g. 'deepseek-r1:8b')
  // DeepSeek via LM Studio → http://localhost:1234/v1
  // Leave model empty to auto-use whatever the runner has loaded.
  ai: {
    enabled: false,               // flip on in Settings once your model runner is up
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    autoSendFaqReplies: false     // hard default: AI drafts, you approve
  },

  // How often connected channels are polled for new messages/orders (minutes).
  syncIntervalMinutes: 10,

  game: {
    // Points for real business wins. Tune freely.
    points: {
      saleBase: 100,               // per completed sale…
      saleMarginScale: true,       // …scaled by margin vs target margin
      targetMarginPct: 40,         // margin that earns the full saleBase
      shipOnTimeBonus: 120,
      shipLatePenalty: -80,
      fastReplyBonus: 25,          // reply within fastReplyMinutes
      fastReplyMinutes: 120,
      replyBase: 10,               // any reply to a customer message
      threadResolvedBonus: 15,
      positiveReviewBonus: 150,
      listingPublishedBonus: 20,
      monthlyBudgetBonus: 500,     // month closed under budget
      monthlyRevenueTargetBonus: 1000,
      monthlyUnitsTargetBonus: 600
    },
    // Levels are named ranks; you level up at each cumulative point threshold.
    levels: [
      { at: 0, name: 'Sawdust Apprentice' },
      { at: 500, name: 'Weekend Whittler' },
      { at: 1500, name: 'Journeyman Joiner' },
      { at: 3500, name: 'Workshop Regular' },
      { at: 7000, name: 'Master Carver' },
      { at: 12000, name: 'Market Favorite' },
      { at: 20000, name: 'Lumber Baron' },
      { at: 35000, name: 'Shop Tycoon' }
    ],
    targets: {
      monthlyRevenue: 1500,        // in shop currency
      monthlyUnits: 12,
      weeklyRevenue: 385,
      weeklyUnits: 3,
      monthlyBudget: 400           // material/expense budget
    },
    streaks: {
      dailyShipStreakBonus: 30,    // per day, each consecutive day with a shipment
      weeklyTargetStreakBonus: 200 // per consecutive week hitting weekly revenue target
    },
    // Video-game style challenges. Daily/weekly ones reset automatically.
    // metric options: replies_all_within_minutes, orders_all_shipped,
    // listings_published, units_sold, revenue, late_shipments_max
    challenges: {
      daily: [
        { id: 'daily-inbox-zero', name: 'Lightning Replies', metric: 'replies_all_within_minutes', value: 120, points: 60, desc: 'Reply to every new message within 2 hours' },
        { id: 'daily-ship-all', name: 'Clear the Bench', metric: 'orders_all_shipped', points: 80, desc: 'Ship every pending order today' },
        { id: 'daily-list-3', name: 'Fresh Stock', metric: 'listings_published', value: 3, points: 50, desc: 'List 3 new items' }
      ],
      weekly: [
        { id: 'weekly-units', name: 'Dozen Deals', metric: 'units_sold', value: 12, points: 300, desc: 'Sell 12 items this week' },
        { id: 'weekly-revenue', name: 'Register Ringer', metric: 'revenue', value: 385, points: 350, desc: 'Hit $385 revenue this week' },
        { id: 'weekly-no-late', name: 'Clockwork Shipper', metric: 'late_shipments_max', value: 0, points: 250, desc: 'Zero late shipments this week' }
      ],
      // Seasons: longer arcs with start/end dates and big payouts. Add your own.
      seasons: [
        {
          id: 'christmas-market', name: 'Christmas Market', theme: '🎄 Holiday rush',
          start: '2026-11-15', end: '2026-12-24',
          targets: { revenue: 3000, units: 30 },
          points: 2500,
          bonusPerSale: 20
        }
      ]
    }
  },

  channels: {
    ebay: {
      env: 'production',           // 'sandbox' while testing your developer keys
      marketplaceId: 'EBAY_US',
      siteId: 0,
      // Fill these from your eBay developer account (see docs/SETUP-EBAY.md).
      clientId: '',
      ruName: '',
      // Business policy IDs + inventory location needed to publish listings.
      fulfillmentPolicyId: '',
      paymentPolicyId: '',
      returnPolicyId: '',
      merchantLocationKey: '',
      defaultCategoryId: ''
    },
    facebook: {
      note: 'Manual-assist only. Facebook Marketplace has no official listing API for individual sellers; automation risks account bans, so this app formats content for you to copy/paste.'
    },
    amazon: { env: 'production' },
    walmart: { env: 'production' }
  }
};

const FILE = () => path.join(dataDir(), 'config.json');

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override) || typeof base !== 'object' || base === null) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const k of Object.keys(override || {})) {
    out[k] = k in base ? deepMerge(base[k], override[k]) : override[k];
  }
  return out;
}

let cached = null;

function load() {
  if (cached) return cached;
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
  } catch { /* first run: file doesn't exist yet */ }
  cached = deepMerge(DEFAULTS, user);
  return cached;
}

function save(partial) {
  cached = deepMerge(load(), partial);
  fs.writeFileSync(FILE(), JSON.stringify(cached, null, 2));
  return cached;
}

function reset() { cached = null; }

module.exports = { load, save, reset, DEFAULTS };
