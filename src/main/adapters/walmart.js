// Walmart adapter — honest stub, planned after Amazon.
//
// Walmart's Marketplace API is official but requires an approved Walmart
// Marketplace seller account (application + review). This stub reports
// 'not_connected' with an explanation until the real adapter lands.
'use strict';

const { ChannelAdapter } = require('./base');

class WalmartAdapter extends ChannelAdapter {
  constructor() {
    super();
    this.id = 'walmart';
    this.displayName = 'Walmart Marketplace';
    this.kind = 'api';
    this.capabilities = { connect: false, messages: false, orders: false, publish: false, reply: false };
  }

  async getStatus() {
    return {
      status: 'not_connected',
      detail: 'Adapter planned (Walmart Marketplace API). Requires an approved Walmart Marketplace seller account. Coming in a later build stage.'
    };
  }
}

module.exports = { WalmartAdapter };
