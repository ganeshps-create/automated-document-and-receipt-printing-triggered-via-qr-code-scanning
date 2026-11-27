/* Upload, PDF rendering and password-protected PDF handling. */

const MAX_PAGES = 60;
let pwResolver = null;

function promptPdfPassword(fileName, wrongCount) {
  return new Promise((resolve, reject) => {
    pwResolver = { resolve: resolve, reject: reject };
    document.getElementById('pwFileName').textContent = fileName;
    const err = document.getElementById('pwErr');
    if (wrongCount > 0) {
      err.textContent = 'Galat password. ' + (3 - wrongCount) + ' baaki hain.';
      err.classList.remove('hidden');
    } else {
      err.classList.add('hidden');
    }
    const input = document.getElementById('pwInput');
    input.value = '';
    document.getElementById('pwOverlay').classList.remove('hidden');
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 60);
  });
}

function closePwOverlay() {
  document.getElementById('pwOverlay').classList.add('hidden');
  pwResolver = null;
}

function submitPdfPassword() {
  if (!pwResolver) return;
  const val = document.getElementById('pwInput').value;
  const r = pwResolver;
  pwResolver = null;
  closePwOverlay();
  r.resolve(val);
}

function cancelPdfPassword() {
  if (!pwResolver) return;
  const r = pwResolver;
  pwResolver = null;
  closePwOverlay();
  const err = new Error('Password cancelled');
  err.cancelled = true;
  r.reject(err);
}

function togglePwVisible() {
  const input = document.getElementById('pwInput');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function onPwKeyDown(e) { if (e.key === 'Enter') submitPdfPassword(); }

async function openPdfFile(file) {
  const buffer = await file.arrayBuffer();
  let password = '';
  let wrong = 0;
  while (true) {
    const task = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      password: password || undefined,
      useSystemFonts: true
    });
    try {
      return await task.promise;
    } catch (err) {
      const locked = err && (err.name === 'PasswordException' || /password/i.test(err.message || ''));
      if (!locked || wrong >= 2) throw err;
      wrong++;
      try {
        password = await promptPdfPassword(file.name, wrong);
      } catch (e) {
        const cancelled = new Error('PDF password cancelled');
        cancelled.cancelled = true;
        throw cancelled;
      }
    }
  }
}

async function renderPdfCanvases(file) {
  const pdf = await openPdfFile(file);
  if (pdf.numPages > MAX_PAGES) {
    throw new Error('Is file me ' + pdf.numPages + ' pages hain — sirf ' + MAX_PAGES + ' pages tak support hain.');
  }
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3.2, Math.sqrt(16000000 / Math.max(1, base.width * base.height)));
    const vp = page.getViewport({ scale: scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(canvas);
  }
  try { await pdf.destroy(); } catch (e) {}
  return out;
}

function loadImageCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxPx = 16000000;
      let w = img.naturalWidth || 800, h = img.naturalHeight || 800;
      const scale = Math.min(1, Math.sqrt(maxPx / Math.max(1, w * h)));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(file.name + ' image load nahi hui')); };
    img.src = url;
  });
}

async function textFileCanvas(file) {
  const text = await file.text();
  const canvas = document.createElement('canvas');
  canvas.width = 1240; canvas.height = 1754;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#15151f';
  ctx.font = '28px sans-serif';
  const lines = text.replace(/\t/g, '    ').split(/\r?\n/);
  let y = 90;
  for (const line of lines) {
    if (y > canvas.height - 70) break;
    ctx.fillText(line.slice(0, 120), 80, y);
    y += 42;
  }
  return canvas;
}

async function fileToCanvases(file) {
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return renderPdfCanvases(file);
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(name)) return [await loadImageCanvas(file)];
  if (name.endsWith('.txt')) return [await textFileCanvas(file)];
  throw new Error(file.name + ' supported nahi hai. PDF, JPG, PNG bhejo.');
}

function validateFiles(files) {
  const maxFile = (S.paymentConfig && S.paymentConfig.maxFile) || 60 * 1024 * 1024;
  const maxTotal = (S.paymentConfig && S.paymentConfig.maxTotal) || 200 * 1024 * 1024;
  let total = 0;
  for (const f of files) {
    if (f.size > maxFile) throw new Error(f.name + ' bahut bada hai (max ' + Math.round(maxFile / 1024 / 1024) + ' MB)');
    total += f.size;
  }
  if (total > maxTotal) throw new Error('Sab files milke ' + Math.round(maxTotal / 1024 / 1024) + ' MB se kam honi chahiye');
}

async function handleFileUpload(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length || S.busy) return;
  S.busy = true;
  try {
    validateFiles(files);
    toast('File padh raha hain…');
    const canvases = [];
    for (const f of files) {
      const made = await fileToCanvases(f);
      canvases.push.apply(canvases, made);
      S.files.push({ name: f.name, size: f.size, file: f, type: f.type });
    }
    if (!canvases.length) throw new Error('Koi page nahi mila');
    for (const c of canvases) S.pages.push(createPageFromCanvas(c));
    S.activePage = 0;
    S.previewIdx = 0;
    renderChoice();
    hideAllSections(); show('secChoice');
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    if (!err.cancelled) toast(err.message || 'File upload nahi hua');
  } finally {
    S.busy = false;
  }
}

function renderChoice() {
  const sub = document.getElementById('choiceSub');
  const count = S.pages.length;
  sub.textContent = S.files.length + ' file · ' + count + (count === 1 ? ' page' : ' pages');
  const canvas = document.getElementById('choiceCanvas');
  const src = renderPageCanvas(S.activePage, 1);
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.getContext('2d').drawImage(src, 0, 0);
}

function chooseAllGood() { goToPreview(); }

function chooseEdit() {
  hide('secChoice');
  hideAllSections(); show('secEditor');
  setStep(2);
  renderEditor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function backToUpload() {
  hideAllSections(); show('secUpload');
  setStep(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function triggerAddDocument() { document.getElementById('addDocInput').click(); }

async function handleAddDocument(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length || S.busy) return;
  S.busy = true;
  try {
    validateFiles(files);
    const page = S.pages[S.activePage];
    if (!page) return;
    for (const f of files) {
      const canvases = await fileToCanvases(f);
      S.files.push({ name: f.name, size: f.size, file: f, type: f.type });
      canvases.forEach((c) => page.items.push(createItem(c, true)));
    }
    renderEditor();
    toast('Document jod diya gaya');
  } catch (err) {
    if (!err.cancelled) toast(err.message || 'Document nahi joda ja saka');
  } finally {
    S.busy = false;
  }
}
