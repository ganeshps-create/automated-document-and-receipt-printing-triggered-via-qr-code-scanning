/* Boot: shop config, header, service list, drag & drop, payment return. */

const SERVICES = [
  { id: 'doc', icon: '📄', title: 'Document Print', sub: 'PDF, photo · A4', paper: 'a4' },
  { id: 'resume', icon: '📝', title: 'Resume Print', sub: 'Saaf aur sharp A4', paper: 'a4' },
  { id: 'photo', icon: '📷', title: '4×6 Photo', sub: 'Photo sheet printing', paper: '4x6' },
  { id: 'big', icon: '📐', title: 'Big Size', sub: 'A3 aur bade size', paper: 'a3' }
];

function renderHeader() {
  const shop = S.shop || {};
  document.getElementById('shopName').textContent = shop.name || 'QR Se Print';
  document.getElementById('shopAddr').textContent = shop.address || '';
  document.getElementById('priceBWBadge').textContent = 'B&W: ₹' + (shop.price_bw || 0) + '/page';
  document.getElementById('priceColorBadge').textContent = 'Color: ₹' + (shop.price_color || 0) + '/page';
  document.getElementById('poweredByName').textContent = shop.name || 'QR Se Print';
  if (shop.logo) {
    const box = document.getElementById('shopIconBox');
    box.innerHTML = '<img src="' + shop.logo + '" alt="logo">';
  }
  document.getElementById('footerLegal').innerHTML =
    '© ' + new Date().getFullYear() + ' ' + (shop.name || 'QR Se Print') + ' · All Rights Reserved<br>Developed by Rupesh Kumar Mahato';
}

function renderServices() {
  const menu = document.getElementById('svcMenu');
  if (!menu) return;
  menu.innerHTML = '';
  SERVICES.forEach((svc) => {
    const card = document.createElement('div');
    card.className = 'svc-card' + (S.service === svc.id ? ' sel' : '');
    card.setAttribute('data-svc', svc.id);
    card.innerHTML =
      '<div>' + svc.icon + '</div><div>' + svc.title + '</div><div>' + svc.sub + '</div>';
    card.addEventListener('click', () => selectService(svc));
    menu.appendChild(card);
  });
}

function selectService(svc) {
  S.service = svc.id;
  S.paper = svc.paper;
  const sel = document.getElementById('paperSizeSel');
  if (sel) sel.value = svc.paper;
  renderServices();
  toast(svc.title + ' selected');
}

function openShopInfo() {
  const s = S.shop || {};
  const rows = [
    ['Shop', s.name || '—'],
    ['Address', s.address || '—'],
    ['B&W', money(s.price_bw) + '/page'],
    ['Color', money(s.price_color) + '/page'],
    ['Duplex B&W', money(s.price_bw_duplex || s.price_bw) + '/page'],
    ['Duplex Color', money(s.price_color_duplex || s.price_color) + '/page'],
    ['Payment', s.payment_mode === 'online_only' ? 'Online only' : s.payment_mode === 'counter_only' ? 'Counter only' : 'Online + Counter']
  ];
  if (s.phone) rows.push(['Phone', s.phone]);
  if (s.email) rows.push(['Email', s.email]);
  const box = document.getElementById('shopInfoBox');
  box.innerHTML = '<h3>ⓘ Shop Info</h3>' + rows.map(r =>
    '<div class="si-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'
  ).join('') + '<button class="si-x" onclick="closeShopInfo()">Band karo</button>';
  document.getElementById('shopInfoModal').classList.add('show');
}

function closeShopInfo() { document.getElementById('shopInfoModal').classList.remove('show'); }

function bindDropZone() {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) handleFileUpload({ files: files, value: '' });
  });
}

async function handlePaymentReturn() {
  const params = new URLSearchParams(location.search);
  const cf = params.get('cf');
  const pf = params.get('pf');
  if (!cf && !pf) return;
  const saved = sessionStorage.getItem('qsp_job');
  if (!saved) return;
  try {
    S.job = JSON.parse(saved);
    S.orderNo = S.job.orderNo;
    if (cf) {
      const st = await api('/api/payment/cashfree/status', { method: 'POST', body: { orderId: cf } });
      if (st.status === 'paid') showSuccess('online');
      else toast('Payment pending hai — shop par order ' + S.orderNo + ' batao');
    } else {
      toast('Payment wapas aaya — status check karo');
    }
  } catch (e) { toast(e.message || 'Payment status check nahi hua'); }
}

async function init() {
  if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
  }
  await loadShopConfig();
  renderHeader();
  renderServices();
  bindDropZone();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('shopInfoModal').classList.remove('show');
      document.getElementById('cropOverlay').classList.add('hidden');
      if (!document.getElementById('pwOverlay').classList.contains('hidden')) cancelPdfPassword();
    }
  });
  await handlePaymentReturn();
}

init().catch((e) => {
  console.error(e);
  toast('App load nahi hua: ' + (e.message || e));
});
