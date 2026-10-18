#!/usr/bin/env node
/**
 * Generate the binary files behind the demo fixtures into public/demo/.
 *
 *   node scripts/demo-assets/generate.mjs [outDir]
 *
 * Every attachment and every entry in the demo Files app points at one of
 * these, so previews render real content instead of a text placeholder. The
 * PDFs and PNGs are rendered from the HTML templates below with the Chromium
 * that Playwright already ships for the test suite; the spreadsheets use
 * exceljs (a dependency of the app). Word and PowerPoint files need `docx` and
 * `pptxgenjs`, which are not dependencies of the app: install them anywhere
 * and point DEMO_ASSET_DEPS at that folder, e.g.
 *
 *   mkdir /tmp/deps && (cd /tmp/deps && npm init -y && npm i docx pptxgenjs)
 *   DEMO_ASSET_DEPS=/tmp/deps node scripts/demo-assets/generate.mjs
 *
 * Without them the Office files are skipped and the existing ones are kept.
 * The output is committed; rerun only when the fixtures change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'public', 'demo'));
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright-core');
const ExcelJS = require('exceljs');

let docx = null;
let PptxGenJS = null;
if (process.env.DEMO_ASSET_DEPS) {
  const depRequire = createRequire(path.join(path.resolve(process.env.DEMO_ASSET_DEPS), 'package.json'));
  try { docx = depRequire('docx'); } catch { /* skipped below */ }
  try { PptxGenJS = depRequire('pptxgenjs'); } catch { /* skipped below */ }
}

fs.mkdirSync(OUT, { recursive: true });
const written = [];
const write = (name, buf) => {
  fs.writeFileSync(path.join(OUT, name), buf);
  written.push(`${name} ${(buf.length / 1024).toFixed(0)} KB`);
};

// ── Shared look for the rendered documents ─────────────────────────────
const CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11pt/1.5 "Segoe UI", Inter, -apple-system, Helvetica, Arial, sans-serif; color: #18181b; }
  .page { width: 210mm; min-height: 297mm; padding: 22mm 20mm; position: relative; }
  h1 { font-size: 26pt; margin: 0 0 4mm; letter-spacing: -0.01em; }
  h2 { font-size: 13pt; margin: 10mm 0 3mm; }
  .muted { color: #71717a; }
  .brand { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14mm; }
  .logo { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14pt; }
  .logo i { width: 20px; height: 20px; border-radius: 6px; display: inline-block; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  th { text-align: left; font-weight: 600; color: #52525b; border-bottom: 1.5px solid #18181b; padding: 2.5mm 0; }
  td { padding: 2.5mm 0; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { border-bottom: 0; font-weight: 700; font-size: 12pt; padding-top: 4mm; }
  .box { border: 1px solid #e4e4e7; border-radius: 8px; padding: 6mm; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  .tag { display: inline-block; font-size: 8.5pt; font-weight: 600; padding: 1px 8px; border-radius: 999px; background: #f4f4f5; color: #3f3f46; }
  .foot { position: absolute; left: 20mm; right: 20mm; bottom: 14mm; font-size: 8.5pt; color: #a1a1aa; border-top: 1px solid #e4e4e7; padding-top: 3mm; display: flex; justify-content: space-between; }
  .big { font-size: 30pt; font-weight: 700; letter-spacing: -0.02em; }
  .mono { font-family: ui-monospace, Consolas, Menlo, monospace; }
`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="page">${body}</div></body></html>`;
const logo = (name, color) => `<span class="logo"><i style="background:${color}"></i>${name}</span>`;

// Dates in the documents are phrased relative to "this month" so they do not
// contradict the fixtures, which float with the clock.
const now = new Date();
const month = now.toLocaleString('en-GB', { month: 'long' });
const year = now.getFullYear();
const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleString('en-GB', { month: 'long' });
const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const plus = (days) => { const d = new Date(now); d.setDate(d.getDate() + days); return d; };

const DOCS = {
  // DesignCo invoice, attached to Sarah Kim's mail.
  'invoice-designco-2026-089.pdf': page(`
    <div class="brand">${logo('DesignCo', '#0f8578')}<div class="muted" style="text-align:right">DesignCo Studio GmbH<br>Torstraße 112, 10119 Berlin<br>hello@designco.example</div></div>
    <h1>Invoice 2026-089</h1>
    <div class="grid" style="margin-bottom:10mm">
      <div><div class="muted">Billed to</div>Meridian Labs GmbH<br>Attn. Nora Lindqvist<br>Rosenthaler Str. 40, 10178 Berlin</div>
      <div><div class="muted">Details</div>Issued ${fmt(now)}<br>Due ${fmt(plus(14))}<br>Project: Website redesign</div>
    </div>
    <table><tr><th>Description</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Amount</th></tr>
      <tr><td>Landing page prototype, v3 (hero option B, asymmetric grid)</td><td class="r">24</td><td class="r">€110.00</td><td class="r">€2,640.00</td></tr>
      <tr><td>Design system tokens and component audit</td><td class="r">12</td><td class="r">€110.00</td><td class="r">€1,320.00</td></tr>
      <tr><td>Two review calls and revisions</td><td class="r">4</td><td class="r">€110.00</td><td class="r">€440.00</td></tr>
      <tr><td class="muted">Subtotal</td><td></td><td></td><td class="r">€4,400.00</td></tr>
      <tr><td class="muted">VAT 19%</td><td></td><td></td><td class="r">€836.00</td></tr>
      <tr class="total"><td>Total due</td><td></td><td></td><td class="r">€5,236.00</td></tr></table>
    <h2>Payment</h2><p>Bank transfer to DesignCo Studio GmbH, IBAN DE02 1203 0000 0000 2020 51, reference <span class="mono">2026-089</span>. The ${nextMonth} pre-payment has been backed out as agreed.</p>
    <div class="foot"><span>DesignCo Studio GmbH · HRB 98765 B · VAT DE 812 345 678</span><span>Page 1 of 1</span></div>`),

  // Hotel voucher for the Lisbon trip.
  'hotel-voucher-lisbon.pdf': page(`
    <div class="brand">${logo('Booking.com', '#003580')}<span class="tag">Confirmed</span></div>
    <h1>Hotel Tejo Vista, Lisbon</h1>
    <p class="muted">Rua do Alecrim 48, 1200-018 Lisboa, Portugal · +351 21 555 0170</p>
    <div class="grid" style="margin:8mm 0">
      <div class="box"><div class="muted">Check-in</div><div class="big">${plus(9).getDate()}</div>${plus(9).toLocaleDateString('en-GB', { weekday: 'long', month: 'long' })}<br>from 15:00</div>
      <div class="box"><div class="muted">Check-out</div><div class="big">${plus(12).getDate()}</div>${plus(12).toLocaleDateString('en-GB', { weekday: 'long', month: 'long' })}<br>until 11:00</div>
    </div>
    <table><tr><th>Room</th><th class="r">Nights</th><th class="r">Price</th></tr>
      <tr><td>Superior double, river view, breakfast included</td><td class="r">3</td><td class="r">€486.00</td></tr>
      <tr><td class="muted">City tax (paid at the property)</td><td></td><td class="r">€12.00</td></tr>
      <tr class="total"><td>Paid</td><td></td><td class="r">€486.00</td></tr></table>
    <h2>Confirmation</h2><p>Number <span class="mono">4892.771.433</span> · PIN <span class="mono">2047</span>. Show this voucher at reception. Free cancellation ended ${fmt(plus(2))}.</p>
    <div class="foot"><span>Guest: Nora Lindqvist · 1 adult</span><span>Booking.com B.V.</span></div>`),

  // Boarding pass BER → LIS.
  'boarding-pass-ber-lis.pdf': page(`
    <div class="brand">${logo('Lufthansa', '#05164d')}<span class="tag">Boarding pass</span></div>
    <div class="box" style="padding:10mm">
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div><div class="muted">Berlin</div><div class="big">BER</div></div>
        <div class="muted" style="font-size:20pt">→</div>
        <div style="text-align:right"><div class="muted">Lisbon</div><div class="big">LIS</div></div>
      </div>
      <div class="grid" style="margin-top:10mm;grid-template-columns:repeat(4,1fr)">
        <div><div class="muted">Flight</div><b>LH 1796</b></div>
        <div><div class="muted">Date</div><b>${fmt(plus(9))}</b></div>
        <div><div class="muted">Boarding</div><b>07:55</b></div>
        <div><div class="muted">Departure</div><b>08:35</b></div>
        <div><div class="muted">Passenger</div><b>LINDQVIST / NORA</b></div>
        <div><div class="muted">Seat</div><b>14A</b></div>
        <div><div class="muted">Gate</div><b>B21</b></div>
        <div><div class="muted">Class</div><b>Economy</b></div>
      </div>
      <div style="margin-top:10mm;height:22mm;background:repeating-linear-gradient(90deg,#18181b 0 2px,transparent 2px 5px,#18181b 5px 6px,transparent 6px 9px)"></div>
      <div class="mono muted" style="margin-top:2mm">M1LINDQVIST/NORA  E7KQ2R BERLISLH 1796 ${String(plus(9).getDate()).padStart(2, '0')}Y014A0031 100</div>
    </div>
    <p class="muted" style="margin-top:8mm">Be at the gate 30 minutes before departure. Hand baggage: 1 piece up to 8 kg.</p>
    <div class="foot"><span>Booking reference E7KQ2R · Miles &amp; More 992 004 118 221</span><span>Deutsche Lufthansa AG</span></div>`),

  // Conference ticket.
  'infra-summit-ticket.pdf': page(`
    <div class="brand">${logo('Infra Summit Lisbon', '#db2d54')}<span class="tag">Speaker</span></div>
    <h1>Nora Lindqvist</h1>
    <p class="muted">Meridian Labs · Talk: "Rolling back without rolling over: safe launches for event platforms"</p>
    <div class="grid" style="margin:8mm 0">
      <div class="box"><div class="muted">When</div><b>${fmt(plus(10))} to ${fmt(plus(11))}</b><br>Doors 08:30, talks from 09:30</div>
      <div class="box"><div class="muted">Where</div><b>Centro de Congressos de Lisboa</b><br>Praça das Indústrias 1, Lisboa</div>
    </div>
    <div class="box" style="display:flex;gap:8mm;align-items:center">
      <div style="width:36mm;height:36mm;background:
        conic-gradient(#18181b 25%, transparent 0 50%, #18181b 0 75%, transparent 0) 0 0/12mm 12mm, #fff; border:4px solid #18181b"></div>
      <div><div class="muted">Ticket</div><div class="mono" style="font-size:14pt">IS26-SPK-01827</div><div class="muted" style="margin-top:3mm">Includes the speakers' dinner on day one and the workshop day.</div></div>
    </div>
    <div class="foot"><span>Issued by Infra Summit Lda. via Tito</span><span>Non-transferable</span></div>`),

  // Beacon launch plan (the PDF in the Projects folder).
  'beacon-launch-plan-v3.pdf': page(`
    <div class="brand">${logo('Meridian Labs', '#db2d54')}<span class="tag">Internal · v3</span></div>
    <h1>Beacon launch plan</h1>
    <p class="muted">Owner: Michael Torres · Engineering: Alice Johnson, Nora Lindqvist · Launch ${fmt(plus(8))}</p>
    <h2>What ships</h2>
    <p>Beacon replaces the polling notification API with a push platform: webhooks with signed deliveries, server-sent events for browsers, and a retry queue with per-tenant budgets. Customers on the current API keep working until ${nextMonth} ${year + 1}.</p>
    <h2>Timeline</h2>
    <table><tr><th>Day</th><th>Milestone</th><th>Owner</th><th>State</th></tr>
      <tr><td>${fmt(plus(-6))}</td><td>Load test at 3× peak, 48 h soak</td><td>Ahmed</td><td><span class="tag">done</span></td></tr>
      <tr><td>${fmt(plus(1))}</td><td>Go / no-go review</td><td>Alice</td><td><span class="tag">scheduled</span></td></tr>
      <tr><td>${fmt(plus(3))}</td><td>Rollback runbook signed off</td><td>Nora</td><td><span class="tag">in review</span></td></tr>
      <tr><td>${fmt(plus(6))}</td><td>Canary: 5% of tenants, 24 h</td><td>Ahmed, Priya</td><td><span class="tag">planned</span></td></tr>
      <tr><td>${fmt(plus(8))}</td><td>General availability, blog post, changelog</td><td>Rachel</td><td><span class="tag">planned</span></td></tr></table>
    <h2>Risks</h2>
    <p>Webhook retries during a partial outage can double delivery volume; the budget caps that at 2× per tenant. The old API's long-poll clients see one reconnect at cutover. Both are covered in the runbook.</p>
    <div class="foot"><span>Meridian Labs GmbH · Confidential</span><span>Page 1 of 1</span></div>`),

  // Hetzner invoice in Receipts.
  'hetzner-invoice.pdf': page(`
    <div class="brand">${logo('Hetzner', '#d50c2d')}<div class="muted" style="text-align:right">Hetzner Online GmbH<br>Industriestr. 25, 91710 Gunzenhausen</div></div>
    <h1>Invoice R0012345678</h1>
    <p class="muted">Customer K0987654 · Meridian Labs GmbH · Period ${month} ${year}</p>
    <table style="margin-top:8mm"><tr><th>Product</th><th>Location</th><th class="r">Amount</th></tr>
      <tr><td>Cloud server CAX31 (beacon-eu-1)</td><td>Falkenstein</td><td class="r">€14.69</td></tr>
      <tr><td>Cloud server CAX31 (beacon-eu-2)</td><td>Helsinki</td><td class="r">€14.69</td></tr>
      <tr><td>Load balancer LB11</td><td>Falkenstein</td><td class="r">€5.83</td></tr>
      <tr><td>Object storage, 412 GB</td><td>Falkenstein</td><td class="r">€8.24</td></tr>
      <tr><td class="muted">VAT 19%</td><td></td><td class="r">€8.26</td></tr>
      <tr class="total"><td>Total (paid by SEPA direct debit)</td><td></td><td class="r">€51.71</td></tr></table>
    <div class="foot"><span>Hetzner Online GmbH · VAT DE 812 871 812</span><span>Page 1 of 1</span></div>`),

  // Quarterly report in Files.
  'quarterly-report.pdf': page(`
    <div class="brand">${logo('Meridian Labs', '#db2d54')}<span class="tag">Board update</span></div>
    <h1>Quarterly report</h1>
    <p class="muted">Engineering and product · prepared by Nora Lindqvist and Michael Torres</p>
    <div class="grid" style="grid-template-columns:repeat(3,1fr);margin:8mm 0">
      <div class="box"><div class="muted">Uptime</div><div class="big">99.97%</div></div>
      <div class="box"><div class="muted">p95 latency</div><div class="big">184 ms</div></div>
      <div class="box"><div class="muted">Active tenants</div><div class="big">1,284</div></div>
    </div>
    <h2>Highlights</h2>
    <p>Beacon reached feature-complete and passed the 48-hour soak at three times peak traffic. The website redesign goes live with the launch. Support volume fell 18% after the status page and the new error pages shipped.</p>
    <h2>Next quarter</h2>
    <p>Beacon general availability, migration tooling for long-poll customers, and the first external audit of the delivery signing scheme.</p>
    <div class="foot"><span>Meridian Labs GmbH · Confidential</span><span>Page 1 of 1</span></div>`),

  // Internal purchase order attached to the support thread.
  'po-lumen-logistics.pdf': page(`
    <div class="brand">${logo('Lumen Logistics', '#1d4ed8')}<span class="tag">Purchase order</span></div>
    <h1>PO 2026-0412</h1>
    <p class="muted">Lumen Logistics S.A. · Av. da Liberdade 110, Lisboa · to Meridian Labs GmbH</p>
    <table style="margin-top:8mm"><tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr>
      <tr><td>Meridian Platform, Business plan, annual</td><td class="r">1</td><td class="r">€11,880.00</td></tr>
      <tr><td>Beacon add-on, 50 tenants</td><td class="r">1</td><td class="r">€3,600.00</td></tr>
      <tr class="total"><td>Total excl. VAT</td><td></td><td class="r">€15,480.00</td></tr></table>
    <p style="margin-top:8mm">Please invoice to accounts@lumenlogistics.example and quote the PO number. Payment terms 30 days.</p>
    <div class="foot"><span>Approved: Tomás Ferreira, Head of Operations</span><span>Page 1 of 1</span></div>`),
};

// PNGs rendered from HTML at 2x.
const IMAGES = {
  // Screenshot of the Beacon metrics dashboard, attached to Ahmed's soak-test mail.
  'beacon-soak-dashboard.png': {
    width: 1200, height: 720, html: `<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin:0; width:1200px; height:720px; background:#0f1117; color:#e5e7eb; font: 14px/1.4 "Segoe UI", Inter, sans-serif; padding:24px; box-sizing:border-box }
      .top { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px }
      .top b { font-size:18px } .top span { color:#9ca3af }
      .tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:14px }
      .tile { background:#171a23; border:1px solid #262a36; border-radius:10px; padding:14px 16px }
      .tile small { color:#9ca3af; display:block; margin-bottom:6px } .tile b { font-size:26px; font-weight:600 }
      .ok { color:#34d399 } .chart { background:#171a23; border:1px solid #262a36; border-radius:10px; padding:16px; height:420px; position:relative }
      .chart small { color:#9ca3af } svg { position:absolute; left:16px; right:16px; bottom:16px; top:44px; width:calc(100% - 32px); height:calc(100% - 60px) }
    </style></head><body>
      <div class="top"><b>Beacon · soak test, 48 h at 3× peak</b><span>eu-1, eu-2 · last 48 hours</span></div>
      <div class="tiles">
        <div class="tile"><small>Deliveries / s</small><b>42,380</b></div>
        <div class="tile"><small>p95 delivery latency</small><b>184 ms</b></div>
        <div class="tile"><small>Retry budget used</small><b class="ok">11%</b></div>
        <div class="tile"><small>Errors</small><b class="ok">0.02%</b></div>
      </div>
      <div class="chart"><small>Deliveries per second</small>
        <svg viewBox="0 0 1000 300" preserveAspectRatio="none">
          <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#db2d54" stop-opacity=".5"/><stop offset="1" stop-color="#db2d54" stop-opacity="0"/></linearGradient></defs>
          ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="1000" y1="${300 * f}" y2="${300 * f}" stroke="#262a36"/>`).join('')}
          <path d="M0,260 ${Array.from({ length: 48 }, (_, i) => `L${(i + 1) * 20.8},${200 - Math.round(Math.sin(i / 3) * 40 + (i % 7) * 6 + (i > 30 ? -20 : 0))}`).join(' ')} L1000,300 L0,300 Z" fill="url(#g)"/>
          <path d="M0,260 ${Array.from({ length: 48 }, (_, i) => `L${(i + 1) * 20.8},${200 - Math.round(Math.sin(i / 3) * 40 + (i % 7) * 6 + (i > 30 ? -20 : 0))}`).join(' ')}" fill="none" stroke="#db2d54" stroke-width="2.5"/>
        </svg></div>
    </body></html>`,
  },
  // Illustration draft from Daniel Cooper (the commission thread).
  'book-cover-draft.png': {
    width: 900, height: 1200, html: `<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin:0; width:900px; height:1200px; background:#f3e9d2; font-family: Georgia, serif; position:relative; overflow:hidden }
      .sun { position:absolute; width:520px; height:520px; border-radius:50%; background:#e2574c; left:190px; top:140px }
      .sea { position:absolute; left:0; right:0; bottom:0; height:520px; background:#1f4e5f }
      .wave { position:absolute; left:-40px; right:-40px; height:70px; border-radius:50%; background:#2b6b7f }
      h1 { position:absolute; left:70px; top:760px; margin:0; color:#f3e9d2; font-size:88px; line-height:1; font-weight:400; letter-spacing:-0.02em }
      p { position:absolute; left:72px; top:960px; margin:0; color:#f3e9d2; font-size:30px; letter-spacing:.25em; text-transform:uppercase }
      .note { position:absolute; right:40px; top:40px; font: 20px/1.3 "Segoe UI", sans-serif; color:#8a2f28; transform:rotate(-4deg) }
    </style></head><body>
      <div class="sun"></div><div class="sea"></div>
      <div class="wave" style="bottom:400px"></div><div class="wave" style="bottom:300px;opacity:.7"></div><div class="wave" style="bottom:190px;opacity:.5"></div>
      <h1>The Lemon<br>Tree Year</h1><p>Sofia Russo</p>
      <div class="note">draft 2 — bolder sun?</div>
    </body></html>`,
  },
};

// Plain-text files in the Files app.
const TEXT = {
  'meeting-notes.md': `# Beacon weekly · ${fmt(plus(-1))}

Attendees: Alice, Bob, Priya, Ahmed, Lisa, Nora

## Decisions
- Canary stays at 5% for a full 24 h, not 12. Priya wants one night of traffic.
- Webhook signing keys rotate every 90 days; the old key stays valid for 48 h.
- Rachel gets the changelog draft by ${fmt(plus(4))}.

## Open
- [ ] Rollback runbook: Nora, review by Bob and Ahmed
- [ ] Long-poll reconnect test on the staging tenant: Lisa
- [ ] Status page component for Beacon: Ahmed

## Notes
Load test held at 3× peak for 48 h without a retry-budget breach. p95 184 ms.
`,
  'todo.txt': `(A) Rollback runbook, send to Bob and Ahmed @beacon due:${plus(3).toISOString().slice(0, 10)}
(A) RSVP go/no-go review @beacon
(B) Book airport train for ${fmt(plus(9))} @travel
(B) Reply to Mom about the weekend @family
(C) Pick up suit from the cleaner @errands
x Sign DesignCo invoice 2026-089 @finance
`,
};

// ── Office documents ─────────────────────────────────────────────────────
async function xlsxLaunchMetrics() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nora Lindqvist';
  const ws = wb.addWorksheet('Soak test');
  ws.columns = [
    { header: 'Hour', key: 'h', width: 8 },
    { header: 'Deliveries/s', key: 'd', width: 14 },
    { header: 'p95 ms', key: 'p', width: 10 },
    { header: 'Errors %', key: 'e', width: 10 },
    { header: 'Retry budget %', key: 'r', width: 16 },
  ];
  for (let h = 1; h <= 48; h++) {
    ws.addRow({ h, d: 40000 + Math.round(Math.sin(h / 3) * 2500 + (h % 7) * 300), p: 170 + (h % 5) * 4 + (h > 30 ? 6 : 0), e: Number((0.01 + (h % 4) * 0.005).toFixed(3)), r: Math.min(14, 4 + Math.round(h / 5)) });
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const sum = wb.addWorksheet('Summary');
  sum.addRows([
    ['Metric', 'Value', 'Target'],
    ['Peak deliveries/s', 42380, 36000],
    ['p95 latency (ms)', 184, 250],
    ['Error rate', '0.02%', '< 0.1%'],
    ['Retry budget used', '11%', '< 50%'],
    ['Verdict', 'Pass', ''],
  ]);
  sum.getRow(1).font = { bold: true };
  sum.columns = [{ width: 22 }, { width: 12 }, { width: 12 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function xlsxBudget() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Budget');
  ws.addRow(['Category', 'Planned', 'Actual', 'Delta']);
  const rows = [['Cloud', 7200, 6840], ['Tooling', 2400, 2510], ['Design (DesignCo)', 5000, 5236], ['Conferences', 3000, 1870], ['Hardware', 1500, 0]];
  rows.forEach(([c, p, a], i) => {
    const r = i + 2;
    ws.addRow([c, p, a, { formula: `C${r}-B${r}` }]);
  });
  ws.addRow(['Total', { formula: 'SUM(B2:B6)' }, { formula: 'SUM(C2:C6)' }, { formula: 'SUM(D2:D6)' }]);
  ws.getRow(1).font = { bold: true };
  ws.getRow(7).font = { bold: true };
  ws.columns = [{ width: 22 }, { width: 12 }, { width: 12 }, { width: 12 }];
  for (const col of ['B', 'C', 'D']) ws.getColumn(col).numFmt = '€#,##0';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function docxRunbook() {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = docx;
  const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 } });
  const h = (text, level = HeadingLevel.HEADING_1) => new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
  const cell = (text, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
  const steps = [
    ['1', 'Freeze deploys; announce in #beacon-launch', 'On-call'],
    ['2', 'Flip the tenant router back to the polling API (feature flag beacon.route)', 'Nora'],
    ['3', 'Drain the webhook queue; retries pause automatically once the flag is off', 'Ahmed'],
    ['4', 'Confirm long-poll clients reconnected (dashboard: reconnects < 1%)', 'Lisa'],
    ['5', 'Post the status page update and the customer note', 'Rachel'],
  ];
  const doc = new Document({
    creator: 'Nora Lindqvist',
    title: 'Beacon rollback runbook',
    sections: [{
      children: [
        new Paragraph({ text: 'Beacon rollback runbook', heading: HeadingLevel.TITLE }),
        p('Meridian Labs · draft 2 · owner Nora Lindqvist · reviewers Bob Chen, Ahmed Hassan', { italics: true, color: '666666' }),
        h('When to roll back'),
        p('Error rate above 0.5% for ten minutes, p95 delivery latency above 1 s, or any retry budget breach on more than three tenants. The on-call engineer decides; nobody needs to be asked first.'),
        h('Steps'),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
          new TableRow({ children: [cell('#', true), cell('Action', true), cell('Owner', true)] }),
          ...steps.map(([n, a, o]) => new TableRow({ children: [cell(n), cell(a), cell(o)] })),
        ] }),
        h('Expected impact'),
        p('Customers on the new API see deliveries pause for the drain window, at most two minutes. Nothing is lost: the queue is replayed after the fix. Long-poll clients see one reconnect.'),
        h('Open questions'),
        p('Do we keep the signing keys rotated during the rollback window? Bob to confirm with the auditor.'),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function docxContract() {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const p = (text) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 160 } });
  const doc = new Document({
    title: 'Service agreement draft',
    sections: [{ children: [
      new Paragraph({ text: 'Service agreement', heading: HeadingLevel.TITLE }),
      p('between Meridian Labs GmbH ("Provider") and Lumen Logistics S.A. ("Customer"). Draft for review, not for signature.'),
      new Paragraph({ text: '1. Scope', heading: HeadingLevel.HEADING_1 }),
      p('The Provider operates the Meridian Platform and the Beacon notification service for the Customer under the Business plan, as described in Purchase Order 2026-0412.'),
      new Paragraph({ text: '2. Service levels', heading: HeadingLevel.HEADING_1 }),
      p('Monthly availability of 99.9%, measured at the API edge. Credits of 10% of the monthly fee per 0.1% below target, capped at 50%.'),
      new Paragraph({ text: '3. Term', heading: HeadingLevel.HEADING_1 }),
      p('Twelve months from the effective date, renewing yearly unless either party gives sixty days notice.'),
    ] }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function pptxLaunchDeck() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.author = 'Rachel Green';
  pres.title = 'Beacon launch';
  const rasp = 'DB2D54';
  const cover = pres.addSlide();
  cover.background = { color: '0F1117' };
  cover.addText('Beacon', { x: 0.6, y: 1.6, w: 8, h: 1.2, fontSize: 54, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI' });
  cover.addText('Real-time notifications for every Meridian tenant', { x: 0.6, y: 2.8, w: 8, h: 0.6, fontSize: 20, color: 'C7C9D1', fontFace: 'Segoe UI' });
  cover.addShape(pres.ShapeType.rect, { x: 0.6, y: 3.6, w: 1.4, h: 0.08, fill: { color: rasp }, line: { color: rasp } });
  cover.addText(`Launch ${fmt(plus(8))} · Meridian Labs`, { x: 0.6, y: 4.6, w: 8, h: 0.4, fontSize: 12, color: '8B8E98', fontFace: 'Segoe UI' });

  const what = pres.addSlide();
  what.addText('What customers get', { x: 0.6, y: 0.4, w: 8, h: 0.7, fontSize: 30, bold: true, color: '18181B', fontFace: 'Segoe UI' });
  what.addText([
    { text: 'Webhooks with signed deliveries', options: { bullet: true, breakLine: true } },
    { text: 'Server-sent events for browsers, no polling', options: { bullet: true, breakLine: true } },
    { text: 'Retry queue with per-tenant budgets', options: { bullet: true, breakLine: true } },
    { text: 'Delivery log with replay, 30 days', options: { bullet: true } },
  ], { x: 0.8, y: 1.4, w: 8, h: 3, fontSize: 20, color: '3F3F46', fontFace: 'Segoe UI', paraSpaceAfter: 10 });

  const num = pres.addSlide();
  num.addText('Soak test, 48 hours at 3× peak', { x: 0.6, y: 0.4, w: 8.5, h: 0.7, fontSize: 30, bold: true, color: '18181B', fontFace: 'Segoe UI' });
  const tiles = [['42,380', 'deliveries / s'], ['184 ms', 'p95 latency'], ['0.02%', 'errors'], ['11%', 'retry budget']];
  tiles.forEach(([v, l], i) => {
    const x = 0.6 + i * 2.25;
    num.addShape(pres.ShapeType.roundRect, { x, y: 1.6, w: 2.05, h: 1.6, fill: { color: 'F4F4F5' }, line: { color: 'E4E4E7' }, rectRadius: 0.1 });
    num.addText(v, { x, y: 1.75, w: 2.05, h: 0.8, fontSize: 28, bold: true, color: rasp, align: 'center', fontFace: 'Segoe UI' });
    num.addText(l, { x, y: 2.5, w: 2.05, h: 0.5, fontSize: 13, color: '71717A', align: 'center', fontFace: 'Segoe UI' });
  });
  num.addText('Verdict: pass. Canary at 5% of tenants for 24 h, then general availability.', { x: 0.6, y: 3.7, w: 8.5, h: 0.6, fontSize: 16, color: '3F3F46', fontFace: 'Segoe UI' });

  const plan = pres.addSlide();
  plan.addText('Rollout', { x: 0.6, y: 0.4, w: 8, h: 0.7, fontSize: 30, bold: true, color: '18181B', fontFace: 'Segoe UI' });
  plan.addTable([
    [{ text: 'Day', options: { bold: true } }, { text: 'Milestone', options: { bold: true } }, { text: 'Owner', options: { bold: true } }],
    [fmt(plus(1)), 'Go / no-go review', 'Alice'],
    [fmt(plus(3)), 'Rollback runbook signed off', 'Nora'],
    [fmt(plus(6)), 'Canary, 5% of tenants', 'Ahmed, Priya'],
    [fmt(plus(8)), 'General availability', 'Rachel'],
  ], { x: 0.6, y: 1.4, w: 8.8, fontSize: 14, fontFace: 'Segoe UI', color: '3F3F46', border: { type: 'solid', color: 'E4E4E7', pt: 1 }, fill: { color: 'FFFFFF' } });

  return Buffer.from(await pres.write({ outputType: 'nodebuffer' }));
}

// ── Run ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const pg = await ctx.newPage();
for (const [name, html] of Object.entries(DOCS)) {
  await pg.setContent(html, { waitUntil: 'load' });
  write(name, await pg.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
}
for (const [name, { width, height, html }] of Object.entries(IMAGES)) {
  await pg.setViewportSize({ width, height });
  await pg.setContent(html, { waitUntil: 'load' });
  write(name, await pg.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } }));
}
await browser.close();

for (const [name, text] of Object.entries(TEXT)) write(name, Buffer.from(text, 'utf8'));
write('beacon-soak-metrics.xlsx', await xlsxLaunchMetrics());
write('budget-2026.xlsx', await xlsxBudget());
if (docx) {
  write('beacon-rollback-runbook.docx', await docxRunbook());
  write('service-agreement-draft.docx', await docxContract());
} else console.log('docx not available: Word files kept as they are');
if (PptxGenJS) write('beacon-launch-deck.pptx', await pptxLaunchDeck());
else console.log('pptxgenjs not available: deck kept as it is');

for (const w of written) console.log('  +', w);
console.log(`output: ${OUT}`);
