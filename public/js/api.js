/* Thin API client: JSON helpers + raw upload with real XHR progress. */

async function api(path, options) {
  const opts = Object.assign({ method: 'GET' }, options || {});
  const headers = Object.assign({}, opts.headers || {});
  let body;
  if (opts.body !== undefined && opts.body !== null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method: opts.method, headers, body, cache: 'no-store' });
  let data;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
  return data;
}

async function loadShopConfig() {
  try {
    S.paymentConfig = await api('/api/config');
  } catch (e) {
    S.paymentConfig = { provider: 'demo', mode: 'demo' };
  }
  try {
    S.shop = await api('/api/shop/' + encodeURIComponent(S.shopId));
  } catch (e) {
    S.shop = {
      id: S.shopId, name: 'QR Se Print', address: 'Printing made simple',
      price_bw: 5, price_color: 10, price_bw_duplex: 8, price_color_duplex: 16,
      payment_mode: 'both'
    };
  }
}

function uploadFileToServer(file, sign, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/upload?token=' + encodeURIComponent(sign.token), true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('x-upload-id', sign.uploadId);
    xhr.setRequestHeader('x-shop-id', S.shopId);
    xhr.setRequestHeader('x-file-name', file.name);
    xhr.setRequestHeader('x-file-size', String(file.size));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || ('Upload failed (' + xhr.status + ')')));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading'));
    xhr.send(file);
  });
}
