'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (limit && size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const buf = await readBody(req, limit || 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch (e) { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, rootDir, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  // SPA fallback for /print/<shopId> and other client-side routes
  if (!path.extname(rel)) rel = '/index.html';
  const file = path.resolve(rootDir, '.' + rel);
  if (!file.startsWith(path.resolve(rootDir))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      fs.readFile(path.join(rootDir, 'index.html'), (e, data) => {
        if (e) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(data);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html' || ext === '.js' || ext === '.css') headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

function safeName(name) {
  return String(name || 'file')
    .replace(/\\/g, '/').split('/').pop()
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .slice(0, 160) || 'file';
}

function hmac(secret, data, encoding) {
  return crypto.createHmac('sha256', secret).update(data).digest(encoding || 'hex');
}

function randomId(prefix) {
  return (prefix || '') + crypto.randomBytes(10).toString('hex');
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = { sendJson, readBody, readJson, serveStatic, safeName, hmac, randomId, money, MIME };
