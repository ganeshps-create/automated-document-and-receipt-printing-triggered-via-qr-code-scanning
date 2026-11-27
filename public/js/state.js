/* Global application state and small shared helpers. */
window.S = {
  shopId: (location.pathname.split('/').filter(Boolean).pop() || 'SHOP_DA35DAB7'),
  shop: null,
  paymentConfig: null,
  files: [],            // { name, size, file, type }
  pages: [],            // { items: [] }
  activePage: 0,
  previewIdx: 0,
  colorMode: 'bw',
  duplex: false,
  copies: 1,
  pageRangeMode: 'all',
  selectedPages: null,  // array of 0-based indices, null = all
  paper: 'a4',
  orientation: 'portrait',
  service: 'doc',
  cutLines: false,
  borderOn: false,
  borderW: 4,
  lastZoom: 26,
  mini: { n: 1, orient: 'auto', border: true },
  upload: { uploadId: null, token: null, expires: 0 },
  job: null,
  orderNo: null,
  payMethod: 'counter',
  busy: false
};

const PAPER_SIZES = {
  '4x6': [101.6, 152.4],
  a4: [210, 297],
  a5: [148, 210],
  letter: [216, 279],
  legal: [216, 356],
  a3: [297, 420],
  a2: [420, 594],
  a1: [594, 841]
};

function money(n) {
  const v = Number(n) || 0;
  return '₹' + (Number.isInteger(v) ? v : v.toFixed(2));
}

function toast(msg, ms) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = String(msg || '');
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms || 2800);
}

function show(id) { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
function hide(id) { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }

function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('s' + i);
    if (!el) continue;
    el.classList.toggle('active', i === n);
    el.classList.toggle('done', i < n);
    const dot = el.querySelector('.dot');
    if (dot) dot.textContent = i < n ? '✓' : String(i);
  }
}

function hideAllSections() {
  ['secUpload', 'secChoice', 'secEditor', 'secPreviewStep', 'secMini', 'secPayment', 'secSuccess'].forEach(hide);
}

function paperRatio() {
  const dim = PAPER_SIZES[S.paper] || PAPER_SIZES.a4;
  let [w, h] = dim;
  if (S.orientation === 'landscape') { const t = w; w = h; h = t; }
  return h / w;
}

function canvasSize() {
  const w = 280;
  return { w: w, h: Math.round(w * paperRatio()) };
}

function renderScale() { return 4; }

function pageIndices() {
  if (S.pageRangeMode === 'custom' && Array.isArray(S.selectedPages) && S.selectedPages.length) {
    return S.selectedPages.filter(i => i >= 0 && i < S.pages.length);
  }
  return S.pages.map((_, i) => i);
}

function billUnits() {
  const count = Math.max(1, pageIndices().length);
  if (S.mini && S.mini.n > 1) return Math.ceil(count / S.mini.n);
  return count;
}

function ratePerUnit() {
  const shop = S.shop || {};
  const color = S.colorMode === 'color';
  if (S.duplex) return Number(color ? (shop.price_color_duplex || shop.price_color) : (shop.price_bw_duplex || shop.price_bw)) || 0;
  return Number(color ? shop.price_color : shop.price_bw) || 0;
}

function currentTotal() {
  return Math.round(ratePerUnit() * billUnits() * S.copies * 100) / 100;
}

function resetJobState() {
  S.job = null; S.orderNo = null;
  S.upload = { uploadId: null, token: null, expires: 0 };
}
