'use strict';

const crypto = require('crypto');
const config = require('./config');
const { hmac } = require('./util');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

async function apiFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; }
  catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = (json && (json.message || (json.error && json.error.description) || json.raw)) || ('HTTP ' + res.status);
    throw new Error(String(msg).slice(0, 400));
  }
  return json;
}

// ───────────────────────── Razorpay ─────────────────────────

async function razorpayCreate({ amount, receipt, notes }) {
  const { keyId, secret, api } = config.payment.razorpay;
  const auth = Buffer.from(`${keyId}:${secret}`).toString('base64');
  const data = await apiFetch(api + '/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + auth },
    body: JSON.stringify({
      amount: Math.round(Number(amount) * 100),
      currency: 'INR',
      receipt: String(receipt || '').slice(0, 40),
      notes: notes || {}
    })
  });
  return { providerOrderId: data.id, keyId, amount: data.amount, currency: data.currency };
}

function razorpayVerify({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = hmac(config.payment.razorpay.secret, orderId + '|' + paymentId);
  return safeEqual(expected, signature);
}

// ───────────────────────── Cashfree ─────────────────────────

let cfToken = { value: '', expires: 0 };

async function cashfreeAuth() {
  const now = Date.now();
  if (cfToken.value && cfToken.expires > now + 60000) return cfToken.value;
  const { appId, secret, api } = config.payment.cashfree;
  const data = await apiFetch(api + '/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': appId, 'x-client-secret': secret },
    body: JSON.stringify({})
  });
  cfToken = { value: data.token, expires: now + ((Number(data.tokenExpiresAt) || 3600) * 1000) };
  return cfToken.value;
}

async function cashfreeCreate({ orderId, amount, customer, returnUrl }) {
  const api = config.payment.cashfree.api;
  const token = await cashfreeAuth();
  const data = await apiFetch(api + '/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'x-client-id': config.payment.cashfree.appId },
    body: JSON.stringify({
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: 'INR',
      customer_details: {
        customer_id: String((customer && customer.id) || 'guest').slice(0, 40),
        customer_name: String((customer && customer.name) || 'Print Customer').slice(0, 60),
        customer_email: String((customer && customer.email) || 'print@example.com').slice(0, 100),
        customer_phone: String((customer && customer.phone) || '9999999999').replace(/\D/g, '').slice(0, 15) || '9999999999'
      },
      order_meta: { return_url: returnUrl }
    })
  });
  return {
    providerOrderId: orderId,
    paymentLink: data.payment_link || data.payment_url || null,
    sessionToken: data.cf_payment_token || null,
    keyId: config.payment.cashfree.appId,
    amount: Number(amount),
    currency: 'INR'
  };
}

async function cashfreeStatus(orderId) {
  const api = config.payment.cashfree.api;
  const token = await cashfreeAuth();
  return apiFetch(api + '/orders/' + encodeURIComponent(orderId), {
    headers: { Authorization: 'Bearer ' + token, 'x-client-id': config.payment.cashfree.appId }
  });
}

function cashfreeWebhookValid(body, signature, timestamp) {
  // Cashfree signs `${timestamp}${rawBody}` with HMAC-SHA256 using the secret.
  if (!signature) return false;
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return safeEqual(hmac(config.payment.cashfree.secret, String(timestamp || '') + raw), signature);
}

module.exports = {
  razorpayCreate, razorpayVerify,
  cashfreeCreate, cashfreeStatus, cashfreeWebhookValid,
  safeEqual
};
