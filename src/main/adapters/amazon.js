// Amazon adapter — honest stub, planned for build stage 7.
//
// Amazon's Selling Partner API (SP-API) is real and official, but heavyweight:
// it requires a Professional seller account ($39.99/mo), registering as a
// developer, app approval, and AWS-signed requests. Rather than fake it, this
// stub reports 'not_connected' with an explanation until the real adapter
// lands. It already implements the common interface, so the core app treats
// it exactly like every other channel.
'use strict';

const { ChannelAdapter } = require('./base');

class AmazonAdapter extends ChannelAdapter {
  constructor() {
    super();
    this.id = 'amazon';
    this.displayName = 'Amazon';
    this.kind = 'api';
    this.capabilities = { connect: false, messages: false, orders: false, publish: false, reply: false };
  }

  async getStatus() {
    return {
      status: 'not_connected',
      detail: 'Adapter planned (Selling Partner API). Requires a Professional seller account and SP-API app approval. Coming in a later build stage — nothing is faked in the meantime.'
    };
  }
}

module.exports = { AmazonAdapter };
