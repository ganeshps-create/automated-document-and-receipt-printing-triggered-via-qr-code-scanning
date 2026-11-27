/* Step 4: pricing, uploads, real payment gateway, success and feedback. */

function updatePriceSummary() {
  const rate = ratePerUnit();
  const units = billUnits();
  const total = currentTotal();
  document.getElementById('copiesNum').textContent = String(S.copies);
  document.getElementById('copiesCapNote').style.display = S.duplex ? 'block' : 'none';
  document.getElementById('sumType').textContent =
    (S.colorMode === 'color' ? 'Color' : 'B&W') + ' Print' + (S.duplex ? ' (Duplex)' : '') + (S.mini.n > 1 ? ' · Mini' : '');
  document.getElementById('sumPerPage').textContent = money(rate) + '/page';
  document.getElementById('sumPages').textContent =
    units + (units === 1 ? ' page' : ' pages') + (S.copies > 1 ? ' × ' + S.copies + ' copies' : '');
  document.getElementById('sumPagesAmt').textContent = money(rate * units);
  document.getElementById('sumTotal').textContent = money(total);
  document.getElementById('payConfirmAmt').textContent = '· ' + money(total);
}

function changeCopies(delta) {
  if (S.duplex) { toast('Manual duplex mein copies 1 hi rahegi'); return; }
  S.copies = Math.max(1, Math.min(100, S.copies + delta));
  updatePriceSummary();
}

function selectPayMethod(method) {
  S.payMethod = method === 'online' ? 'online' : 'counter';
  document.getElementById('pmCounter').classList.toggle('sel', S.payMethod === 'counter');
  document.getElementById('pmOnline').classList.toggle('sel', S.payMethod === 'online');
  updatePayNote();
}

function updatePayNote() {
  const cfg = S.paymentConfig || {};
  const note = document.getElementById('payNote');
  if (cfg.provider === 'demo') {
    note.textContent = 'Demo payment mode — asli payments ke liye .env me Razorpay/Cashfree keys daalo.';
  } else if (cfg.provider === 'razorpay') {
    note.textContent = '🔒 Razorpay se secure payment · ' + (cfg.mode === 'test' ? 'Test mode' : 'Live mode');
  } else {
    note.textContent = '🔒 Cashfree se secure payment · ' + (cfg.mode === 'test' ? 'Test mode' : 'Live mode');
  }
  const counterBtn = document.getElementById('pmCounter');
  const mode = (S.shop && S.shop.payment_mode) || 'both';
  counterBtn.disabled = mode === 'online_only';
  if (mode === 'online_only' && S.payMethod === 'counter') selectPayMethod('online');
  if (mode === 'counter_only') {
    document.getElementById('pmOnline').disabled = true;
    if (S.payMethod !== 'counter') selectPayMethod('counter');
  }
}

function setUploadProgress(pct) {
  document.getElementById('upProgWrap').style.display = 'block';
  document.getElementById('upProgBar').style.width = Math.round(pct * 100) + '%';
  document.getElementById('upProgPct').textContent = Math.round(pct * 100) + '%';
}

async function uploadAndConfirm() {
  const sign = await api('/api/upload/sign', { method: 'POST', body: { shopId: S.shopId } });
  S.upload = sign;
  const totalBytes = S.files.reduce((a, f) => a + (f.size || 0), 0) || 1;
  let doneBytes = 0;
  for (let i = 0; i < S.files.length; i++) {
    const f = S.files[i];
    await uploadFileToServer(f.file, sign, (part) => {
      setUploadProgress((doneBytes + (f.size || 0) * part) / totalBytes);
    });
    doneBytes += f.size || 0;
    setUploadProgress(doneBytes / totalBytes);
  }
  if (!S.files.length) {
    // Text-only / generated pages: send a tiny placeholder so the shop has a record.
    const blob = new File(['QR Se Print order'], 'order.txt', { type: 'text/plain' });
    await uploadFileToServer(blob, sign, (part) => setUploadProgress(part));
  }
  const result = await api('/api/upload/confirm', {
    method: 'POST',
    body: {
      uploadId: sign.uploadId,
      shopId: S.shopId,
      pages: pageIndices().length,
      copies: S.copies,
      colorMode: S.colorMode,
      duplex: S.duplex,
      mini: S.mini.n > 1 ? { n: S.mini.n, orient: S.mini.orient, border: S.mini.border } : null,
      pageRange: S.pageRangeMode === 'custom' ? (S.selectedPages || []).map(i => i + 1).join(',') : 'all',
      amount: currentTotal()
    }
  });
  S.job = result;
  S.orderNo = result.orderNo;
  try { sessionStorage.setItem('qsp_job', JSON.stringify(result)); } catch (e) {}
  return result;
}

async function confirmAndPay() {
  if (S.busy) return;
  const btn = document.getElementById('payConfirmBtn');
  S.busy = true;
  btn.disabled = true;
  btn.querySelector('.pc-tx').textContent = 'Upload ho raha hai…';
  try {
    await uploadAndConfirm();
    if (S.payMethod === 'counter') {
      await api('/api/payment/counter', { method: 'POST', body: { jobId: S.job.jobId } });
      showSuccess('counter');
    } else {
      await startOnlinePayment();
    }
  } catch (err) {
    toast(err.message || 'Payment shuru nahi ho saka');
  } finally {
    S.busy = false;
    btn.disabled = false;
    btn.querySelector('.pc-tx').textContent = '💳 Confirm karke Pay';
  }
}

async function startOnlinePayment() {
  const provider = (S.paymentConfig && S.paymentConfig.provider) || 'demo';
  const order = await api('/api/payment/online/create', { method: 'POST', body: { jobId: S.job.jobId } });
  if (provider === 'razorpay') {
    if (!window.Razorpay) throw new Error('Razorpay checkout load nahi hua. Internet check karo.');
    const rzp = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: 'INR',
      name: (S.shop && S.shop.name) || 'QR Se Print',
      description: 'Print Order ' + S.orderNo,
      order_id: order.providerOrderId,
      theme: { color: '#7c3aed' },
      handler: async function (response) {
        try {
          await api('/api/payment/razorpay/verify', {
            method: 'POST',
            body: {
              jobId: S.job.jobId,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            }
          });
          showSuccess('online');
        } catch (e) { toast(e.message || 'Payment verify nahi hua'); }
      }
    });
    rzp.on('payment.failed', (r) => toast((r.error && r.error.description) || 'Payment failed'));
    rzp.open();
  } else if (provider === 'cashfree') {
    if (!order.paymentLink) throw new Error('Cashfree payment link nahi mila');
    window.location.href = order.paymentLink;
  } else {
    await api('/api/payment/demo/complete', { method: 'POST', body: { jobId: S.job.jobId, orderId: order.providerOrderId } });
    showSuccess('demo');
  }
}

function showSuccess(method) {
  hideAllSections();
  document.getElementById('upProgWrap').style.display = 'none';
  show('secSuccess');
  setStep(4);
  const icon = document.getElementById('successIcon');
  icon.className = 'sicon' + (method === 'counter' ? ' counter' : '');
  icon.textContent = method === 'counter' ? '₹' : '✓';
  document.getElementById('successTitle').textContent = method === 'counter' ? 'Order Confirm!' : 'Print Shuru!';
  document.getElementById('orderId').textContent = 'ORDER #' + S.orderNo;
  document.getElementById('ordNoBox').style.display = 'block';
  document.getElementById('ordNoNum').textContent = S.orderNo;
  const box = document.getElementById('collectBox');
  box.className = 'collect-box' + (method === 'counter' ? ' counter' : '');
  document.getElementById('collectTitle').textContent = method === 'counter' ? '💵 Counter par Pay karo' : '🖨️ Print Ho Raha Hai!';
  document.getElementById('collectMsg').textContent = method === 'counter'
    ? 'Shop par jaa kar ' + S.orderNo + ' number batao aur ' + money(S.job.amount) + ' do.'
    : 'Aapka document print ho raha hai.' + (method === 'demo' ? ' (Demo payment mode)' : '');
  document.getElementById('finalAmount').textContent = money(S.job.amount);
  document.getElementById('dlBox').style.display = 'none';
  document.getElementById('fbThanks').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function downloadMyPdf() {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF load nahi hua');
    const jsPDF = window.jspdf.jsPDF;
    const pdf = new jsPDF({
      orientation: S.orientation === 'landscape' ? 'landscape' : 'portrait',
      unit: 'mm',
      format: (S.paper === '4x6' ? [101.6, 152.4] : S.paper),
      compress: true
    });
    const indices = pageIndices();
    indices.forEach((pi, i) => {
      if (i > 0) pdf.addPage();
      const data = renderPageCanvas(pi, true).toDataURL('image/jpeg', 0.9);
      const w = pdf.internal.pageSize.getWidth();
      const h = pdf.internal.pageSize.getHeight();
      pdf.addImage(data, 'JPEG', 0, 0, w, h);
    });
    pdf.save('print-' + (S.orderNo || 'order') + '.pdf');
  } catch (e) { toast(e.message || 'PDF download nahi hua'); }
}

async function sendFeedback(good) {
  if (!S.job || !S.job.jobId) return;
  try {
    await api('/api/jobs/' + encodeURIComponent(S.job.jobId) + '/feedback', {
      method: 'POST', body: { good: !!good }
    });
    document.getElementById('fbThanks').style.display = 'block';
  } catch (e) { toast(e.message || 'Feedback save nahi hua'); }
}
