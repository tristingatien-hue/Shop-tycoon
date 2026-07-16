// Facebook Marketplace adapter — 'manual' kind.
//
// ⚠️ Facebook Marketplace has NO official third-party API for individual
// sellers, and automating it (hidden browsers, scrapers, session hijacking)
// violates Meta's ToS and risks the owner's personal account. So this adapter
// implements the SAME interface as API channels, but every outbound action
// returns { exported: text } for the owner to copy/paste themselves.
// Incoming messages and sales are entered manually from the Inbox/Orders
// screens, then flow through the exact same pipeline as API channels.
'use strict';

const { ChannelAdapter } = require('./base');

class FacebookManualAdapter extends ChannelAdapter {
  constructor() {
    super();
    this.id = 'facebook';
    this.displayName = 'Facebook Marketplace';
    this.kind = 'manual';
    this.capabilities = { connect: false, messages: true, orders: true, publish: true, reply: true };
  }

  async getStatus() {
    return {
      status: 'manual',
      detail: 'Manual-assist channel. Facebook offers no official listing API for individual sellers, and covert automation risks an account ban — so the app drafts and formats everything, and you copy/paste it into Facebook yourself.'
    };
  }

  // Reply = hand the drafted text back for copy/paste into Messenger.
  async sendReply(_thread, body) {
    return { exported: body };
  }

  // Publish = hand the fully formatted listing back for copy/paste.
  async publishListing(_product, rendered) {
    const parts = [
      rendered.title,
      '',
      rendered.price ? `Price: ${rendered.price}` : '',
      '',
      rendered.description,
      '',
      rendered.tags || ''
    ].filter((p, i, a) => p !== '' || a[i - 1] !== '');
    return { exported: parts.join('\n') };
  }

  // Messages/orders arrive by manual entry in the UI, not by polling.
  async syncMessages() { return []; }
  async syncOrders() { return []; }
}

module.exports = { FacebookManualAdapter };
