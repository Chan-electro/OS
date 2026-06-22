import db from '../db.js';
import { AppError } from './users.js';

function calcTotals(items, taxRate, discount) {
  const subtotal = items.reduce((s, i) => {
    const qty = Number(i.quantity ?? i.qty) || 0;
    return s + qty * (Number(i.rate) || 0);
  }, 0);
  const tax = subtotal * ((Number(taxRate) || 0) / 100);
  const disc = Number(discount) || 0;
  return { subtotal: Math.round(subtotal * 100) / 100, total: Math.round((subtotal + tax - disc) * 100) / 100 };
}

export function nextInvoiceNumber() {
  const year = new Date().getFullYear().toString().slice(-2);
  const row = db.prepare(`SELECT invoice_number FROM invoices ORDER BY id DESC LIMIT 1`).get();
  if (!row) return { nextNumber: `AG-${year}0001`, sequence: '0001' };
  const last = row.invoice_number;
  const seq = parseInt(last.replace(/\D/g, '').slice(-4) || '0', 10) + 1;
  const padded = String(seq).padStart(4, '0');
  return { nextNumber: `AG-${year}${padded}`, sequence: padded };
}

export function listInvoices({ client_id, status, page = 1, pageSize = 25 }, user) {
  const conditions = [];
  const params = [];
  if (client_id) { conditions.push('i.client_id = ?'); params.push(client_id); }
  if (status)    { conditions.push('i.status = ?');    params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) as n FROM invoices i ${where}`).get(...params).n;
  const data  = db.prepare(`
    SELECT i.*, c.name as client_display_name
    FROM invoices i
    LEFT JOIN clients c ON i.client_id = c.id
    ${where}
    ORDER BY i.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);
  return { data: data.map(r => ({ ...r, items: JSON.parse(r.items || '[]') })), total, page, pageSize };
}

export function getInvoice(id) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!row) throw new AppError('NOT_FOUND', 'Invoice not found.', 404);
  return { ...row, items: JSON.parse(row.items || '[]') };
}

export function createInvoice(data, userId) {
  const items = Array.isArray(data.items) ? data.items : [];
  const { subtotal, total } = calcTotals(items, data.tax_rate, data.discount);
  const now = new Date().toISOString();
  const invoiceNumber = data.invoice_number || nextInvoiceNumber().nextNumber;

  const result = db.prepare(`
    INSERT INTO invoices
      (invoice_number, client_id, client_name, client_address, items, tax_rate, discount, subtotal, total, status, due_date, notes, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    invoiceNumber,
    data.client_id || null,
    data.client_name || null,
    data.client_address || null,
    JSON.stringify(items),
    Number(data.tax_rate) || 0,
    Number(data.discount) || 0,
    subtotal, total,
    data.status || 'draft',
    data.due_date || null,
    data.notes || null,
    userId, now, now
  );
  return getInvoice(result.lastInsertRowid);
}

export function updateInvoice(id, data, userId) {
  const inv = getInvoice(id);
  const items = Array.isArray(data.items) ? data.items : inv.items;
  const taxRate  = data.tax_rate  !== undefined ? Number(data.tax_rate)  : inv.tax_rate;
  const discount = data.discount  !== undefined ? Number(data.discount)  : inv.discount;
  const { subtotal, total } = calcTotals(items, taxRate, discount);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE invoices SET
      client_id=?, client_name=?, client_address=?, items=?,
      tax_rate=?, discount=?, subtotal=?, total=?,
      status=?, due_date=?, notes=?, updated_at=?
    WHERE id=?
  `).run(
    data.client_id !== undefined ? data.client_id : inv.client_id,
    data.client_name !== undefined ? data.client_name : inv.client_name,
    data.client_address !== undefined ? data.client_address : inv.client_address,
    JSON.stringify(items),
    taxRate, discount, subtotal, total,
    data.status || inv.status,
    data.due_date !== undefined ? data.due_date : inv.due_date,
    data.notes !== undefined ? data.notes : inv.notes,
    now, id
  );
  return getInvoice(id);
}

export function deleteInvoice(id) {
  const inv = getInvoice(id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  return { deleted: true };
}

export function generateInvoiceHTML(inv) {
  const items = Array.isArray(inv.items) ? inv.items : JSON.parse(inv.items || '[]');
  const getQty = (i) => Number(i.quantity ?? i.qty) || 0;
  const subtotal = items.reduce((s, i) => s + getQty(i) * (Number(i.rate) || 0), 0);
  const tax      = subtotal * ((Number(inv.tax_rate) || 0) / 100);
  const discount = Number(inv.discount) || 0;
  const total    = subtotal + tax - discount;

  const fmt = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtDate = (d) => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const dateStr = fmtDate(inv.created_at || new Date());
  const dueDateStr = inv.due_date ? fmtDate(inv.due_date) : '—';

  const statusColor = { draft: '#888', sent: '#f59e0b', paid: '#10b981', overdue: '#ef4444' };
  const statusBg    = { draft: '#f3f4f6', sent: '#fffbeb', paid: '#ecfdf5', overdue: '#fef2f2' };
  const st = inv.status || 'draft';

  const itemRows = items.map((item, idx) => {
    const qty = getQty(item);
    const amount = qty * (Number(item.rate) || 0);
    return `
    <tr>
      <td class="td-num">${idx + 1}</td>
      <td class="td-desc">${item.description || ''}</td>
      <td class="td-right">${qty}</td>
      <td class="td-right">₹${fmt(item.rate || 0)}</td>
      <td class="td-right td-amount">₹${fmt(amount)}</td>
    </tr>`;
  }).join('');

  const emptyRows = Math.max(0, 5 - items.length);
  const blankRows = Array.from({ length: emptyRows }, () =>
    `<tr><td class="td-num">&nbsp;</td><td class="td-desc">&nbsp;</td><td class="td-right">&nbsp;</td><td class="td-right">&nbsp;</td><td class="td-right">&nbsp;</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${inv.invoice_number} — AdGrades</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #f5f5f5;
    color: #1a1a1a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: #fff;
    display: flex;
    flex-direction: column;
  }

  /* ── TOP ACCENT BAR ── */
  .accent-bar {
    height: 6px;
    background: linear-gradient(90deg, #00c8ff 0%, #0090c0 100%);
  }

  /* ── HEADER ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10mm 12mm 6mm;
    border-bottom: 1px solid #e8e8e8;
  }
  .logo-wrap img { height: 52px; display: block; }
  .logo-wrap .tagline {
    font-size: 8.5px;
    color: #888;
    margin-top: 5px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .header-right { text-align: right; }
  .invoice-title {
    font-size: 30px;
    font-weight: 800;
    color: #00c8ff;
    letter-spacing: 3px;
    line-height: 1;
  }
  .invoice-num {
    font-size: 13px;
    color: #555;
    margin-top: 4px;
    font-weight: 600;
  }
  .status-badge {
    display: inline-block;
    margin-top: 8px;
    padding: 3px 12px;
    border-radius: 20px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: ${statusColor[st]};
    background: ${statusBg[st]};
    border: 1px solid ${statusColor[st]}40;
  }

  /* ── ADDRESS BAR ── */
  .address-bar {
    background: #00c8ff;
    padding: 5px 12mm;
    font-size: 8.5px;
    font-weight: 700;
    color: #003a4f;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }

  /* ── META ROW ── */
  .meta-row {
    display: flex;
    justify-content: space-between;
    padding: 8mm 12mm 6mm;
    gap: 12mm;
  }
  .bill-block { flex: 1; }
  .bill-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #00c8ff;
    margin-bottom: 5px;
  }
  .bill-name { font-size: 13px; font-weight: 700; color: #1a1a1a; }
  .bill-addr { font-size: 10px; color: #555; line-height: 1.6; margin-top: 3px; }
  .dates-block { min-width: 130px; }
  .date-row { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 5px; }
  .date-key { font-size: 9.5px; color: #888; font-weight: 600; }
  .date-val { font-size: 9.5px; color: #1a1a1a; font-weight: 700; text-align: right; }

  /* ── SERVICES TAG LINE ── */
  .services-row {
    display: flex;
    gap: 6px;
    padding: 0 12mm 6mm;
    flex-wrap: wrap;
  }
  .svc-tag {
    font-size: 9px;
    color: #444;
    background: #f0fbff;
    border: 1px solid #b8ecfc;
    border-radius: 20px;
    padding: 2px 10px;
    font-weight: 600;
  }

  /* ── ITEMS TABLE ── */
  .items-wrap { padding: 0 12mm; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  thead tr {
    background: #00c8ff;
    color: #003a4f;
  }
  thead th {
    padding: 8px 10px;
    text-align: left;
    font-weight: 700;
    font-size: 9.5px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  thead th.th-right { text-align: right; }
  tbody tr { border-bottom: 1px solid #f0f0f0; }
  tbody tr:nth-child(even) { background: #fafeff; }
  .td-num { width: 28px; padding: 9px 10px; color: #aaa; font-size: 9px; }
  .td-desc { padding: 9px 10px; color: #222; }
  .td-right { padding: 9px 10px; text-align: right; color: #444; }
  .td-amount { font-weight: 700; color: #1a1a1a; }

  /* ── BOTTOM ── */
  .bottom-wrap {
    display: flex;
    gap: 0;
    padding: 6mm 12mm 8mm;
    margin-top: 4mm;
  }
  .left-col { flex: 1.1; padding-right: 8mm; }
  .right-col { flex: 0.9; border-left: 1px solid #e8e8e8; padding-left: 8mm; }

  /* Totals */
  .total-line {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    font-size: 10.5px;
    color: #555;
    border-bottom: 1px dashed #eee;
  }
  .total-line:last-child { border-bottom: none; }
  .total-grand {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
    padding: 8px 14px;
    background: #00c8ff;
    border-radius: 8px;
  }
  .total-grand-label { font-size: 13px; font-weight: 800; color: #003a4f; }
  .total-grand-amount { font-size: 18px; font-weight: 800; color: #003a4f; }

  /* Payment */
  .section-title {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #00c8ff;
    margin: 10px 0 6px;
  }
  .pay-row { display: flex; font-size: 9.5px; margin-bottom: 3px; }
  .pay-key { color: #888; font-weight: 600; min-width: 90px; }
  .pay-val { color: #1a1a1a; font-weight: 700; }
  .upi-badge {
    display: inline-block;
    background: #ecfdf5;
    border: 1px solid #10b981;
    color: #065f46;
    font-size: 9px;
    font-weight: 700;
    border-radius: 4px;
    padding: 2px 8px;
    margin-bottom: 6px;
  }

  /* Terms & Signature */
  .terms-list { font-size: 8.5px; color: #666; line-height: 1.7; }
  .terms-list li { margin-bottom: 2px; }
  .signature-area {
    margin-top: 20px;
    border-top: 1.5px solid #1a1a1a;
    padding-top: 38px;
    font-size: 10px;
    color: #888;
    text-align: center;
  }

  /* ── FOOTER ── */
  .footer {
    margin-top: auto;
    border-top: 3px solid #1a1a1a;
    position: relative;
    padding: 6px 12mm;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer::before {
    content: '';
    position: absolute;
    top: -3px; left: 0;
    width: 35%;
    height: 3px;
    background: #00c8ff;
  }
  .footer-thanks { font-size: 12px; font-weight: 800; }
  .footer-thanks span { color: #00c8ff; }
  .footer-contact { font-size: 8.5px; color: #666; text-align: right; line-height: 1.6; }

  /* ── PRINT BUTTON ── */
  .print-btn {
    position: fixed;
    top: 16px; right: 16px;
    background: #00c8ff;
    color: #003a4f;
    border: none;
    padding: 10px 22px;
    font-size: 13px;
    font-weight: 800;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,200,255,.4);
    z-index: 999;
  }
  @media print { .print-btn { display: none; } body { background: white; } }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
<div class="page">
  <div class="accent-bar"></div>

  <!-- HEADER -->
  <div class="header">
    <div class="logo-wrap">
      <img src="/adgrades-logo.png" alt="AdGrades">
      <div class="tagline">Creative Agency · EST. 2023</div>
    </div>
    <div class="header-right">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-num">${inv.invoice_number}</div>
      <div class="status-badge">${st.toUpperCase()}</div>
    </div>
  </div>

  <!-- ADDRESS BAR -->
  <div class="address-bar">
    📍 Vinayaka Industries, Behind KMF Cattle Feed Factory, Gandhinagar, K Hoskoppal, Hassan — 573201
  </div>

  <!-- META ROW -->
  <div class="meta-row">
    <div class="bill-block">
      <div class="bill-label">Billed To</div>
      <div class="bill-name">${inv.client_name || 'Client Business Name'}</div>
      <div class="bill-addr">${(inv.client_address || '—').replace(/\n/g, '<br>')}</div>
    </div>
    <div class="bill-block">
      <div class="bill-label">From</div>
      <div class="bill-name">Chandan B Krishna</div>
      <div class="bill-addr">CEO, AdGrades Creative Agency<br>Hassan 573201, Karnataka<br>+91 96863 14869 · info@adgrades.in</div>
    </div>
    <div class="dates-block">
      <div class="date-row"><span class="date-key">Issue Date</span><span class="date-val">${dateStr}</span></div>
      <div class="date-row"><span class="date-key">Due Date</span><span class="date-val">${dueDateStr}</span></div>
      ${inv.notes ? `<div style="margin-top:8px;font-size:9px;color:#888;font-style:italic">${inv.notes}</div>` : ''}
    </div>
  </div>

  <!-- SERVICES TAGS -->
  <div class="services-row">
    <span class="svc-tag">Software Development</span>
    <span class="svc-tag">Automation &amp; Business Analysis</span>
    <span class="svc-tag">Brand Building</span>
    <span class="svc-tag">Performance Marketing</span>
  </div>

  <!-- ITEMS TABLE -->
  <div class="items-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:28px">#</th>
          <th>Description</th>
          <th class="th-right" style="width:60px">Qty</th>
          <th class="th-right" style="width:90px">Unit Price</th>
          <th class="th-right" style="width:90px">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        ${blankRows}
      </tbody>
    </table>
  </div>

  <!-- BOTTOM: TERMS + TOTALS -->
  <div class="bottom-wrap">
    <!-- LEFT: Terms + Signature -->
    <div class="left-col">
      <div class="section-title">Terms &amp; Conditions</div>
      <ol class="terms-list">
        <li>50% advance payment required before project kickoff.</li>
        <li>Balance due within 2 days of project delivery.</li>
        <li>All special requirements must be communicated in advance.</li>
        <li>Client must provide timely feedback on drafts and revisions.</li>
        <li>This invoice is subject to applicable taxes as per government norms.</li>
      </ol>
      <div class="signature-area">Authorised Signature &amp; Seal</div>
    </div>

    <!-- RIGHT: Totals + Payment -->
    <div class="right-col">
      <div class="total-line"><span>Subtotal</span><span>₹${fmt(subtotal)}</span></div>
      <div class="total-line"><span>GST / Tax (${inv.tax_rate || 0}%)</span><span>₹${fmt(tax)}</span></div>
      ${discount > 0 ? `<div class="total-line" style="color:#10b981"><span>Discount</span><span>− ₹${fmt(discount)}</span></div>` : ''}
      <div class="total-grand">
        <span class="total-grand-label">TOTAL DUE</span>
        <span class="total-grand-amount">₹${fmt(total)}</span>
      </div>

      <div class="section-title" style="margin-top:14px">Payment Methods</div>
      <div class="upi-badge">UPI: 9686373869@jupiteraxis</div>
      <div class="pay-row"><span class="pay-key">Bank</span><span class="pay-val">Federal Bank</span></div>
      <div class="pay-row"><span class="pay-key">Account No</span><span class="pay-val">77770123900470</span></div>
      <div class="pay-row"><span class="pay-key">IFSC</span><span class="pay-val">FDRL0007777</span></div>
      <div class="pay-row"><span class="pay-key">Name</span><span class="pay-val">Chandan B Krishna</span></div>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-thanks"><span>THANK YOU</span> FOR YOUR BUSINESS.</div>
    <div class="footer-contact">
      info@adgrades.in &nbsp;|&nbsp; +91 79750 61984<br>
      www.adgrades.in
    </div>
  </div>
</div>
</body>
</html>`;
}
