'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const payments = require('./payments');
const { sendJson, readJson, readBody, serveStatic, safeName, hmac, safeEqual, money, randomId, MIME } = require('./util');

const MAX_BODY = config.limits.maxTotal + 1024 * 1024;

function publicShop(shop) {
  return {
    id: shop.id,
    name: shop.name,
    address: shop.address,
    phone: shop.phone || '',
    email: shop.email || '',
    logo: shop.logo || '',
    price_bw: Number(shop.price_bw) || 0,
    price_color: Number(shop.price_color) || 0,
    price_bw_duplex: Number(shop.price_bw_duplex) || Number(shop.price_bw) || 0,
    price_color_duplex: Number(shop.price_color_duplex) || Number(shop.price_color) || 0,
    payment_mode: shop.payment_mode || 'both',
    country: shop.country || 'IN',
    currency: shop.currency || 'INR'
  };
}

function quote(shop, o) {
  const pages = Math.max(1, Number(o.pages) || 1);
  const copies = Math.max(1, Math.min(100, Number(o.copies) || 1));
  const duplex = !!o.duplex;
  const color = o.colorMode === 'color';
  let rate = color ? Number(shop.price_color) : Number(shop.price_bw);
  if (duplex) rate = color ? Number(shop.price_color_duplex) : Number(shop.price_bw_duplex);
  const perSheet = Math.max(1, Number(o.mini && o.mini.n) || 1);
  const units = perSheet > 1 ? Math.ceil(pages / perSheet) : pages;
  return money(rate * units * copies);
}

function uploadToken(uploadId, shopId, expires) {
  return hmac(config.uploadSecret, `${uploadId}|${shopId}|${expires}`);
}

function publicUpi() {
  return {
    vpa: config.upi.vpa,
    name: config.upi.name,
    enabled: config.upi.enabled
  };
}

function adminToken(expires) {
  return String(expires) + '.' + hmac(config.admin.secret, String(expires));
}

function verifyAdmin(req) {
  const header = String(req.headers.authorization || '');
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const parts = m[1].split('.');
  if (parts.length !== 2) return false;
  const expires = Number(parts[0]);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  return safeEqual(parts[1], hmac(config.admin.secret, parts[0]));
}

function verifyPrintAgent(req) {
  const key = config.printAgent.key;
  if (!key) return false;
  const header = String(req.headers.authorization || '');
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : String(req.headers['x-print-agent-key'] || '');
  return !!token && safeEqual(token, key);
}

function printAgentJob(job) {
  return {
    id: job.id,
    jobId: job.id,
    orderNo: job.orderNo,
    status: job.status,
    amount: job.amount,
    pages: job.pages,
    copies: job.copies,
    colorMode: job.colorMode,
    duplex: job.duplex,
    mini: job.mini || null,
    pageRange: job.pageRange || 'all',
    created: job.created || 0,
    file: job.files && job.files[0] ? {
      name: job.files[0].name,
      size: job.files[0].size,
      path: `/api/agent/jobs/${job.id}/file`
    } : null
  };
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (p.startsWith('/api/admin/') && p !== '/api/admin/login' && !verifyAdmin(req)) {
    return sendJson(res, 401, { error: 'Admin login required' });
  }

  if (p.startsWith('/api/agent/') && !verifyPrintAgent(req)) {
    return sendJson(res, 401, { error: 'Print agent key invalid' });
  }

  if (p === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, provider: config.payment.provider, mode: config.payment.mode });
  }

  if (p === '/api/config' && method === 'GET') {
    return sendJson(res, 200, {
      provider: config.payment.provider,
      mode: config.payment.mode,
      razorpayKeyId: config.payment.razorpay.keyId,
      cashfreeAppId: config.payment.cashfree.appId,
      upi: publicUpi(),
      maxFile: config.limits.maxFile,
      maxTotal: config.limits.maxTotal
    });
  }

  let m;
  if ((m = p.match(/^\/api\/shop\/([^/]+)$/)) && method === 'GET') {
    const shop = db.getTable('shops', decodeURIComponent(m[1]));
    if (!shop) return sendJson(res, 404, { error: 'Shop not found' });
    return sendJson(res, 200, publicShop(shop));
  }

  if (p === '/api/quote' && method === 'POST') {
    const body = await readJson(req);
    const shop = db.getTable('shops', body.shopId || config.shopSeed.id) || config.shopSeed;
    return sendJson(res, 200, { amount: quote(shop, body) });
  }

  if (p === '/api/upload/sign' && method === 'POST') {
    const body = await readJson(req);
    const shopId = String(body.shopId || config.shopSeed.id);
    const uploadId = randomId('up_');
    const expires = Date.now() + 30 * 60 * 1000;
    db.putTable('uploads', uploadId, { shopId, files: [], bytes: 0, expires, created: Date.now() });
    return sendJson(res, 200, { uploadId, token: uploadToken(uploadId, shopId, expires), expires, maxFile: config.limits.maxFile, maxTotal: config.limits.maxTotal });
  }

  if (p === '/api/upload' && method === 'PUT') {
    const token = url.searchParams.get('token') || '';
    const uploadId = String(req.headers['x-upload-id'] || '');
    const shopId = String(req.headers['x-shop-id'] || config.shopSeed.id);
    const rec = db.getTable('uploads', uploadId);
    if (!rec || rec.expires < Date.now() || !hmac(config.uploadSecret, `${uploadId}|${shopId}|${rec.expires}`) || token !== uploadToken(uploadId, shopId, rec.expires)) {
      return sendJson(res, 403, { error: 'Upload token invalid or expired' });
    }
    const name = safeName(req.headers['x-file-name'] || 'file');
    const declared = Number(req.headers['x-file-size'] || 0) || 0;
    if (declared > config.limits.maxFile) return sendJson(res, 413, { error: 'File too large' });
    if (rec.bytes + declared > config.limits.maxTotal) return sendJson(res, 413, { error: 'Total upload too large' });

    const dir = path.join(config.uploadDir, uploadId);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, name);
    let size = 0;
    const temp = target + '.part';
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(temp);
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > config.limits.maxFile) {
          reject(Object.assign(new Error('File too large'), { status: 413 }));
          req.destroy();
        }
      });
      req.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    });
    fs.renameSync(temp, target);
    rec.files.push({ name, size, path: path.relative(config.dataDir, target) });
    rec.bytes += size;
    db.putTable('uploads', uploadId, rec);
    return sendJson(res, 200, { ok: true, name, size });
  }

  if (p === '/api/upload/confirm' && method === 'POST') {
    const body = await readJson(req);
    const rec = db.getTable('uploads', String(body.uploadId || ''));
    if (!rec) return sendJson(res, 404, { error: 'Upload session not found' });
    const shop = db.getTable('shops', rec.shopId) || config.shopSeed;
    const amount = quote(shop, body);
    const jobId = randomId('job_');
    const orderNo = db.nextOrderNo();
    const job = {
      id: jobId,
      orderNo,
      shopId: rec.shopId,
      files: rec.files,
      pages: Number(body.pages) || 1,
      copies: Number(body.copies) || 1,
      colorMode: body.colorMode === 'color' ? 'color' : 'bw',
      duplex: !!body.duplex,
      mini: body.mini || null,
      pageRange: body.pageRange || 'all',
      amount,
      status: 'awaiting_payment',
      created: Date.now()
    };
    db.putTable('jobs', jobId, job);
    return sendJson(res, 200, { jobId, orderNo, amount, status: job.status });
  }

  if ((m = p.match(/^\/api\/jobs\/([^/]+)\/status$/)) && method === 'GET') {
    const job = db.getTable('jobs', m[1]);
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    return sendJson(res, 200, { id: job.id, orderNo: job.orderNo, status: job.status, amount: job.amount });
  }

  if ((m = p.match(/^\/api\/jobs\/([^/]+)\/feedback$/)) && method === 'POST') {
    const job = db.getTable('jobs', m[1]);
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    const body = await readJson(req);
    db.pushFeedback({ jobId: job.id, good: !!body.good, comment: String(body.comment || '').slice(0, 500), at: Date.now() });
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/payment/online/create' && method === 'POST') {
    const body = await readJson(req);
    const job = db.getTable('jobs', String(body.jobId || ''));
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    if (job.status === 'paid' || job.status === 'counter_pending') return sendJson(res, 400, { error: 'Job already paid' });
    const provider = config.payment.provider;
    const receipt = 'job_' + job.id.replace(/[^a-z0-9]/gi, '').slice(0, 20);
    let result;
    if (provider === 'razorpay') {
      result = await payments.razorpayCreate({ amount: job.amount, receipt, notes: { order_no: job.orderNo } });
    } else if (provider === 'cashfree') {
      const orderId = 'QSP' + job.orderNo.replace(/\D/g, '') + Date.now().toString().slice(-6);
      result = await payments.cashfreeCreate({
        orderId, amount: job.amount,
        customer: { id: 'cust_' + job.orderNo, name: 'Print Customer', email: String(body.email || 'print@example.com'), phone: String(body.phone || '9999999999') },
        returnUrl: `${config.publicUrl}/?cf=${encodeURIComponent(orderId)}`
      });
    } else {
      result = { providerOrderId: 'demo_' + job.orderNo, keyId: '', amount: job.amount, currency: 'INR' };
    }
    job.paymentProvider = provider;
    job.providerOrderId = result.providerOrderId;
    db.putTable('jobs', job.id, job);
    db.putTable('payments', result.providerOrderId, {
      jobId: job.id, provider, amount: job.amount, status: 'created', created: Date.now()
    });
    return sendJson(res, 200, Object.assign({ provider, mode: config.payment.mode }, result));
  }

  if (p === '/api/payment/razorpay/verify' && method === 'POST') {
    const body = await readJson(req);
    if (!payments.razorpayVerify(body)) return sendJson(res, 400, { error: 'Payment signature verification failed' });
    const payment = db.getTable('payments', String(body.razorpay_order_id || ''));
    if (!payment) return sendJson(res, 404, { error: 'Payment order not found' });
    const job = db.getTable('jobs', payment.jobId);
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    payment.status = 'paid';
    payment.paymentId = body.razorpay_payment_id;
    db.putTable('payments', payment.providerOrderId, payment);
    job.status = 'paid';
    db.putTable('jobs', job.id, job);
    return sendJson(res, 200, { ok: true, orderNo: job.orderNo, amount: job.amount, status: 'paid' });
  }

  if (p === '/api/payment/cashfree/status' && method === 'POST') {
    const body = await readJson(req);
    const orderId = String(body.orderId || '');
    const payment = db.getTable('payments', orderId);
    if (!payment) return sendJson(res, 404, { error: 'Payment order not found' });
    const job = db.getTable('jobs', payment.jobId);
    let status = 'pending';
    try {
      const st = await payments.cashfreeStatus(orderId);
      status = String(st.order_status || '').toUpperCase();
    } catch (e) {
      status = String(body.orderStatus || '').toUpperCase();
    }
    if (status === 'PAID') {
      payment.status = 'paid'; db.putTable('payments', orderId, payment);
      job.status = 'paid'; db.putTable('jobs', job.id, job);
    }
    return sendJson(res, 200, { ok: true, status: job.status, orderNo: job.orderNo, amount: job.amount, gatewayStatus: status });
  }

  if (p === '/api/payment/cashfree/webhook' && method === 'POST') {
    const raw = (await readBody(req, 1024 * 1024)).toString('utf8');
    let body; try { body = JSON.parse(raw); } catch (e) { body = {}; }
    const signature = req.headers['x-cf-signature'] || '';
    const timestamp = req.headers['x-cf-timestamp'] || '';
    if (!payments.cashfreeWebhookValid(raw, signature, timestamp)) {
      return sendJson(res, 401, { error: 'Invalid webhook signature' });
    }
    const orderId = String((body.data && body.data.order && body.data.order.order_id) || body.order_id || '');
    const payment = db.getTable('payments', orderId);
    if (payment && String(body.data && body.data.order && body.data.order.order_status || '').toUpperCase() === 'PAID') {
      const job = db.getTable('jobs', payment.jobId);
      payment.status = 'paid'; db.putTable('payments', orderId, payment);
      if (job) { job.status = 'paid'; db.putTable('jobs', job.id, job); }
    }
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/payment/demo/complete' && method === 'POST') {
    const body = await readJson(req);
    const orderId = String(body.orderId || '');
    const payment = db.getTable('payments', orderId);
    if (!payment) return sendJson(res, 404, { error: 'Payment order not found' });
    const job = db.getTable('jobs', payment.jobId);
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    payment.status = 'paid'; db.putTable('payments', orderId, payment);
    job.status = 'paid'; db.putTable('jobs', job.id, job);
    return sendJson(res, 200, { ok: true, orderNo: job.orderNo, amount: job.amount, status: 'paid' });
  }

  if (p === '/api/payment/upi/confirm' && method === 'POST') {
    const body = await readJson(req);
    const job = db.getTable('jobs', String(body.jobId || ''));
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    if (job.status !== 'awaiting_payment') return sendJson(res, 400, { error: 'Job already confirmed' });
    job.status = 'upi_pending';
    job.utr = String(body.utr || '').slice(0, 80);
    job.updated = Date.now();
    db.putTable('jobs', job.id, job);
    db.putTable('payments', 'upi_' + job.id, {
      jobId: job.id, provider: 'upi', amount: job.amount, status: 'pending',
      utr: job.utr, created: Date.now()
    });
    return sendJson(res, 200, { ok: true, orderNo: job.orderNo, amount: job.amount, status: job.status });
  }

  if (p === '/api/payment/counter' && method === 'POST') {
    const body = await readJson(req);
    const job = db.getTable('jobs', String(body.jobId || ''));
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    job.status = 'counter_pending';
    db.putTable('jobs', job.id, job);
    db.putTable('payments', 'counter_' + job.id, { jobId: job.id, provider: 'counter', amount: job.amount, status: 'pending', created: Date.now() });
    return sendJson(res, 200, { ok: true, orderNo: job.orderNo, amount: job.amount, status: job.status });
  }

  /* ── Shop admin: login, print queue, file access, status ───────── */
  if (p === '/api/admin/login' && method === 'POST') {
    const body = await readJson(req);
    if (!safeEqual(String(body.password || ''), config.admin.password)) {
      return sendJson(res, 401, { error: 'Galat password' });
    }
    const expires = Date.now() + 8 * 60 * 60 * 1000;
    return sendJson(res, 200, {
      token: adminToken(expires),
      expires,
      shopName: config.shopSeed.name,
      upi: publicUpi()
    });
  }

  if (p === '/api/admin/jobs' && method === 'GET') {
    const jobs = Object.values(db.get().jobs)
      .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0))
      .map((j) => ({
        id: j.id,
        jobId: j.id,
        orderNo: j.orderNo,
        status: j.status,
        amount: j.amount,
        pages: j.pages,
        copies: j.copies,
        colorMode: j.colorMode,
        duplex: j.duplex,
        mini: j.mini || null,
        pageRange: j.pageRange || 'all',
        utr: j.utr || '',
        created: j.created || 0,
        files: (j.files || []).map((f) => ({ name: f.name, size: f.size }))
      }));
    return sendJson(res, 200, { jobs, upi: publicUpi(), shopName: config.shopSeed.name });
  }

  let am;
  if ((am = p.match(/^\/api\/admin\/jobs\/([^/]+)\/file$/)) && method === 'GET') {
    const job = db.getTable('jobs', am[1]);
    if (!job || !job.files || !job.files.length) return sendJson(res, 404, { error: 'File nahi mila' });
    const rel = String(job.files[0].path || '');
    const root = path.resolve(config.dataDir);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'File disk par nahi hai' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Disposition': 'inline; filename="' + safeName(job.files[0].name) + '"',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  if ((am = p.match(/^\/api\/admin\/jobs\/([^/]+)\/status$/)) && method === 'POST') {
    const job = db.getTable('jobs', am[1]);
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    const body = await readJson(req);
    const allowed = ['awaiting_payment', 'counter_pending', 'upi_pending', 'paid', 'printed', 'cancelled'];
    const status = String(body.status || '');
    if (!allowed.includes(status)) return sendJson(res, 400, { error: 'Invalid status' });
    job.status = status;
    job.updated = Date.now();
    if (status === 'printed') job.printedAt = Date.now();
    db.putTable('jobs', job.id, job);
    const payment = db.getTable('payments', 'upi_' + job.id);
    if (payment && (status === 'paid' || status === 'printed')) {
      payment.status = 'paid';
      db.putTable('payments', 'upi_' + job.id, payment);
    }
    return sendJson(res, 200, { ok: true, status: job.status });
  }

  /* ── Local print agent (shop PC): poll jobs, fetch file, mark printed ── */
  if (p === '/api/agent/config' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      shopName: config.shopSeed.name,
      autoStatuses: config.printAgent.autoStatuses,
      pollMs: config.printAgent.pollMs
    });
  }

  if (p === '/api/agent/jobs' && method === 'GET') {
    const status = String(url.searchParams.get('status') || 'paid');
    const statuses = status === 'all'
      ? ['paid', 'counter_pending', 'upi_pending']
      : status.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const jobs = Object.values(db.get().jobs)
      .filter((j) => statuses.includes(j.status))
      .sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0))
      .map(printAgentJob);
    return sendJson(res, 200, { jobs });
  }

  if ((am = p.match(/^\/api\/agent\/jobs\/([^/]+)\/file$/)) && method === 'GET') {
    const job = db.getTable('jobs', am[1]);
    if (!job || !job.files || !job.files.length) return sendJson(res, 404, { error: 'File nahi mila' });
    const rel = String(job.files[0].path || '');
    const root = path.resolve(config.dataDir);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'File disk par nahi hai' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Disposition': 'inline; filename="' + safeName(job.files[0].name) + '"',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  if ((am = p.match(/^\/api\/agent\/jobs\/([^/]+)\/status$/)) && method === 'POST') {
    const job = db.getTable('jobs', am[1]);
    if (!job) return sendJson(res, 404, { error: 'Job not found' });
    const body = await readJson(req);
    const allowed = ['paid', 'printed', 'cancelled'];
    const status = String(body.status || '');
    if (!allowed.includes(status)) return sendJson(res, 400, { error: 'Invalid status' });
    job.status = status;
    job.updated = Date.now();
    if (status === 'printed') {
      job.printedAt = Date.now();
      job.printedBy = 'agent';
    }
    db.putTable('jobs', job.id, job);
    const payment = db.getTable('payments', 'upi_' + job.id);
    if (payment && (status === 'paid' || status === 'printed')) {
      payment.status = 'paid';
      db.putTable('payments', 'upi_' + job.id, payment);
    }
    return sendJson(res, 200, { ok: true, status: job.status });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (methodAllowsBody(req.method)) {
      // Drain unexpected bodies on non-API requests so the connection stays clean.
      req.resume();
    }
    return serveStatic(req, res, config.publicDir, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[server]', err);
    if (!res.headersSent) return sendJson(res, status, { error: err.message || 'Server error' });
    res.end();
  }
});

function methodAllowsBody(m) { return m === 'POST' || m === 'PUT' || m === 'PATCH'; }

server.listen(config.port, () => {
  console.log(`QR Se Print replica running at ${config.publicUrl}`);
  console.log(`Payment provider: ${config.payment.provider} (${config.payment.mode})`);
  if (config.admin.defaultPassword) {
    console.warn('WARNING: ADMIN_PASSWORD is not set — using demo password "admin123". Set it before going live.');
  }
  if (!config.printAgent.enabled) {
    console.warn('INFO: PRINT_AGENT_KEY is not set — local auto-print agent endpoints are disabled.');
  }
});

function shutdown() {
  console.log('Shutting down gracefully…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
