#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const root = __dirname;
const DEFAULT_CFG = path.join(root, 'agent-config.json');
const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'run';
const cfgPath = argValue('--config') || DEFAULT_CFG;
const dryRun = args.includes('--dry-run') || args.includes('--once-dry-run');
const once = args.includes('--once');
const POLL_DEFAULT = 5000;
let printing = false;

function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : '';
}

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function loadConfig() {
  const env = Object.assign({}, loadEnv(path.join(root, '.env')), process.env);
  let fileCfg = {};
  if (fs.existsSync(cfgPath)) {
    try { fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {
      throw new Error('Config read nahi ho saka: ' + cfgPath + ' — ' + e.message);
    }
  }
  const pick = (k, ek, d) => argValue('--' + k) || env[ek] || fileCfg[k] || d || '';
  const serverUrl = String(pick('server', 'PRINT_SERVER_URL', '')).replace(/\/$/, '');
  const statuses = String(pick('statuses', 'PRINT_AGENT_STATUSES', 'paid'))
    .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return {
    serverUrl,
    agentKey: String(pick('key', 'PRINT_AGENT_KEY', '')),
    printer: String(pick('printer', 'PRINT_AGENT_PRINTER', '')),
    sumatraPath: String(pick('sumatra', 'PRINT_AGENT_SUMATRA', '')),
    statuses: statuses.length ? statuses : ['paid'],
    pollMs: Math.max(1000, Number(pick('poll-ms', 'PRINT_AGENT_POLL_MS', fileCfg.pollMs || POLL_DEFAULT)) || POLL_DEFAULT),
    markPrinted: String(pick('mark-printed', 'PRINT_AGENT_MARK_PRINTED', fileCfg.markPrinted === false ? 'false' : 'true')) !== 'false',
    statePath: String(pick('state', 'PRINT_AGENT_STATE', fileCfg.statePath || path.join(root, 'agent-state.json'))),
    spoolDir: String(pick('spool', 'PRINT_AGENT_SPOOL', fileCfg.spoolDir || path.join(root, 'spool'))),
    logPath: String(pick('log', 'PRINT_AGENT_LOG', fileCfg.logPath || path.join(root, 'agent.log')))
  };
}

function log(cfg, msg, extra) {
  const line = `[${new Date().toISOString()}] ${msg}${extra ? ' ' + extra : ''}`;
  console.log(line);
  try { fs.appendFileSync(cfg.logPath, line + os.EOL); } catch (e) {}
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function request(urlStr, opts) {
  const u = new URL(urlStr);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode || 0, headers: res.headers, body: buf });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function api(cfg, p, opts) {
  const o = opts || {};
  const headers = Object.assign({ Authorization: 'Bearer ' + cfg.agentKey }, o.headers || {});
  const res = await request(cfg.serverUrl + p, { method: o.method || 'GET', headers, body: o.body });
  const ct = String(res.headers['content-type'] || '');
  let data = res.body;
  if (!o.raw && ct.includes('application/json')) {
    try { data = JSON.parse(res.body.toString('utf8')); } catch (e) { data = {}; }
  }
  if (res.status >= 400) {
    const msg = data && data.error ? data.error : ('HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function detectSumatra(cfg) {
  if (cfg.sumatraPath && fs.existsSync(cfg.sumatraPath)) return cfg.sumatraPath;
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'SumatraPDF', 'SumatraPDF.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'SumatraPDF', 'SumatraPDF.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'SumatraPDF', 'SumatraPDF.exe')
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  const where = spawnSync('where.exe', ['SumatraPDF.exe'], { encoding: 'utf8' });
  if (where.status === 0) {
    const line = String(where.stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (line && fs.existsSync(line)) return line;
  }
  return '';
}

function listPrintersPS() {
  const ps = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    'Get-Printer | Select-Object -ExpandProperty Name'
  ], { encoding: 'utf8' });
  if (ps.status !== 0) return [];
  return String(ps.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function resolvePrinter(cfg) {
  const printers = listPrintersPS();
  if (!printers.length) return { printers, name: cfg.printer || '' };
  if (!cfg.printer) return { printers, name: printers[0] };
  const want = normalizeName(cfg.printer);
  const exact = printers.find(p => normalizeName(p) === want);
  if (exact) return { printers, name: exact };
  const partial = printers.find(p => normalizeName(p).includes(want) || want.includes(normalizeName(p)));
  return { printers, name: partial || cfg.printer };
}

function safeExt(name, contentType) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext) return ext;
  if (String(contentType).includes('pdf')) return '.pdf';
  if (String(contentType).includes('png')) return '.png';
  if (String(contentType).includes('jpeg') || String(contentType).includes('jpg')) return '.jpg';
  if (String(contentType).includes('webp')) return '.webp';
  return '.bin';
}

function printSettings(job) {
  const parts = [];
  const copies = Math.max(1, Number(job.copies) || 1);
  parts.push(String(copies) + 'x');
  if (job.colorMode === 'bw') parts.push('monochrome'); else parts.push('color');
  if (job.duplex) parts.push('duplexlong');
  const pageRange = String(job.pageRange || 'all').trim();
  if (pageRange && pageRange !== 'all') parts.push(pageRange.replace(/\s+/g, ''));
  return parts.join(',');
}

function run(cmdExe, cmdArgs, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmdExe, cmdArgs, Object.assign({ windowsHide: true }, opts || {}));
    let out = ''; let err = '';
    if (p.stdout) p.stdout.on('data', d => { out += d.toString(); });
    if (p.stderr) p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', code => resolve({ code: code || 0, out, err }));
  });
}

async function printFile(cfg, job, filePath) {
  const printerInfo = resolvePrinter(cfg);
  if (!printerInfo.name) throw new Error('Printer nahi mila. Windows me printer install/add karo.');
  const ext = path.extname(filePath).toLowerCase();
  const sumatra = detectSumatra(cfg);
  const settings = printSettings(job);

  if (ext === '.pdf' || ext === '.djvu' || ext === '.epub' || ext === '.mobi' || ext === '.cbz' || ext === '.cbr' || ext === '.xps' || ext === '.tif' || ext === '.tiff' || ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].includes(ext)) {
    if (sumatra) {
      const sArgs = ['-print-to', printerInfo.name, '-silent', '-print-settings', settings, filePath];
      log(cfg, `PRINT ${job.orderNo} via Sumatra`, `${printerInfo.name} | ${settings}`);
      const res = await run(sumatra, sArgs);
      if (res.code !== 0) throw new Error('SumatraPDF exit code ' + res.code + (res.err ? ': ' + res.err.trim() : ''));
      return { engine: 'sumatra', printer: printerInfo.name, settings };
    }
  }

  if (ext === '.pdf') {
    throw new Error('PDF print ke liye SumatraPDF install karo: https://www.sumatrapdfreader.org/download-free-pdf-viewer');
  }

  // Image fallback: Windows shell print verb uses default image print path.
  // For reliable A4 image printing, install SumatraPDF; this fallback is best-effort.
  const psCmd = `Start-Process -FilePath '${filePath.replace(/'/g, "''")}' -Verb Print -WindowStyle Hidden`;
  log(cfg, `PRINT ${job.orderNo} via Shell`, printerInfo.name);
  const res = await run('powershell.exe', ['-NoProfile', '-Command', psCmd]);
  if (res.code !== 0) throw new Error('Shell print failed: ' + (res.err || res.out || '').trim());
  return { engine: 'shell', printer: printerInfo.name, settings };
}

async function processJob(cfg, state, job) {
  const id = String(job.jobId || job.id);
  if (!id) return;
  if (state.printed[id]) return;
  if (state.inFlight[id]) return;
  state.inFlight[id] = Date.now();
  writeJson(cfg.statePath, state);

  try {
    if (dryRun) {
      log(cfg, `DRY-RUN ${job.orderNo}`, `${job.file && job.file.name} | ${printSettings(job)}`);
      state.printed[id] = { at: Date.now(), dryRun: true };
      delete state.inFlight[id];
      writeJson(cfg.statePath, state);
      return;
    }

    const res = await api(cfg, `/api/agent/jobs/${encodeURIComponent(id)}/file`, { raw: true });
    const ext = safeExt(job.file && job.file.name, res.headers['content-type']);
    fs.mkdirSync(cfg.spoolDir, { recursive: true });
    const filePath = path.join(cfg.spoolDir, `${job.orderNo || id}-${id}${ext}`);
    fs.writeFileSync(filePath, res.body);

    const info = await printFile(cfg, job, filePath);
    if (cfg.markPrinted) {
      await api(cfg, `/api/agent/jobs/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'printed' })
      });
    }
    state.printed[id] = { at: Date.now(), orderNo: job.orderNo, engine: info.engine, printer: info.printer };
    delete state.inFlight[id];
    writeJson(cfg.statePath, state);
    log(cfg, `DONE ${job.orderNo}`, `marked printed=${cfg.markPrinted}`);
  } catch (e) {
    delete state.inFlight[id];
    state.errors = state.errors || {};
    state.errors[id] = { at: Date.now(), message: e.message, orderNo: job.orderNo };
    writeJson(cfg.statePath, state);
    log(cfg, `ERROR ${job.orderNo || id}`, e.message);
  }
}

async function pollOnce(cfg) {
  const state = readJson(cfg.statePath, { printed: {}, inFlight: {}, errors: {} });
  const status = encodeURIComponent(cfg.statuses.join(','));
  const data = await api(cfg, `/api/agent/jobs?status=${status}`);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  for (const job of jobs) {
    await processJob(cfg, state, job);
  }
  if (!jobs.length) log(cfg, 'IDLE', `no jobs for ${cfg.statuses.join(',')}`);
}

async function cmdTest(cfg) {
  if (!cfg.serverUrl) throw new Error('PRINT_SERVER_URL missing');
  if (!cfg.agentKey) throw new Error('PRINT_AGENT_KEY missing');
  const info = await api(cfg, '/api/agent/config');
  const printers = listPrintersPS();
  const printer = resolvePrinter(cfg);
  const sumatra = detectSumatra(cfg);
  console.log(JSON.stringify({
    ok: true,
    server: cfg.serverUrl,
    shop: info.shopName,
    statuses: cfg.statuses,
    pollMs: cfg.pollMs,
    printers,
    selectedPrinter: printer.name,
    sumatra: sumatra || null,
    sumatraMissing: !sumatra,
    note: sumatra ? 'Ready' : 'SumatraPDF install karna recommended hai for PDF/duplex/copies reliability'
  }, null, 2));
}

async function cmdPrinters() {
  const printers = listPrintersPS();
  console.log(printers.length ? printers.join(os.EOL) : 'No printers found');
}

async function cmdRun(cfg) {
  if (!cfg.serverUrl) throw new Error('PRINT_SERVER_URL missing');
  if (!cfg.agentKey) throw new Error('PRINT_AGENT_KEY missing');
  fs.mkdirSync(cfg.spoolDir, { recursive: true });
  log(cfg, 'AGENT START', `${cfg.serverUrl} | statuses=${cfg.statuses.join(',')} | printer=${cfg.printer || '(default)'}`);
  const info = await api(cfg, '/api/agent/config').catch((e) => { throw new Error('Server/auth check failed: ' + e.message); });
  log(cfg, 'SERVER OK', info.shopName || 'shop');

  do {
    if (!printing) {
      printing = true;
      try { await pollOnce(cfg); }
      catch (e) { log(cfg, 'POLL ERROR', e.message); }
      finally { printing = false; }
    }
    if (once) break;
    await new Promise(r => setTimeout(r, cfg.pollMs));
  } while (true);
}

(async () => {
  const cfg = loadConfig();
  if (cmd === 'test') return cmdTest(cfg);
  if (cmd === 'printers') return cmdPrinters(cfg);
  if (cmd === 'run') return cmdRun(cfg);
  console.log(`Usage:
  node agent.js test --config agent-config.json
  node agent.js printers
  node agent.js run --config agent-config.json
  node agent.js run --once --dry-run --config agent-config.json`);
  process.exit(cmd === 'help' || cmd === '--help' ? 0 : 1);
})().catch((e) => {
  console.error('Agent error:', e.message);
  process.exit(1);
});
