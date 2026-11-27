'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readEnvFile() {
  const out = {};
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = Object.assign({}, readEnvFile(), process.env);
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

const hasRazorpay = !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
const hasCashfree = !!(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY);
let provider = String(env.PAYMENT_PROVIDER || 'auto').toLowerCase();
if (provider === 'auto') provider = hasRazorpay ? 'razorpay' : hasCashfree ? 'cashfree' : 'demo';
if (!['razorpay', 'cashfree', 'demo'].includes(provider)) provider = 'demo';
if (provider === 'razorpay' && !hasRazorpay) provider = 'demo';
if (provider === 'cashfree' && !hasCashfree) provider = 'demo';

module.exports = {
  root,
  env,
  port: num(env.PORT, 3000),
  publicDir: path.join(root, 'public'),
  // DATA_DIR can point at a mounted persistent volume in production.
  dataDir: path.resolve(root, String(env.DATA_DIR || 'data')),
  uploadDir: path.join(path.resolve(root, String(env.DATA_DIR || 'data')), 'uploads'),
  dbPath: path.join(path.resolve(root, String(env.DATA_DIR || 'data')), 'db.json'),
  publicUrl: String(
    env.PUBLIC_URL ||
    env.RENDER_EXTERNAL_URL ||
    (env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + env.RAILWAY_PUBLIC_DOMAIN : '') ||
    `http://localhost:${num(env.PORT, 3000)}`
  ).replace(/\/$/, ''),
  uploadSecret: String(env.UPLOAD_SECRET || 'qsp-local-upload-secret'),
  limits: {
    maxFile: num(env.MAX_FILE_MB, 60) * 1024 * 1024,
    maxTotal: num(env.MAX_TOTAL_MB, 200) * 1024 * 1024
  },
  shopSeed: {
    id: String(env.SHOP_ID || 'SHOP_DA35DAB7'),
    name: String(env.SHOP_NAME || 'QR Se Print'),
    address: String(env.SHOP_ADDRESS || 'Printing made simple · Shop at your service'),
    phone: String(env.SHOP_PHONE || ''),
    email: String(env.SHOP_EMAIL || ''),
    logo: String(env.SHOP_LOGO || ''),
    price_bw: num(env.PRICE_BW, 5),
    price_color: num(env.PRICE_COLOR, 10),
    price_bw_duplex: num(env.PRICE_BW_DUPLEX, 8),
    price_color_duplex: num(env.PRICE_COLOR_DUPLEX, 16),
    payment_mode: 'both',
    country: 'IN',
    currency: 'INR'
  },
  payment: {
    provider,
    mode: provider === 'demo' ? 'demo' : (String(env.CASHFREE_ENV || 'TEST').toUpperCase() === 'PROD' || String(env.RAZORPAY_KEY_ID || '').startsWith('rzp_live') ? 'live' : 'test'),
    razorpay: {
      keyId: String(env.RAZORPAY_KEY_ID || ''),
      secret: String(env.RAZORPAY_KEY_SECRET || ''),
      api: 'https://api.razorpay.com/v1'
    },
    cashfree: {
      appId: String(env.CASHFREE_APP_ID || ''),
      secret: String(env.CASHFREE_SECRET_KEY || ''),
      api: String(env.CASHFREE_ENV || 'TEST').toUpperCase() === 'PROD' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg'
    }
  },
  upi: {
    vpa: String(env.UPI_VPA || env.SHOP_UPI || ''),
    name: String(env.UPI_NAME || env.SHOP_NAME || 'QR Se Print'),
    enabled: !!(env.UPI_VPA || env.SHOP_UPI)
  },
  admin: {
    password: String(env.ADMIN_PASSWORD || 'admin123'),
    secret: String(env.ADMIN_SECRET || env.UPLOAD_SECRET || 'qsp-local-upload-secret') + ':admin',
    defaultPassword: !env.ADMIN_PASSWORD
  }
};
