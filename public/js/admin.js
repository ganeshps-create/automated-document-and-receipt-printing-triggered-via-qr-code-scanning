/* Shop admin: login, live print queue, print dialog and status updates. */

const ADMIN_KEY = 'qsp_admin_token';
let adminToken = '';
let adminFilter = 'all';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(ts) {
  const n = Number(ts) || 0;
  if (!n) return '—';
  const d = new Date(n);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function adminFetch(path, options) {
  const opts = Object.assign({ method: 'GET' }, options || {});
  const headers = Object.assign({}, opts.headers || {});
  if (adminToken && !opts.skipAuth) headers.Authorization = 'Bearer ' + adminToken;
  let body;
  if (opts.body !== undefined && opts.body !== null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method: opts.method, headers, body, cache: 'no-store' });
  if (opts.raw) return res;
  if (res.status === 401) {
    adminToken = '';
    try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
    showAdminLogin();
  }
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
  return data;
}

function showAdminLogin() {
  document.getElementById('adminLogin').classList.remove('hidden');
  document.getElementById('adminApp').classList.add('hidden');
  document.getElementById('adminLogoutBtn').style.display = 'none';
}

function showAdminApp() {
  document.getElementById('adminLogin').classList.add('hidden');
  document.getElementById('adminApp').classList.remove('hidden');
  document.getElementById('adminLogoutBtn').style.display = 'block';
}

async function adminLoginSubmit() {
  const pw = document.getElementById('adminPw').value;
  const err = document.getElementById('adminLoginErr');
  err.classList.add('hidden');
  try {
    const data = await adminFetch('/api/admin/login', {
      method: 'POST', body: { password: pw }, skipAuth: true
    });
    adminToken = data.token;
    try { sessionStorage.setItem(ADMIN_KEY, adminToken); } catch (e) {}
    document.getElementById('adminShopName').textContent = (data.shopName || 'Shop') + ' · Print Queue';
    showAdminApp();
    await loadAdminJobs();
  } catch (e) {
    err.textContent = e.message || 'Login nahi hua';
    err.classList.remove('hidden');
  }
}

function adminLogout() {
  adminToken = '';
  try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
  document.getElementById('adminPw').value = '';
  showAdminLogin();
}

function setAdminFilter(f) {
  adminFilter = f;
  document.querySelectorAll('#adminFilters .chip').forEach((b) => {
    b.classList.toggle('on', b.getAttribute('data-f') === f);
  });
  renderAdminJobs(window.__adminJobs || []);
}

function renderAdminStats(jobs) {
  const counts = {
    all: jobs.length,
    pending: jobs.filter(j => ['awaiting_payment', 'counter_pending', 'upi_pending'].includes(j.status)).length,
    paid: jobs.filter(j => j.status === 'paid').length,
    printed: jobs.filter(j => j.status === 'printed').length
  };
  document.getElementById('adminStats').innerHTML =
    '<div class="stat"><b>' + counts.all + '</b><span>Kul Order</span></div>' +
    '<div class="stat pending"><b>' + counts.pending + '</b><span>Pending</span></div>' +
    '<div class="stat paid"><b>' + counts.paid + '</b><span>Paid</span></div>' +
    '<div class="stat printed"><b>' + counts.printed + '</b><span>Printed</span></div>';
}

async function loadAdminJobs() {
  const data = await adminFetch('/api/admin/jobs');
  window.__adminJobs = data.jobs || [];
  document.getElementById('adminShopName').textContent = (data.shopName || 'Shop') + ' · Print Queue';
  renderAdminStats(window.__adminJobs);
  renderAdminJobs(window.__adminJobs);
}

function renderAdminJobs(jobs) {
  const box = document.getElementById('adminJobs');
  const list = adminFilter === 'all' ? jobs : jobs.filter(j => j.status === adminFilter);
  if (!list.length) {
    box.innerHTML = '<div class="admin-empty">Is filter me koi order nahi hai.</div>';
    return;
  }
  box.innerHTML = list.map((j) => {
    const id = esc(j.id);
    const tags = [
      j.pages + ' page',
      j.copies > 1 ? j.copies + ' copies' : '1 copy',
      j.colorMode === 'color' ? 'Color' : 'B&W',
      j.duplex ? 'Duplex' : 'Single side',
      j.mini && j.mini.n > 1 ? j.mini.n + ' mini/sheet' : null,
      j.pageRange && j.pageRange !== 'all' ? 'Pages: ' + j.pageRange : null,
      j.utr ? 'UTR: ' + j.utr : null
    ].filter(Boolean).map(t => '<span class="job-tag">' + esc(t) + '</span>').join('');
    const file = (j.files && j.files[0] && j.files[0].name) || 'No file';
    const canPay = ['awaiting_payment', 'counter_pending', 'upi_pending'].includes(j.status);
    const canPrint = !!(j.files && j.files.length);
    return '<div class="job-card">' +
      '<div class="job-top"><div><div class="job-no">Order ' + esc(j.orderNo) + '</div>' +
      '<div class="job-time">' + esc(fmtTime(j.created)) + ' · ' + esc(id) + '</div></div>' +
      '<span class="badge ' + esc(j.status) + '">' + esc(j.status.replace(/_/g, ' ')) + '</span></div>' +
      '<div class="job-meta">' + tags + '</div>' +
      '<div class="job-amt">' + esc('₹' + j.amount) + '</div>' +
      '<div class="job-file">📎 ' + esc(file) + '</div>' +
      '<div class="job-actions">' +
        (canPrint ? '<button class="job-btn primary" onclick="printJob(\'' + id + '\',this)">🖨️ Print</button>' : '') +
        (canPay ? '<button class="job-btn ok" onclick="setJobStatus(\'' + id + '\',\'paid\',this)">✓ Mark Paid</button>' : '') +
        (j.status !== 'printed' ? '<button class="job-btn" onclick="setJobStatus(\'' + id + '\',\'printed\',this)">📦 Mark Printed</button>' : '') +
        (j.status !== 'cancelled' && j.status !== 'printed' ? '<button class="job-btn" onclick="setJobStatus(\'' + id + '\',\'cancelled\',this)">✕ Cancel</button>' : '') +
      '</div></div>';
  }).join('');
}

async function setJobStatus(jobId, status, btn) {
  if (btn) btn.disabled = true;
  try {
    await adminFetch('/api/admin/jobs/' + encodeURIComponent(jobId) + '/status', {
      method: 'POST', body: { status }
    });
    toast('Status update ho gaya: ' + status);
    await loadAdminJobs();
  } catch (e) {
    toast(e.message || 'Status update nahi hua');
    if (btn) btn.disabled = false;
  }
}

async function printJob(jobId, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await adminFetch('/api/admin/jobs/' + encodeURIComponent(jobId) + '/file', { raw: true });
    if (!res.ok) {
      let d = {}; try { d = await res.json(); } catch (e) {}
      throw new Error(d.error || ('File fetch failed (' + res.status + ')'));
    }
    const blob = await res.blob();
    const job = (window.__adminJobs || []).find(j => j.id === jobId) || {};
    const name = (job.files && job.files[0] && job.files[0].name) || 'print.pdf';
    const ext = String(name.split('.').pop() || '').toLowerCase();
    const url = URL.createObjectURL(blob);

    const w = window.open('', '_blank');
    if (!w) { toast('Popup block ho gaya — browser me allow karo'); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print ' + esc(name) + '</title>' +
      '<style>@page{margin:0}body{margin:0;background:#fff}#s{padding:20px;font:13px sans-serif;color:#666}' +
      'iframe{border:0;width:100%;height:100vh;display:block}img{max-width:100%;display:block;margin:0 auto}</style>' +
      '</head><body><div id="s">Print tayyar ho raha hai…</div></body></html>');
    w.document.close();
    setTimeout(() => {
      const s = w.document.getElementById('s');
      if (!s) return;
      s.innerHTML = ext === 'pdf'
        ? '<iframe src="' + url + '"></iframe>'
        : '<img src="' + url + '">';
      setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 600);
    }, 80);
  } catch (e) {
    toast(e.message || 'Print nahi ho saka');
  } finally {
    if (btn) btn.disabled = false;
  }
}

(async function initAdmin() {
  try {
    adminToken = sessionStorage.getItem(ADMIN_KEY) || '';
    if (adminToken) {
      await loadAdminJobs();
      showAdminApp();
    } else {
      showAdminLogin();
    }
  } catch (e) {
    showAdminLogin();
  }
  setInterval(() => {
    if (adminToken) loadAdminJobs().catch(() => {});
  }, 15000);
})();
