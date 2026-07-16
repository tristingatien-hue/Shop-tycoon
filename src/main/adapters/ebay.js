// eBay adapter — the reference 'api' adapter.
//
// Uses eBay's official Sell APIs (developer.ebay.com):
//   - OAuth2 authorization-code flow for the user token
//   - Sell Fulfillment API  → orders
//   - Sell Inventory API    → publishing listings
//   - Trading API GetMyMessages / AddMemberMessageRTQ → buyer messages
//     (messages have no modern REST equivalent; the Trading API accepts the
//      same OAuth token via the X-EBAY-API-IAF-TOKEN header)
//
// Setup steps for the owner are in docs/SETUP-EBAY.md. Non-secret settings
// (client id, RuName, policy ids) live in config.json / the Channels screen;
// the client secret and tokens live in the encrypted secret store only.
'use strict';

const { XMLParser } = require('fast-xml-parser');
const { ChannelAdapter } = require('./base');
const config = require('../config');
const secrets = require('../secrets');

const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.account'
].join(' ');

function hosts(env) {
  const sandbox = env === 'sandbox';
  return {
    auth: sandbox ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com',
    api: sandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com'
  };
}

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false });

class EbayAdapter extends ChannelAdapter {
  constructor() {
    super();
    this.id = 'ebay';
    this.displayName = 'eBay';
    this.kind = 'api';
    this.capabilities = { connect: true, messages: true, orders: true, publish: true, reply: true };
  }

  cfg() { return config.load().channels.ebay; }

  async getStatus() {
    if (!secrets.has('ebay.refresh_token')) {
      const ready = this.cfg().clientId && secrets.has('ebay.client_secret') && this.cfg().ruName;
      return {
        status: 'not_connected',
        detail: ready ? 'Credentials saved — click Connect to sign in.' : 'Enter your eBay developer keys to begin (see docs/SETUP-EBAY.md).'
      };
    }
    try {
      await this.accessToken();
      return { status: 'connected', detail: `Signed in (${this.cfg().env})` };
    } catch (e) {
      return { status: 'expired', detail: `Token refresh failed: ${e.message}. Reconnect to sign in again.` };
    }
  }

  // ---------- OAuth ----------

  async beginConnect() {
    const c = this.cfg();
    if (!c.clientId || !secrets.has('ebay.client_secret') || !c.ruName) {
      return {
        fields: [
          { key: 'clientId', label: 'App ID (Client ID)' },
          { key: 'clientSecret', label: 'Cert ID (Client Secret)', secret: true },
          { key: 'ruName', label: 'RuName (Redirect URL name)' },
          { key: 'env', label: "Environment: 'production' or 'sandbox'" }
        ],
        instructions: 'Create a (free) eBay developer account and an application keyset first — step-by-step guide: docs/SETUP-EBAY.md. Save these once; they stay encrypted on this PC.'
      };
    }
    const u = new URL(hosts(c.env).auth + '/oauth2/authorize');
    u.searchParams.set('client_id', c.clientId);
    u.searchParams.set('redirect_uri', c.ruName);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', SCOPES);
    return {
      authUrl: u.toString(),
      instructions: 'A browser window will open. Sign in to the eBay account you SELL with and click Agree. You will land on a page whose address contains "code=..." — copy that whole address (or just the code) and paste it below.'
    };
  }

  async saveCredentials({ clientId, clientSecret, ruName, env }) {
    if (clientSecret) secrets.set('ebay.client_secret', clientSecret.trim());
    config.save({ channels: { ebay: {
      ...(clientId ? { clientId: clientId.trim() } : {}),
      ...(ruName ? { ruName: ruName.trim() } : {}),
      ...(env ? { env: env.trim() } : {})
    } } });
    return { saved: true };
  }

  async completeConnect({ code }) {
    if (!code) throw new Error('Paste the code (or the full redirect URL) from the browser.');
    // Accept either the bare code or the whole redirect URL.
    const m = String(code).match(/[?&]code=([^&\s]+)/);
    const authCode = decodeURIComponent(m ? m[1] : code.trim());
    const c = this.cfg();
    const tok = await this.tokenRequest({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: c.ruName
    });
    secrets.set('ebay.refresh_token', tok.refresh_token);
    this.cacheAccess(tok);
    return { status: 'connected' };
  }

  async disconnect() {
    secrets.remove('ebay.refresh_token');
    secrets.remove('ebay.access_token');
  }

  cacheAccess(tok) {
    secrets.set('ebay.access_token', JSON.stringify({
      token: tok.access_token,
      expiresAt: Date.now() + (tok.expires_in - 120) * 1000
    }));
  }

  async accessToken() {
    const cached = secrets.get('ebay.access_token');
    if (cached) {
      const { token, expiresAt } = JSON.parse(cached);
      if (Date.now() < expiresAt) return token;
    }
    const refresh = secrets.get('ebay.refresh_token');
    if (!refresh) throw new Error('Not connected to eBay');
    const tok = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      scope: SCOPES
    });
    this.cacheAccess(tok);
    return tok.access_token;
  }

  async tokenRequest(params) {
    const c = this.cfg();
    const secret = secrets.get('ebay.client_secret');
    if (!c.clientId || !secret) throw new Error('eBay developer keys are missing');
    const res = await fetch(hosts(c.env).api + '/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${secret}`).toString('base64')
      },
      body: new URLSearchParams(params).toString()
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`eBay token endpoint ${res.status}: ${body.error_description || body.error || 'unknown error'}`);
    return body;
  }

  async rest(method, pathName, payload, extraHeaders = {}) {
    const token = await this.accessToken();
    const c = this.cfg();
    const res = await fetch(hosts(c.env).api + pathName, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
        'X-EBAY-C-MARKETPLACE-ID': c.marketplaceId,
        ...extraHeaders
      },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!res.ok) {
      const msg = body.errors?.map(e => e.message || e.longMessage).join('; ') || text.slice(0, 300) || res.statusText;
      const err = new Error(`eBay API ${res.status} on ${pathName}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // ---------- Messages (Trading API) ----------

  async trading(callName, innerXml) {
    const token = await this.accessToken();
    const c = this.cfg();
    const body = `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>Low</WarningLevel>
  ${innerXml}
</${callName}Request>`;
    const res = await fetch(hosts(c.env).api + '/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-CALL-NAME': callName,
        'X-EBAY-API-SITEID': String(c.siteId ?? 0),
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1193',
        'X-EBAY-API-IAF-TOKEN': token,
        'Content-Type': 'text/xml'
      },
      body
    });
    const parsed = xml.parse(await res.text());
    const root = parsed[`${callName}Response`];
    if (!root) throw new Error(`eBay Trading API: malformed ${callName} response`);
    if (root.Ack === 'Failure') {
      const errs = [].concat(root.Errors || []);
      throw new Error(`eBay ${callName}: ` + errs.map(e => e.LongMessage || e.ShortMessage).join('; '));
    }
    return root;
  }

  async syncMessages() {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const root = await this.trading('GetMyMessages', `
  <DetailLevel>ReturnMessages</DetailLevel>
  <FolderID>0</FolderID>
  <StartTime>${since}</StartTime>
  <Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>1</PageNumber></Pagination>`);
    const raw = [].concat(root.Messages?.Message || []);
    const threads = new Map();
    for (const m of raw) {
      const itemId = m.ItemID ? String(m.ItemID) : '';
      const sender = String(m.Sender || 'eBay member');
      const key = `${sender}::${itemId || 'general'}`;
      if (!threads.has(key)) {
        threads.set(key, {
          externalThreadId: key,
          subject: String(m.Subject || 'eBay message'),
          counterpart: sender,
          listingRef: itemId,
          orderRef: '',
          messages: []
        });
      }
      threads.get(key).messages.push({
        externalId: String(m.MessageID),
        direction: 'in',
        sender,
        body: String(m.Text || m.Subject || ''),
        sentAt: m.ReceiveDate ? new Date(m.ReceiveDate).toISOString() : new Date().toISOString()
      });
    }
    return [...threads.values()];
  }

  async sendReply(thread, body) {
    if (!thread.listing_ref) {
      throw new Error('eBay only lets third-party apps reply to messages tied to a listing. Reply to this one on ebay.com — the drafted text is on your clipboard once you hit Copy.');
    }
    await this.trading('AddMemberMessageRTQ', `
  <ItemID>${thread.listing_ref}</ItemID>
  <MemberMessage>
    <Body>${escapeXml(body)}</Body>
    <DisplayToPublic>false</DisplayToPublic>
    <RecipientID>${escapeXml(thread.counterpart)}</RecipientID>
  </MemberMessage>`);
    return { sent: true };
  }

  // ---------- Orders (Sell Fulfillment API) ----------

  async syncOrders() {
    const since = new Date(Date.now() - 60 * 86400_000).toISOString();
    const data = await this.rest('GET',
      `/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${since}..]`)}&limit=100`);
    return (data.orders || []).map((o) => {
      const item = o.lineItems?.[0] || {};
      const qty = (o.lineItems || []).reduce((n, li) => n + (li.quantity || 1), 0);
      const shipBy = o.lineItems?.[0]?.lineItemFulfillmentInstructions?.shipByDate || null;
      const shipped = (o.orderFulfillmentStatus === 'FULFILLED');
      return {
        externalId: o.orderId,
        buyer: o.buyer?.username || '',
        itemSummary: (o.lineItems || []).map(li => li.title).join(', ') || item.title || 'eBay order',
        quantity: qty,
        totalCents: Math.round(parseFloat(o.pricingSummary?.total?.value || '0') * 100),
        currency: o.pricingSummary?.total?.currency || 'USD',
        orderDate: o.creationDate,
        shipBy,
        meta: { status: o.orderFulfillmentStatus, paid: o.orderPaymentStatus, shipped }
      };
    });
  }

  // ---------- Publishing (Sell Inventory API) ----------

  publishChecklist() {
    const c = this.cfg();
    const missing = [];
    if (!c.fulfillmentPolicyId) missing.push('fulfillmentPolicyId');
    if (!c.paymentPolicyId) missing.push('paymentPolicyId');
    if (!c.returnPolicyId) missing.push('returnPolicyId');
    if (!c.merchantLocationKey) missing.push('merchantLocationKey');
    if (!c.defaultCategoryId) missing.push('defaultCategoryId');
    return missing;
  }

  // Helper the Channels screen calls to fill the checklist for the owner.
  async fetchAccountSetup() {
    const mkt = `marketplace_id=${this.cfg().marketplaceId}`;
    const [ful, pay, ret, loc] = await Promise.all([
      this.rest('GET', `/sell/account/v1/fulfillment_policy?${mkt}`),
      this.rest('GET', `/sell/account/v1/payment_policy?${mkt}`),
      this.rest('GET', `/sell/account/v1/return_policy?${mkt}`),
      this.rest('GET', '/sell/inventory/v1/location?limit=20')
    ]);
    return {
      fulfillmentPolicies: (ful.fulfillmentPolicies || []).map(p => ({ id: p.fulfillmentPolicyId, name: p.name })),
      paymentPolicies: (pay.paymentPolicies || []).map(p => ({ id: p.paymentPolicyId, name: p.name })),
      returnPolicies: (ret.returnPolicies || []).map(p => ({ id: p.returnPolicyId, name: p.name })),
      locations: (loc.locations || []).map(l => ({ key: l.merchantLocationKey, name: l.name }))
    };
  }

  async publishListing(product, rendered) {
    const missing = this.publishChecklist();
    if (missing.length) {
      throw new Error(`eBay publishing needs these settings first (Channels → eBay → Listing setup): ${missing.join(', ')}`);
    }
    const c = this.cfg();
    const sku = product.sku || `WOOD-${product.id}`;

    await this.rest('PUT', `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      availability: { shipToLocationAvailability: { quantity: product.quantity || 1 } },
      condition: 'NEW',
      product: {
        title: rendered.title,
        description: rendered.description,
        aspects: {
          ...(product.materials ? { Material: [product.materials] } : {}),
          Handmade: ['Yes']
        },
        imageUrls: JSON.parse(product.photos || '[]').filter(u => /^https?:/i.test(u)).slice(0, 12)
      }
    }, { 'Content-Language': 'en-US' });

    const offer = await this.rest('POST', '/sell/inventory/v1/offer', {
      sku,
      marketplaceId: c.marketplaceId,
      format: 'FIXED_PRICE',
      availableQuantity: product.quantity || 1,
      categoryId: rendered.categoryId || c.defaultCategoryId,
      listingDescription: rendered.description,
      pricingSummary: { price: { value: (product.price_cents / 100).toFixed(2), currency: config.load().currency } },
      listingPolicies: {
        fulfillmentPolicyId: c.fulfillmentPolicyId,
        paymentPolicyId: c.paymentPolicyId,
        returnPolicyId: c.returnPolicyId
      },
      merchantLocationKey: c.merchantLocationKey
    }).catch(async (e) => {
      // Offer may already exist for this SKU+marketplace; look it up and reuse it.
      if (e.status === 400 && /already exists/i.test(e.message)) {
        const existing = await this.rest('GET', `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
        const found = existing.offers?.find(o => o.marketplaceId === c.marketplaceId);
        if (found) return { offerId: found.offerId };
      }
      throw e;
    });

    const pub = await this.rest('POST', `/sell/inventory/v1/offer/${offer.offerId}/publish`, {});
    return { externalId: pub.listingId || offer.offerId };
  }
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

module.exports = { EbayAdapter };
