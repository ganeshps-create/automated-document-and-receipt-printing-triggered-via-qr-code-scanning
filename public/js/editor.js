/* A4 canvas editor: move / resize / zoom / rotate / adjust / crop / borders. */

let cropState = null;
let dragState = null;
let pinchState = null;

function createItem(canvas, secondary) {
  const size = canvasSize();
  const ratio = canvas.width / Math.max(1, canvas.height);
  let w = size.w * (secondary ? 0.55 : 0.92);
  let h = w / ratio;
  const maxH = size.h * (secondary ? 0.66 : 0.92);
  if (h > maxH) { h = maxH; w = h * ratio; }
  return {
    id: 'it_' + Math.random().toString(36).slice(2, 10),
    sourceCanvas: canvas,
    workingCanvas: canvas,
    x: (size.w - w) / 2 + (secondary ? size.w * 0.06 : 0),
    y: (size.h - h) / 2 + (secondary ? size.h * 0.06 : 0),
    w: w, h: h,
    rotation: 0, brightness: 0, contrast: 0,
    borderOn: false, borderW: 4,
    el: null
  };
}

function createPageFromCanvas(canvas) { return { items: [createItem(canvas, false)], activeItemId: null }; }

function activePageObj() { return S.pages[S.activePage] || null; }

function activeItem() {
  const page = activePageObj();
  if (!page) return null;
  return page.items.find(i => i.id === page.activeItemId) || page.items[0] || null;
}

function getActivePageObj() { return activePageObj(); }

function renderEditor() {
  const size = canvasSize();
  const a4 = document.getElementById('a4Canvas');
  a4.style.width = size.w + 'px';
  a4.style.height = size.h + 'px';
  a4.innerHTML = '';
  const page = activePageObj();
  if (!page) return;
  page.items.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'canvas-doc' + (item.id === page.activeItemId ? ' active' : '');
    item.el = div;
    applyItemStyles(item);
    item.workingCanvas.style.filter = filterString(item);
    div.appendChild(item.workingCanvas);
    const rh = document.createElement('div');
    rh.className = 'resize-handle';
    rh.addEventListener('pointerdown', (e) => onItemPointerDown(e, item.id, 'resize'));
    div.appendChild(rh);
    const rm = document.createElement('div');
    rm.className = 'remove-item-handle';
    rm.textContent = '×';
    rm.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); removeItem(item.id); });
    div.appendChild(rm);
    div.addEventListener('pointerdown', (e) => onItemPointerDown(e, item.id, 'move'));
    a4.appendChild(div);
  });
  renderPageIndicator();
  updateToolButtons();
  bindPinch();
}

function filterString(item) {
  return 'brightness(' + (100 + (item.brightness || 0)) + '%) contrast(' + (100 + (item.contrast || 0)) + '%)';
}

function applyItemStyles(item) {
  if (!item || !item.el) return;
  item.el.style.left = item.x + 'px';
  item.el.style.top = item.y + 'px';
  item.el.style.width = item.w + 'px';
  item.el.style.height = item.h + 'px';
  item.el.style.transform = 'rotate(' + (item.rotation || 0) + 'deg)';
  item.el.style.outline = item.borderOn ? Math.max(1, item.borderW / 2) + 'px solid #000' : '';
  item.workingCanvas.style.filter = filterString(item);
}

function onItemPointerDown(e, itemId, mode) {
  if (e.button !== undefined && e.button !== 0) return;
  const page = activePageObj();
  const item = page && page.items.find(i => i.id === itemId);
  if (!item) return;
  e.preventDefault();
  e.stopPropagation();
  if (page.activeItemId !== itemId) {
    page.activeItemId = itemId;
    renderEditor();
  }
  dragState = {
    itemId: itemId, mode: mode,
    startX: e.clientX, startY: e.clientY,
    x: item.x, y: item.y, w: item.w, h: item.h
  };
  window.addEventListener('pointermove', onItemPointerMove);
  window.addEventListener('pointerup', onItemPointerUp, { once: true });
}

function onItemPointerMove(e) {
  if (!dragState) return;
  const item = activeItem();
  if (!item || item.id !== dragState.itemId) return;
  const rect = document.getElementById('a4Canvas').getBoundingClientRect();
  const size = canvasSize();
  const sx = size.w / Math.max(1, rect.width);
  const sy = size.h / Math.max(1, rect.height);
  const dx = (e.clientX - dragState.startX) * sx;
  const dy = (e.clientY - dragState.startY) * sy;
  if (dragState.mode === 'move') {
    item.x = Math.max(-item.w * 0.6, Math.min(size.w - item.w * 0.4, dragState.x + dx));
    item.y = Math.max(-item.h * 0.6, Math.min(size.h - item.h * 0.4, dragState.y + dy));
  } else {
    const ratio = dragState.w / Math.max(1, dragState.h);
    const nw = Math.max(40, dragState.w + dx);
    item.w = nw;
    item.h = nw / ratio;
  }
  applyItemStyles(item);
}

function onItemPointerUp() {
  dragState = null;
  window.removeEventListener('pointermove', onItemPointerMove);
}

function bindPinch() {
  const a4 = document.getElementById('a4Canvas');
  if (!a4 || a4._pinchBound) return;
  a4._pinchBound = true;
  a4.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchState = {
        d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
      };
    }
  }, { passive: true });
  a4.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchState) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchState.d > 0) scaleActiveItem(d / pinchState.d);
      pinchState.d = d;
      e.preventDefault();
    }
  }, { passive: false });
  a4.addEventListener('touchend', () => { pinchState = null; });
}

function scaleActiveItem(factor) {
  const item = activeItem();
  if (!item || !isFinite(factor) || factor <= 0) return;
  const f = Math.max(0.2, Math.min(5, factor));
  const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
  item.w *= f; item.h *= f;
  item.x = cx - item.w / 2; item.y = cy - item.h / 2;
  applyItemStyles(item);
}

function zoomSliderInput(v) {
  const item = activeItem();
  if (!item) return;
  const n = Number(v) || 26;
  scaleActiveItem(n / (S.lastZoom || 26));
  S.lastZoom = n;
}

function toolAutoA4() {
  const item = activeItem();
  if (!item) return;
  const size = canvasSize();
  const ratio = item.workingCanvas.width / Math.max(1, item.workingCanvas.height);
  let w = size.w * 0.92, h = w / ratio;
  if (h > size.h * 0.92) { h = size.h * 0.92; w = h * ratio; }
  item.w = w; item.h = h;
  item.x = (size.w - w) / 2; item.y = (size.h - h) / 2;
  item.rotation = 0;
  renderEditor();
  toast('Auto Fit ho gaya');
}

function toolToggleRotate() {
  document.getElementById('rotatePanel').classList.toggle('hidden');
  document.getElementById('rotateBtn').classList.add('on');
  const item = activeItem();
  const s = document.getElementById('rotSlider');
  if (item && s) s.value = String(((item.rotation + 180) % 360) - 180);
  const r = document.getElementById('rotVal');
  if (r && item) r.textContent = Math.round(item.rotation) + '°';
}

function onRotateSlider() {
  const item = activeItem();
  const v = Number(document.getElementById('rotSlider').value) || 0;
  document.getElementById('rotVal').textContent = v + '°';
  if (!item) return;
  item.rotation = v;
  applyItemStyles(item);
}

function nudgeRotation(delta) {
  const item = activeItem();
  if (!item) return;
  item.rotation = (item.rotation + delta) % 360;
  document.getElementById('rotSlider').value = String(Math.max(-180, Math.min(180, item.rotation)));
  document.getElementById('rotVal').textContent = Math.round(item.rotation) + '°';
  applyItemStyles(item);
}

function resetRotation() {
  const item = activeItem();
  if (!item) return;
  item.rotation = 0;
  document.getElementById('rotSlider').value = '0';
  document.getElementById('rotVal').textContent = '0°';
  applyItemStyles(item);
}

function toolToggleAdjust() {
  document.getElementById('adjustPanel').classList.toggle('hidden');
  document.getElementById('adjustBtn').classList.add('on');
  const item = activeItem();
  if (!item) return;
  document.getElementById('adjBrightness').value = String(item.brightness || 0);
  document.getElementById('adjContrast').value = String(item.contrast || 0);
  document.getElementById('adjBrightnessVal').textContent = String(item.brightness || 0);
  document.getElementById('adjContrastVal').textContent = String(item.contrast || 0);
}

function applyAdjustments() {
  const item = activeItem();
  if (!item) return;
  item.brightness = Number(document.getElementById('adjBrightness').value) || 0;
  item.contrast = Number(document.getElementById('adjContrast').value) || 0;
  document.getElementById('adjBrightnessVal').textContent = String(item.brightness);
  document.getElementById('adjContrastVal').textContent = String(item.contrast);
  applyItemStyles(item);
}

function resetAdjustments() {
  const item = activeItem();
  if (!item) return;
  item.brightness = 0; item.contrast = 0;
  document.getElementById('adjBrightness').value = '0';
  document.getElementById('adjContrast').value = '0';
  document.getElementById('adjBrightnessVal').textContent = '0';
  document.getElementById('adjContrastVal').textContent = '0';
  applyItemStyles(item);
}

function toolToggleBorder() {
  document.getElementById('borderPanel').classList.toggle('hidden');
  document.getElementById('borderBtn').classList.add('on');
  const item = activeItem();
  document.getElementById('borderToggleBtn').textContent = item && item.borderOn ? 'Band nahi' : 'Band hai';
}

function toggleBorderOn() {
  const item = activeItem();
  if (!item) return;
  item.borderOn = !item.borderOn;
  item.borderW = S.borderW;
  document.getElementById('borderToggleBtn').textContent = item.borderOn ? 'Band nahi' : 'Band hai';
  applyItemStyles(item);
}

function onBorderSlider() {
  const v = Number(document.getElementById('borderSlider').value) || 4;
  S.borderW = v;
  document.getElementById('borderVal').textContent = String(v);
  const item = activeItem();
  if (item && item.borderOn) { item.borderW = v; applyItemStyles(item); }
}

function toggleCutLines() {
  S.cutLines = !S.cutLines;
  const btn = document.getElementById('cutBtn');
  btn.textContent = S.cutLines ? '✂️ Cutting Line: On' : '✂️ Cutting Line: Off';
  btn.classList.toggle('on', S.cutLines);
}

function changePaperSize() {
  S.paper = document.getElementById('paperSizeSel').value;
  renderEditor();
}

function toggleOrientation() {
  S.orientation = S.orientation === 'portrait' ? 'landscape' : 'portrait';
  document.getElementById('orientBtn').textContent = S.orientation === 'portrait' ? '📄 Portrait' : '📃 Landscape';
  renderEditor();
}

function updateToolButtons() {
  const set = (id, on) => { const e = document.getElementById(id); if (e) e.classList.toggle('on', !!on); };
  set('rotateBtn', !document.getElementById('rotatePanel').classList.contains('hidden'));
  set('adjustBtn', !document.getElementById('adjustPanel').classList.contains('hidden'));
  set('borderBtn', !document.getElementById('borderPanel').classList.contains('hidden'));
  const item = activeItem();
  document.getElementById('borderToggleBtn').textContent = item && item.borderOn ? 'Band nahi' : 'Band hai';
}

function renderPageIndicator() {
  const label = document.getElementById('pageIndicator');
  label.textContent = 'Showing Page ' + (S.activePage + 1) + ' of ' + S.pages.length + ' Pages';
  const prev = document.getElementById('editorPrevBtn');
  const next = document.getElementById('editorNextBtn');
  prev.style.visibility = S.activePage > 0 ? 'visible' : 'hidden';
  next.style.visibility = S.activePage < S.pages.length - 1 ? 'visible' : 'hidden';
}

function changeEditorPage(delta) {
  const n = S.activePage + delta;
  if (n < 0 || n >= S.pages.length) return;
  S.activePage = n;
  renderEditor();
}

function removeItem(itemId) {
  const page = activePageObj();
  if (!page || page.items.length <= 1) { toast('Kam se kam ek document chahiye'); return; }
  page.items = page.items.filter(i => i.id !== itemId);
  if (page.activeItemId === itemId) page.activeItemId = page.items[0] && page.items[0].id;
  renderEditor();
}

/* ── High-quality page rendering (shared with preview, mini print, download) ── */
function renderPageCanvas(pageIndex, hiQuality) {
  const size = canvasSize();
  const s = hiQuality ? renderScale() : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size.w * s);
  canvas.height = Math.round(size.h * s);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const page = S.pages[pageIndex];
  if (!page) return canvas;
  page.items.forEach((item) => {
    ctx.save();
    ctx.translate((item.x + item.w / 2) * s, (item.y + item.h / 2) * s);
    ctx.rotate((item.rotation || 0) * Math.PI / 180);
    ctx.filter = filterString(item);
    ctx.drawImage(item.workingCanvas, -item.w * s / 2, -item.h * s / 2, item.w * s, item.h * s);
    ctx.filter = 'none';
    if (item.borderOn) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, (item.borderW || 4) * s);
      ctx.strokeRect(-item.w * s / 2, -item.h * s / 2, item.w * s, item.h * s);
    }
    ctx.restore();
  });
  if (S.cutLines) {
    ctx.save();
    ctx.strokeStyle = '#ec2a7a';
    ctx.setLineDash([8 * s, 5 * s]);
    ctx.lineWidth = Math.max(1, s);
    ctx.strokeRect(2 * s, 2 * s, canvas.width - 4 * s, canvas.height - 4 * s);
    ctx.restore();
  }
  return canvas;
}

/* ── Perspective crop (4-corner homography) ──────────────────── */
function toolPerspectiveCrop() {
  const item = activeItem();
  if (!item) { toast('Pehle koi document select karo'); return; }
  const stage = document.getElementById('cropStage');
  const cv = document.getElementById('cropCanvas');
  const src = item.workingCanvas;
  const maxW = Math.max(200, Math.min(720, stage.clientWidth - 24));
  const maxH = Math.max(200, Math.min(560, stage.clientHeight - 24));
  const scale = Math.min(maxW / src.width, maxH / src.height, 1);
  cv.width = Math.max(200, Math.round(src.width * scale));
  cv.height = Math.max(200, Math.round(src.height * scale));
  cv.style.width = cv.width + 'px';
  cv.style.height = cv.height + 'px';
  const pad = Math.round(Math.min(cv.width, cv.height) * 0.06);
  cropState = {
    item: item, src: src, scale: scale, drag: -1,
    quad: [[pad, pad], [cv.width - pad, pad], [cv.width - pad, cv.height - pad], [pad, cv.height - pad]]
  };
  drawCropOverlay();
  document.getElementById('cropOverlay').classList.remove('hidden');
}

function cropCancel() { document.getElementById('cropOverlay').classList.add('hidden'); cropState = null; }

function cropFullPhoto() {
  if (!cropState) return;
  const w = cropState.cvWidth || document.getElementById('cropCanvas').width;
  const h = cropState.cvHeight || document.getElementById('cropCanvas').height;
  cropState.quad = [[0, 0], [w, 0], [w, h], [0, h]];
  drawCropOverlay();
}

function drawCropOverlay() {
  if (!cropState) return;
  const cv = document.getElementById('cropCanvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(cropState.src, 0, 0, cv.width, cv.height);
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 3;
  ctx.beginPath();
  cropState.quad.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
  ctx.closePath();
  ctx.stroke();
  cropState.quad.forEach((p) => {
    ctx.beginPath(); ctx.arc(p[0], p[1], 15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(236,42,122,.9)'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  });
  if (!cv._cropBound) {
    cv._cropBound = true;
    cv.addEventListener('pointerdown', (e) => {
      if (!cropState) return;
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) * cv.width / r.width;
      const y = (e.clientY - r.top) * cv.height / r.height;
      let best = -1, bd = 1e9;
      cropState.quad.forEach((p, i) => {
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bd) { bd = d; best = i; }
      });
      cropState.drag = bd < 34 ? best : -1;
      if (cropState.drag >= 0) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cropState || cropState.drag < 0) return;
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) * cv.width / r.width;
      const y = (e.clientY - r.top) * cv.height / r.height;
      cropState.quad[cropState.drag] = [
        Math.max(0, Math.min(cv.width, x)),
        Math.max(0, Math.min(cv.height, y))
      ];
      drawCropOverlay();
    });
    cv.addEventListener('pointerup', () => { if (cropState) cropState.drag = -1; });
  }
}

function solveLinear(A, b, n) {
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('Crop geometry invalid');
    const tmp = M[col]; M[col] = M[pivot]; M[pivot] = tmp;
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b, 8);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('Crop geometry invalid');
  const k = 1 / det;
  return [
    (e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k,
    (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k,
    (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k
  ];
}

function cropApply() {
  if (!cropState) return;
  try {
    const quad = cropState.quad.map(p => [p[0] / cropState.scale, p[1] / cropState.scale]);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let W = Math.round((dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2);
    let H = Math.round((dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2);
    W = Math.max(20, Math.min(2400, W));
    H = Math.max(20, Math.min(2400, H));
    const inv = invert3(homography(quad, [[0, 0], [W, 0], [W, H], [0, H]]));
    const src = cropState.src;
    const sw = src.width, sh = src.height;
    const sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d');
    const od = octx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const den = inv[6] * x + inv[7] * y + inv[8];
        const u = (inv[0] * x + inv[1] * y + inv[2]) / den;
        const v = (inv[3] * x + inv[4] * y + inv[5]) / den;
        const idx = (y * W + x) * 4;
        if (u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) {
          od.data[idx] = 255; od.data[idx + 1] = 255; od.data[idx + 2] = 255; od.data[idx + 3] = 255;
          continue;
        }
        const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
        const p00 = (y0 * sw + x0) * 4, p10 = p00 + 4, p01 = p00 + sw * 4, p11 = p01 + 4;
        for (let ch = 0; ch < 4; ch++) {
          const a = sd[p00 + ch] * (1 - fx) + sd[p10 + ch] * fx;
          const b = sd[p01 + ch] * (1 - fx) + sd[p11 + ch] * fx;
          od.data[idx + ch] = a * (1 - fy) + b * fy;
        }
      }
    }
    octx.putImageData(od, 0, 0);
    cropState.item.workingCanvas = out;
    cropState.item.el.replaceChild(out, cropState.item.el.querySelector('canvas'));
    cropState.item.rotation = 0;
    cropApplyFit(cropState.item);
    cropCancel();
    renderEditor();
    toast('Perspective crop lag gaya');
  } catch (err) {
    toast(err.message || 'Crop nahi ho saka');
  }
}

function cropApplyFit(item) {
  const size = canvasSize();
  const ratio = item.workingCanvas.width / Math.max(1, item.workingCanvas.height);
  let w = size.w * 0.92, h = w / ratio;
  if (h > size.h * 0.92) { h = size.h * 0.92; w = h * ratio; }
  item.w = w; item.h = h;
  item.x = (size.w - w) / 2; item.y = (size.h - h) / 2;
}
