// Resolves where the app keeps its local data (SQLite DB, config.json, secret store).
// Under Electron this is the per-user app-data folder; under plain Node (tests,
// scripts/check.js) it can be overridden with SHOP_DATA_DIR.
'use strict';

const path = require('path');
const fs = require('fs');

let cachedDir = null;

function dataDir() {
  if (cachedDir) return cachedDir;
  if (process.env.SHOP_DATA_DIR) {
    cachedDir = process.env.SHOP_DATA_DIR;
  } else {
    try {
      const { app } = require('electron');
      cachedDir = path.join(app.getPath('userData'), 'shop-data');
    } catch {
      cachedDir = path.join(process.cwd(), 'data');
    }
  }
  fs.mkdirSync(cachedDir, { recursive: true });
  return cachedDir;
}

module.exports = { dataDir };
