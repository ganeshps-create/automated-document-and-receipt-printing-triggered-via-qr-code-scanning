# QR Se Print — replica

An independent, full-stack replica of the customer print-ordering flow at
`https://qrseprint.in/print/SHOP_DA35DAB7`. Built with **plain HTML/CSS/JS** on the
front end and a **zero-dependency Node.js HTTP server** on the back end.

> The original site includes an anti-copy canary script. This is a clean-room rebuild
> of the observed UI and behaviour — no original server code, keys or data are used.

## Quick start

```bash
node server/index.js
# or: npm start
```

Open **http://localhost:3000/print/SHOP_DA35DAB7**

No `npm install` is needed. Node 18+ is required (tested on Node 26).
PDF.js, jsPDF, QRCode.js and the Razorpay checkout script are vendored in
`public/vendor/`, so all local features work offline. Only real gateway calls need
internet access.

## Payment setup (real gateways)

Copy `.env.example` to `.env` and fill in credentials:

```env
PAYMENT_PROVIDER=razorpay        # razorpay | cashfree | demo | auto
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...

# Or Cashfree:
PAYMENT_PROVIDER=cashfree
CASHFREE_APP_ID=...
CASHFREE_SECRET_KEY=...
CASHFREE_ENV=TEST                # TEST | PROD
PUBLIC_URL=http://localhost:3000
```

- **Razorpay**: server creates an order via `/v1/orders`; the browser opens Razorpay
  Checkout; the server verifies the HMAC signature at `/api/payment/razorpay/verify`.
- **Cashfree**: server creates an order via the Cashfree PG API and redirects to the
  payment link. On return (`?cf=<order_id>`) the app checks order status. A signed
  webhook endpoint is available at `/api/payment/cashfree/webhook`.
- **Demo mode** (automatic when no keys are present): full flow works end to end with
  a clearly labelled simulated payment. Useful for testing without merchant keys.

Shop name, logo, address and prices can also be overridden in `.env`.

## UPI Scan & Pay

Set a shop UPI ID in `.env` to show the **UPI Scan & Pay** option at checkout:

```env
UPI_VPA=yourshop@upi
UPI_NAME=Your Shop Name
```

The server sends these details to `/api/config`; the browser generates a UPI Pay QR
using the locally vendored QRCode.js. The customer scans it with any UPI app, pays
the exact amount, and clicks **Maine Pay Kar Diya** (an optional UTR/reference can be
entered). The job moves to `upi_pending` and appears in the shop admin queue for
manual verification. If `UPI_VPA` is empty, the option stays hidden.

## Shop admin print queue (`/admin`)

Open **http://localhost:3000/admin** (or `https://your-domain/admin`) and log in with
`ADMIN_PASSWORD` (local demo default: `admin123`). The dashboard shows every order,
auto-refreshes every 15 seconds, and lets the shop:

- filter by Paid / Counter / UPI / Printed,
- open the uploaded file and send it to the connected browser printer via **Print**,
- mark an order as Paid, Printed or Cancelled,
- see UTR references entered by UPI customers.

The token is stored in `sessionStorage` and expires after 8 hours. Printing uses the
browser's own print dialog: PDFs are embedded in a new window and images are shown at
full width, so the shop's connected/default printer is used. Set a strong
`ADMIN_PASSWORD` before deploying.

## Automatic printing (Epson L6360 / Windows)

For **automatic printing** (no browser dialog), run the local agent in `print-agent/`
on the shop PC where the printer is installed. The server cannot directly reach a
Wi‑Fi/USB printer on the shop network.

1. Set `PRINT_AGENT_KEY` on Railway and redeploy.
2. Install Epson L6360 driver and SumatraPDF on the shop Windows PC.
3. Copy `print-agent/agent-config.example.json` to `agent-config.json`, fill server
   URL, key, and printer name (`EPSON L6360 Series`).
4. Test: `node agent.js test --config agent-config.json`
5. Run: `node agent.js run --config agent-config.json`

The agent polls `/api/agent/jobs?status=paid`, downloads the file, prints silently via
SumatraPDF, and marks the job `printed`. See `print-agent/README.md` for full setup.

## Deploying (Render / Railway / Fly.io)

The included `Dockerfile` uses the official Node 22 Alpine image. There are no npm
dependencies to install. Uploads and order data live in `DATA_DIR` (`/app/data` in
containers), so **attach a persistent disk/volume** at that path or files will be
lost on restart.

### Render

1. Push this folder to GitHub.
2. In Render, choose **Blueprint** and select `render.yaml`.
3. Render builds the Dockerfile, mounts `qsp-uploads` at `/app/data`, and exposes
   `/api/health`. `RENDER_EXTERNAL_URL` is picked up automatically for payment
   return URLs.
4. Open the service URL + `/print/SHOP_DA35DAB7`.

> Render disks require a paid plan. On the free plan the app runs, but uploaded
> files are lost when the instance restarts.

### Railway

1. Create a new service from the GitHub repo — `railway.json` selects the Dockerfile.
2. In the service settings, add a **Volume** mounted at `/app/data`.
3. Set variables: `PORT=3000`, `DATA_DIR=/app/data`, `PAYMENT_PROVIDER=demo`,
   `PUBLIC_URL=https://your-railway-domain`, a strong random `UPLOAD_SECRET`,
   `ADMIN_PASSWORD`, and (for UPI) `UPI_VPA` / `UPI_NAME`.
   `RAILWAY_PUBLIC_DOMAIN` is detected automatically.
4. Generate a domain and open `/print/SHOP_DA35DAB7` and `/admin`.

### Fly.io

```bash
fly launch --config fly.toml --no-deploy
fly volume create qsp_data -r sin
fly secrets set UPLOAD_SECRET="$(openssl rand -hex 24)"
fly deploy
```

Then open `https://qr-se-print.fly.dev/print/SHOP_DA35DAB7` (replace the app name in
`fly.toml` if you chose another one).

### Going live with payments

In the host's environment/secret settings, set `PAYMENT_PROVIDER=razorpay` (or
`cashfree`) plus `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (or
`CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY`) and `PUBLIC_URL=https://your-domain`.
Also replace the demo `ADMIN_PASSWORD`, set `UPLOAD_SECRET`, and configure `UPI_VPA`
if you want Scan & Pay. Never commit keys or passwords to the repository.

## What works

1. **Upload** — multi-file select/drag-drop, PDF/PNG/JPG/WEBP/TXT, password-protected
   PDF unlock overlay (3 attempts), multi-page PDFs, service presets (Document,
   Resume, 4×6 Photo, Big Size).
2. **Edit** — A4 canvas with draggable/resizable items, pinch/mouse zoom, add
   document, auto-fit, paper size and orientation, free + 90°/180° rotation,
   brightness/contrast, photo border with thickness, cutting lines, four-corner
   perspective crop (homography).
3. **Preview** — rendered page image with navigation, specific-page ranges
   (`1,3,5-7`), B&W/Color, duplex, mini-print (pages per sheet, orientation, border,
   live preview).
4. **Pay** — copies, server-consistent pricing, counter payment, real online payment
   or UPI Scan & Pay QR, order number (`M-000001`), success screen, PDF download,
   feedback.
5. **Shop admin** — password-protected `/admin` queue with filters, live refresh,
   authenticated file access, browser printing and Paid/Printed/Cancelled statuses.
6. **Backend** — shop config, signed chunked uploads with progress, job records,
   status/feedback endpoints, order numbering, payment records, local disk storage.
   Data lives in `data/db.json` and uploaded files in `data/uploads/`.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/config` | Status + gateway config |
| GET | `/api/shop/:shopId` | Shop config and prices |
| POST | `/api/quote` | Server-side price quote |
| POST | `/api/upload/sign` | Issue short-lived upload token |
| PUT | `/api/upload?token=…` | Stream a file to disk |
| POST | `/api/upload/confirm` | Create a print job and order number |
| GET | `/api/jobs/:id/status` | Job status |
| POST | `/api/jobs/:id/feedback` | 👍/👎 feedback |
| POST | `/api/payment/online/create` | Create Razorpay/Cashfree/demo order |
| POST | `/api/payment/razorpay/verify` | Verify Razorpay signature |
| POST | `/api/payment/cashfree/status` | Check Cashfree order status |
| POST | `/api/payment/cashfree/webhook` | Signed Cashfree webhook |
| POST | `/api/payment/counter` | Confirm pay-at-counter order |
| POST | `/api/payment/upi/confirm` | Mark a job as UPI payment pending |
| POST | `/api/payment/demo/complete` | Complete a demo payment |
| POST | `/api/admin/login` | Get an 8-hour admin token |
| GET | `/api/admin/jobs` | List print queue (admin token) |
| GET | `/api/admin/jobs/:id/file` | Fetch uploaded file (admin token) |
| POST | `/api/admin/jobs/:id/status` | Update Paid/Printed/Cancelled (admin token) |
| GET | `/api/agent/config` | Print agent auth/config check (`PRINT_AGENT_KEY`) |
| GET | `/api/agent/jobs?status=paid` | Poll printable jobs (agent key) |
| GET | `/api/agent/jobs/:id/file` | Download job file (agent key) |
| POST | `/api/agent/jobs/:id/status` | Mark job printed/cancelled (agent key) |

## Deferred features

HEIC/Office-to-PDF conversion, digital signature verification, smart scanner,
background removal and multi-language i18n are intentionally not implemented in
this version. Their visual chips are not shown on the upload screen.

## Notes

- Uploaded files are stored locally under `data/`; add that folder to your backups
  or delete it to reset all orders.
- For production, put the app behind HTTPS and a reverse proxy, set a strong
  `UPLOAD_SECRET`, and restrict access to `data/`.
