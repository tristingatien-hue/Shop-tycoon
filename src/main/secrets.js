// Encrypted-at-rest secret store for OAuth tokens and API credentials.
//
// Under Electron we use safeStorage, which on Windows is backed by DPAPI
// (your Windows login protects the key). Under plain Node (tests) we fall
// back to AES-256-GCM with a key file next to the DB, permission-restricted.
// Secrets are never written in plaintext and never logged.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');
const { get: getDb } = require('./db');

let safeStorage = null;
try {
  safeStorage = require('electron').safeStorage;
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) safeStorage = null;
} catch { /* plain Node */ }

function fallbackKey() {
  const keyFile = path.join(dataDir(), 'secrets.key');
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600 });
  }
  return fs.readFileSync(keyFile);
}

function encrypt(plaintext) {
  if (safeStorage) return Buffer.concat([Buffer.from('SS1:'), safeStorage.encryptString(plaintext)]);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', fallbackKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('GC1:'), iv, cipher.getAuthTag(), enc]);
}

function decrypt(blob) {
  const buf = Buffer.from(blob);
  const tag4 = buf.subarray(0, 4).toString();
  const rest = buf.subarray(4);
  if (tag4 === 'SS1:') {
    if (!safeStorage) throw new Error('Secret was stored via OS keychain; open the app normally to read it.');
    return safeStorage.decryptString(rest);
  }
  if (tag4 === 'GC1:') {
    const iv = rest.subarray(0, 12);
    const authTag = rest.subarray(12, 28);
    const enc = rest.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', fallbackKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
  throw new Error('Unknown secret format');
}

function set(key, value) {
  getDb().prepare('INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, encrypt(String(value)));
}

function getSecret(key) {
  const row = getDb().prepare('SELECT value FROM secrets WHERE key = ?').get(key);
  return row ? decrypt(row.value) : null;
}

function remove(key) {
  getDb().prepare('DELETE FROM secrets WHERE key = ?').run(key);
}

function has(key) {
  return !!getDb().prepare('SELECT 1 FROM secrets WHERE key = ?').get(key);
}

module.exports = { set, get: getSecret, remove, has };
