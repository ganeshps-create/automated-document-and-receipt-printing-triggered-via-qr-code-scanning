# QR Se Print — Auto Print Agent (Windows)

Ye chhota local agent shop PC par chalta hai. Ye Railway server se paid jobs fetch karta hai aur **Epson L6360** (ya koi bhi installed Windows printer) par automatically print bhej deta hai.

> Printer ko Railway se direct connect nahi kar sakte. Agent shop PC par chalna zaroori hai, kyunki printer usi PC/network me hai.

## Kya karta hai

- Har `pollMs` ms me server se jobs leta hai: default `status=paid`
- File download karta hai `spool/` me
- SumatraPDF se silent print karta hai (copies/color/duplex/page range pass karta hai)
- Print success ke baad job ko `printed` mark karta hai
- `agent-state.json` me printed jobs yaad rakhta hai, isliye duplicate print se bachta hai

## 1) Railway server par key set karo

Railway → service → **Variables** me add karo:

```env
PRINT_AGENT_KEY=<long-random-secret>
PRINT_AGENT_AUTOPRINT_STATUSES=paid
PRINT_AGENT_POLL_MS=5000
```

Random key banao:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Deploy ke baad test:

```text
GET /api/agent/config  with Authorization: Bearer <PRINT_AGENT_KEY>
```

## 2) Shop PC prerequisites (Epson L6360)

1. Epson L6360 same Wi‑Fi/LAN me, IP fixed/DHCP reserved.
2. Windows me printer install ho aur **Print Test Page** kaam kare.
3. Printer name note karo (example: `EPSON L6360 Series`).
4. **SumatraPDF install karo** (recommended/required for reliable PDF silent printing):
   - https://www.sumatrapdfreader.org/download-free-pdf-viewer
5. Node.js 18+ installed.

## 3) Agent configure karo

`print-agent` folder me `agent-config.json` banao (example se copy):

```json
{
  "serverUrl": "https://qr-se-print-production-eae42bc7.up.railway.app",
  "agentKey": "YOUR_PRINT_AGENT_KEY",
  "printer": "EPSON L6360 Series",
  "sumatraPath": "C:\\Users\\<YOU>\\AppData\\Local\\SumatraPDF\\SumatraPDF.exe",
  "statuses": ["paid"],
  "pollMs": 5000,
  "markPrinted": true
}
```

> `statuses: ["paid"]` ka matlab: sirf paid jobs auto print.  
> Agar counter/UPI pending bhi auto print karna ho to `["paid","counter_pending","upi_pending"]` (recommend nahi; payment verify ke baad hi print better hai).

## 4) Test karo

```powershell
cd print-agent
node agent.js printers
node agent.js test --config agent-config.json
node agent.js run --once --dry-run --config agent-config.json
```

`test` me `ok:true`, selected printer aur Sumatra path dikhna chahiye.

## 5) Live auto-print

```powershell
node agent.js run --config agent-config.json
```

Isse agent polling start karega. Jab bhi paid job milega, automatically print hoga aur server me `printed` mark ho jayega.

## 6) Windows startup (optional)

Task Scheduler se boot/login par run kara sakte ho:

- Program: `node.exe`
- Arguments: `C:\path\to\print-agent\agent.js run --config C:\path\to\print-agent\agent-config.json`
- Start in: `C:\path\to\print-agent`

Ya `run-agent.cmd` use karo.

## Troubleshooting

- **401 Print agent key invalid** — Railway `PRINT_AGENT_KEY` aur local config key same nahi.
- **Printer nahi mila** — `node agent.js printers` se exact name copy karo.
- **SumatraPDF exit code 4** — printer name galat.
- **PDF print nahi ho raha** — SumatraPDF install/path check karo.
- **Duplicate print** — `agent-state.json` delete mat karo; isme printed IDs stored hain.
- **Mini print / exact layout** — agent abhi job ki uploaded file ko print karta hai. Agar aapko exact mini layout PDF server se generate karwana hai to mujhe batao, main server-side render-to-PDF add kar dunga.

## Security

- `PRINT_AGENT_KEY` ko secret rakho. Ye admin password nahi, machine key hai.
- Agent ko public PC par mat chalao.
- HTTPS server URL use karo.