'use strict';

const fs = require('fs');
const config = require('./config');

const empty = () => ({
  version: 1,
  seq: 0,
  shops: {},
  jobs: {},
  uploads: {},
  payments: {},
  feedback: []
});

let data;

// Atomic write so a crash never leaves a half-written database.
function save() {
  if (!data) return;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = config.dbPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, config.dbPath);
}

function ensure() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  if (!fs.existsSync(config.dbPath)) {
    data = empty();
    data.shops[config.shopSeed.id] = config.shopSeed;
    save();
  }
}

function load() {
  if (data) return data;
  ensure();
  try {
    data = JSON.parse(fs.readFileSync(config.dbPath, 'utf8'));
    if (!data || typeof data !== 'object') data = empty();
  } catch (e) {
    data = empty();
  }
  data.seq = Number(data.seq) || 0;
  data.shops = data.shops || {};
  data.jobs = data.jobs || {};
  data.uploads = data.uploads || {};
  data.payments = data.payments || {};
  data.feedback = Array.isArray(data.feedback) ? data.feedback : [];
  if (!data.shops[config.shopSeed.id]) data.shops[config.shopSeed.id] = config.shopSeed;
  save();
  return data;
}

function get() { return load(); }

function nextOrderNo() {
  const d = load();
  d.seq += 1;
  save();
  return 'M-' + String(d.seq).padStart(6, '0');
}

function putTable(table, id, value) {
  const d = load();
  d[table][id] = value;
  save();
  return value;
}

function getTable(table, id) { return load()[table][id]; }

function pushFeedback(row) {
  const d = load();
  d.feedback.push(row);
  save();
  return row;
}

module.exports = { get, save, nextOrderNo, putTable, getTable, pushFeedback };
