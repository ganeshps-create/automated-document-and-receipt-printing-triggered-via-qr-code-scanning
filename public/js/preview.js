/* Step 3: preview, page range, print options and mini-print. */

function goToPreview() {
  hideAllSections(); show('secPreviewStep');
  setStep(3);
  S.previewIdx = 0;
  updatePreviewUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updatePreviewUI() {
  const total = S.pages.length;
  if (S.previewIdx >= total) S.previewIdx = 0;
  document.getElementById('pvPagesPill').textContent = billUnits() + (billUnits() === 1 ? ' Page' : ' Pages');
  document.getElementById('rangeTotalPages').textContent = String(total);
  document.getElementById('curPgNum').textContent = String(S.previewIdx + 1);
  document.getElementById('totalPgNum').textContent = String(total);
  document.getElementById('previewPageNav').style.display = total > 1 ? 'flex' : 'none';
  document.getElementById('prevPgBtn').disabled = S.previewIdx <= 0;
  document.getElementById('nextPgBtn').disabled = S.previewIdx >= total - 1;
  const many = total > 1;
  document.getElementById('pageRangeBox').style.display = many ? 'block' : 'none';
  document.getElementById('duplexRow').style.display = many || S.pages.length > 0 ? 'block' : 'none';
  document.getElementById('rangeAllBtn').classList.toggle('on', S.pageRangeMode === 'all');
  document.getElementById('rangeCustomBtn').classList.toggle('on', S.pageRangeMode === 'custom');
  document.getElementById('rangeInput').classList.toggle('hidden', S.pageRangeMode !== 'custom');
  document.getElementById('optBW').classList.toggle('sel', S.colorMode === 'bw');
  document.getElementById('optColor').classList.toggle('sel', S.colorMode === 'color');
  document.getElementById('optBWPrice').textContent = money(S.shop && S.shop.price_bw) + '/page';
  document.getElementById('optColorPrice').textContent = money(S.shop && S.shop.price_color) + '/page';
  document.getElementById('optDuplex').classList.toggle('sel', S.duplex);
  document.getElementById('duplexNote').textContent = S.duplex ? 'Dono side print hoga' : 'Ek side print hoga';
  document.getElementById('duplexCopyNote').style.display = S.duplex ? 'block' : 'none';
  const miniBtn = document.getElementById('miniEntryBtn');
  if (miniBtn) miniBtn.classList.toggle('on', S.mini.n > 1);
  renderPreviewImage();
}

function renderPreviewImage() {
  const img = document.getElementById('finalPreviewImg');
  const canvas = renderPageCanvas(S.previewIdx, true);
  img.src = canvas.toDataURL('image/jpeg', 0.86);
}

function changePreviewPage(delta) {
  const n = S.previewIdx + delta;
  if (n < 0 || n >= S.pages.length) return;
  S.previewIdx = n;
  updatePreviewUI();
}

function setPageRangeMode(mode) {
  S.pageRangeMode = mode;
  if (mode === 'custom') {
    document.getElementById('rangeInput').classList.remove('hidden');
    document.getElementById('rangeInput').focus();
  } else {
    S.selectedPages = null;
  }
  updatePreviewUI();
}

function updateRangeFromInput() {
  const raw = document.getElementById('rangeInput').value || '';
  const picked = new Set();
  const parts = raw.split(',').map(x => x.trim()).filter(Boolean);
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const n = Number(part) - 1;
      if (n >= 0 && n < S.pages.length) picked.add(n);
    } else if (/^\d+\s*-\s*\d+$/.test(part)) {
      const mm = part.match(/(\d+)\s*-\s*(\d+)/);
      let a = Number(mm[1]) - 1, b = Number(mm[2]) - 1;
      if (a > b) { const t = a; a = b; b = t; }
      for (let i = Math.max(0, a); i <= Math.min(S.pages.length - 1, b); i++) picked.add(i);
    }
  }
  S.selectedPages = Array.from(picked).sort((a, b) => a - b);
  if (!S.selectedPages.length && raw.trim()) {
    toast('Jaise likho: 1,3,5-7');
  }
  updatePreviewUI();
}

function setColorMode(mode) {
  S.colorMode = mode === 'color' ? 'color' : 'bw';
  updatePreviewUI();
}

function toggleDuplex() {
  S.duplex = !S.duplex;
  if (S.duplex) S.copies = 1;
  updatePreviewUI();
  toast(S.duplex ? 'Duplex print on' : 'Duplex print off');
}

function backToEditor() {
  hideAllSections(); show('secEditor');
  setStep(2);
  renderEditor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToOptions() {
  hideAllSections(); show('secPayment');
  setStep(4);
  if (S.duplex) S.copies = 1;
  updatePriceSummary();
  updatePayNote();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function backToOptions() { goToPreview(); }

/* ── Mini Print ─────────────────────────────────────────────── */
function initMini() {
  const box = document.getElementById('miniOpts');
  box.innerHTML = '';
  [1, 2, 4, 6, 8, 9].forEach((n) => {
    const b = document.createElement('button');
    b.className = 'mini-opt' + (S.mini.n === n ? ' sel' : '');
    b.innerHTML = '<b>' + n + '</b><span>' + (n === 1 ? 'Normal' : 'pages/sheet') + '</span>';
    b.onclick = () => setMiniN(n);
    box.appendChild(b);
  });
  document.getElementById('miniOriP').classList.toggle('sel', S.mini.orient !== 'landscape');
  document.getElementById('miniOriL').classList.toggle('sel', S.mini.orient === 'landscape');
  document.getElementById('miniOriHint').classList.toggle('off', S.mini.n === 1);
  document.getElementById('miniBorderBtn').classList.toggle('on', S.mini.border);
  renderMini();
}

function goToMini() { hideAllSections(); show('secMini'); setStep(3); initMini(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function setMiniN(n) { S.mini.n = n; initMini(); }
function setMiniOrient(o) { S.mini.orient = o; initMini(); }
function toggleMiniBorder() { S.mini.border = !S.mini.border; initMini(); }

function miniBack() { goToPreview(); }

function miniConfirm() {
  goToOptions();
  toast(S.mini.n > 1 ? 'Mini Print lag gaya' : 'Normal print');
}

function renderMini() {
  const n = Math.max(1, S.mini.n);
  const sheets = Math.ceil(Math.max(1, pageIndices().length) / n);
  document.getElementById('miniSummary').innerHTML =
    '<b>' + pageIndices().length + '</b> page → <b>' + sheets + '</b> sheet' +
    (n > 1 ? '<br>≈ ' + Math.round((1 - 1 / n) * 100) + '% kagaz bachat' : '<br>Normal print — har page ek sheet');
  const landscape = S.mini.orient === 'landscape';
  const W = landscape ? 594 : 420;
  const H = landscape ? 420 : 594;
  const layouts = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3] };
  let [cols, rows] = layouts[n] || [1, 1];
  if (landscape && cols !== rows) { const t = cols; cols = rows; rows = t; }
  const sheet = document.createElement('canvas');
  sheet.width = W; sheet.height = H;
  const ctx = sheet.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const margin = 16, gap = 8;
  const cw = (W - margin * 2 - gap * (cols - 1)) / cols;
  const ch = (H - margin * 2 - gap * (rows - 1)) / rows;
  const indices = pageIndices();
  for (let i = 0; i < cols * rows; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x = margin + col * (cw + gap), y = margin + row * (ch + gap);
    if (S.mini.border) {
      ctx.strokeStyle = '#d5d5e0'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    }
    const pi = indices[i];
    if (pi === undefined) continue;
    const src = renderPageCanvas(pi, false);
    const ratio = Math.min(cw / src.width, ch / src.height);
    const dw = src.width * ratio, dh = src.height * ratio;
    ctx.drawImage(src, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
  }
  const box = document.getElementById('miniPreview');
  box.innerHTML = '';
  const img = document.createElement('img');
  img.src = sheet.toDataURL('image/jpeg', 0.82);
  img.alt = 'mini preview';
  box.appendChild(img);
}
