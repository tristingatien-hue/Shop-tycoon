// ChannelAdapter — the one interface every marketplace plugs in behind.
//
// The core app only ever talks to this interface. Adding a new channel
// (Etsy, Shopify, Kijiji…) means writing one new adapter file that extends
// ChannelAdapter and registering it in adapters/index.js — zero changes to
// the core app.
//
// Two kinds of adapter:
//   kind 'api'    — a marketplace with an official API (eBay, Amazon, Walmart).
//                   connect via OAuth/keys; sync/reply/publish call real APIs.
//   kind 'manual' — a marketplace with NO official API for individual sellers
//                   (Facebook Marketplace). Same interface, but reply/publish
//                   return { exported: text } for the owner to copy/paste,
//                   and never touch the platform directly. No hidden browser
//                   automation, ever — that risks account bans and violates ToS.
//
// Normalized shapes every adapter must produce:
//   Thread:  { externalThreadId, subject, counterpart, listingRef, orderRef,
//              messages: [Message] }
//   Message: { externalId, direction: 'in'|'out', sender, body, sentAt(ISO) }
//   Order:   { externalId, buyer, itemSummary, quantity, totalCents,
//              currency, orderDate(ISO), shipBy(ISO|null), meta }
'use strict';

class ChannelAdapter {
  constructor() {
    /** @type {string} stable id, matches channels.id in the DB */
    this.id = 'base';
    this.displayName = 'Base';
    /** @type {'api'|'manual'} */
    this.kind = 'api';
    // What this adapter can actually do. The UI reads this to show/hide actions.
    this.capabilities = { connect: false, messages: false, orders: false, publish: false, reply: false };
  }

  /** Current health: { status: not_connected|connected|expired|error|manual, detail } */
  async getStatus() { return { status: 'not_connected', detail: '' }; }

  /**
   * Step 1 of connecting. Returns instructions for the UI:
   * { authUrl?, fields?: [{key,label,secret?}], instructions: string }
   */
  async beginConnect() { throw new Error(`${this.displayName}: connect not supported`); }

  /** Step 2: complete with whatever beginConnect asked for (e.g. { code }). */
  async completeConnect(_params) { throw new Error(`${this.displayName}: connect not supported`); }

  async disconnect() { /* default: nothing to do */ }

  /** Pull new/updated message threads. @returns {Promise<Thread[]>} */
  async syncMessages() { return []; }

  /** Pull new/updated orders. @returns {Promise<Order[]>} */
  async syncOrders() { return []; }

  /**
   * Send a reply on a thread.
   * @returns {Promise<{sent: true} | {exported: string}>}
   *   {sent} for API channels; {exported} hands the text back for copy/paste.
   */
  async sendReply(_thread, _body) { throw new Error(`${this.displayName}: replying not supported`); }

  /**
   * Publish a rendered listing.
   * @param {object} product   row from the products table
   * @param {object} rendered  channel-formatted fields from the template engine
   * @returns {Promise<{externalId: string} | {exported: string}>}
   */
  async publishListing(_product, _rendered) { throw new Error(`${this.displayName}: publishing not supported`); }
}

module.exports = { ChannelAdapter };
