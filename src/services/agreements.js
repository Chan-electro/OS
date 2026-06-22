import db from '../db.js';
import { AppError } from './users.js';

export function listAgreements({ client_id, status, page = 1, pageSize = 25 }) {
  const cond = [], params = [];
  if (client_id) { cond.push('a.client_id = ?'); params.push(client_id); }
  if (status)    { cond.push('a.status = ?');    params.push(status); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) as n FROM agreements a ${where}`).get(...params).n;
  const data  = db.prepare(`
    SELECT a.*, c.name as client_display_name
    FROM agreements a
    LEFT JOIN clients c ON a.client_id = c.id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);
  return { data: data.map(r => ({ ...r, content: JSON.parse(r.content || '{}') })), total, page, pageSize };
}

export function getAgreement(id) {
  const row = db.prepare('SELECT * FROM agreements WHERE id = ?').get(id);
  if (!row) throw new AppError('NOT_FOUND', 'Agreement not found.', 404);
  return { ...row, content: JSON.parse(row.content || '{}') };
}

export function createAgreement(data, userId) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO agreements (client_id, client_name, content, status, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    data.client_id || null,
    data.client_name || null,
    JSON.stringify(data.content || {}),
    data.status || 'draft',
    userId, now, now
  );
  return getAgreement(result.lastInsertRowid);
}

export function updateAgreement(id, data) {
  const agr = getAgreement(id);
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE agreements SET client_id=?, client_name=?, content=?, status=?, updated_at=? WHERE id=?
  `).run(
    data.client_id !== undefined ? data.client_id : agr.client_id,
    data.client_name !== undefined ? data.client_name : agr.client_name,
    JSON.stringify(data.content !== undefined ? data.content : agr.content),
    data.status || agr.status,
    now, id
  );
  return getAgreement(id);
}

export function deleteAgreement(id) {
  getAgreement(id);
  db.prepare('DELETE FROM agreements WHERE id = ?').run(id);
  return { deleted: true };
}

export function generateAgreementHTML(agr) {
  const d = typeof agr.content === 'string' ? JSON.parse(agr.content) : (agr.content || {});
  const f = d.formData || d;
  const selectedServices  = d.selectedServices  || [];
  const customServices    = d.customServices    || [];

  const agreementDate = f.agreementDate ? new Date(f.agreementDate) : new Date();
  const fmtDate = dt => dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const formattedDate = fmtDate(agreementDate);

  const startDate = f.commencementDate ? new Date(f.commencementDate) : null;
  const formattedStart = startDate ? fmtDate(startDate) : '[Start Date]';
  let formattedEnd = '[End Date]';
  if (startDate && f.termMonths) {
    const end = new Date(startDate);
    end.setMonth(end.getMonth() + parseInt(f.termMonths));
    formattedEnd = fmtDate(end);
  }

  const servicesHtml = selectedServices.map((s, i) => `
    <div class="service-item">
      <div style="font-weight:600;font-size:11pt;color:#0f172a">${i+1}. ${s.serviceLabel || s.name || ''}</div>
      <p style="color:#475569;font-style:italic;font-size:9pt;margin-top:2px">${s.fullDescription || ''}</p>
      <p style="margin-top:4px;font-size:9.5pt">${s.description || ''}</p>
    </div>`).join('');

  const customHtml = customServices.map((s, i) => `
    <div class="service-item">
      <div style="font-weight:600;font-size:11pt;color:#0f172a">${selectedServices.length + i + 1}. ${s.title || '[Custom Service]'}</div>
      <p style="margin-top:4px;font-size:9.5pt">${s.description || ''}</p>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><title>Service Agreement — ${f.clientName || agr.client_name || 'Client'}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 20mm 22mm; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.65;
    color: #334155;
    background: white;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .accent-bar {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 5px;
    background: linear-gradient(90deg, #00c8ff 0%, #0090c0 100%);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
    padding-bottom: 16px;
    border-bottom: 2px solid #00c8ff;
  }
  .logo { height: 44px; display: block; }
  .header-right { text-align: right; }
  .doc-title {
    font-size: 20pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: 1px;
    text-transform: uppercase;
    line-height: 1;
  }
  .doc-subtitle { font-size: 9pt; color: #00c8ff; font-weight: 700; margin-top: 4px; letter-spacing: 0.5px; }
  .status-badge {
    display: inline-block;
    margin-top: 6px;
    padding: 2px 10px;
    border-radius: 20px;
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    background: #f0fbff;
    color: #0090c0;
    border: 1px solid #b8ecfc;
  }
  h3 {
    font-size: 9pt;
    font-weight: 800;
    color: #0f172a;
    margin-top: 22px;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding-bottom: 3px;
    border-bottom: 1.5px solid #00c8ff;
    page-break-after: avoid;
  }
  p { margin-bottom: 8px; text-align: justify; }
  strong { color: #0f172a; font-weight: 700; }
  ul { padding-left: 24px; margin-bottom: 12px; }
  li { margin-bottom: 4px; }
  .service-list {
    margin: 12px 0 16px;
    border-left: 3px solid #00c8ff;
    padding-left: 16px;
    page-break-inside: avoid;
  }
  .service-item { margin-bottom: 14px; page-break-inside: avoid; }
  .page-break { page-break-before: always; }
  .signature-section { margin-top: 50px; page-break-inside: avoid; page-break-before: always; }
  .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; margin-top: 24px; }
  .sig-block p { margin-bottom: 5px; }
  .signature-line {
    border-bottom: 1.5px solid #1a1a1a;
    margin-top: 44px;
    margin-bottom: 8px;
  }
  .footer {
    margin-top: 50px;
    text-align: center;
    font-size: 7.5pt;
    color: #94a3b8;
    border-top: 1px solid #e2e8f0;
    padding-top: 10px;
  }
  .print-btn {
    position: fixed;
    top: 14px; right: 14px;
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
  @media print { .print-btn { display: none; } .accent-bar { display: none; } }
</style>
</head>
<body>
<div class="accent-bar"></div>
<button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
<div class="header">
  <img src="/adgrades-logo.png" alt="AdGrades" class="logo">
  <div class="header-right">
    <div class="doc-title">Service Agreement</div>
    <div class="doc-subtitle">AdGrades × ${f.clientName || agr.client_name || 'Client'}</div>
    <div class="status-badge">${(agr.status || 'draft').toUpperCase()}</div>
  </div>
</div>

<p>This Service Agreement (<strong>"Agreement"</strong>) is formally entered into on <strong>${formattedDate}</strong>, by and between:</p>
<ul style="padding-left:30px;margin-bottom:15px">
  <li><strong>AdGrades</strong>, a marketing agency, Bangalore, Karnataka, India ("Agency"); and</li>
  <li><strong>${f.clientName || agr.client_name || '[Client Name]'}</strong>, ${f.clientAddress || '[Address]'} ("Client").</li>
</ul>

<h3>1. DEFINITIONS</h3>
<p style="margin-left:20px"><strong>1.1</strong> "Commencement Date" is ${formattedStart}.</p>
<p style="margin-left:20px"><strong>1.2</strong> "Term" is ${f.termMonths || '0'} months, commencing ${formattedStart} and ending ${formattedEnd}.</p>

<h3>2. SCOPE OF SERVICES</h3>
<div class="service-list">${servicesHtml}${customHtml || '<div class="service-item"><p>As agreed during onboarding.</p></div>'}</div>

<h3>5. FEES &amp; PAYMENT</h3>
<p><strong>5.1</strong> Monthly fee: INR ${f.totalFee || f.firstMonthFee || '—'}.</p>
<p><strong>5.2</strong> Month 1 (INR ${f.firstMonthFee || '—'}) due before ${formattedStart}.</p>
<p><strong>5.3</strong> Late payment: INR ${f.lateFeePerDay || '500'}/day after ${f.gracePeriodDays || '3'}-day grace period.</p>

<h3>6. SERVICE RULES</h3>
<p><strong>6.1</strong> Max ${f.revisionsPerDeliverable || '2'} revisions per deliverable.</p>
<p><strong>6.2</strong> Client must respond within ${f.clientResponseHours || '48'} hours of Agency requests.</p>
<p><strong>6.3</strong> Working hours: Mon–Sat, 10 AM – 7 PM IST.</p>

<h3>7. COMMUNICATION</h3>
<p>Primary: WhatsApp. Agency: ${f.agencyRepName || 'Chandan B Krishna'} (${f.agencyContact || '+91 80736 98913'}). Client: ${f.clientRepName || '—'} (${f.clientContact || '—'}).</p>
<p>Reporting: Weekly snapshots + monthly report.</p>

<div class="page-break"></div>

<h3>8. CONFIDENTIALITY</h3>
<p>Both parties maintain confidentiality of proprietary information for 3 years post-termination.</p>

<h3>9. TERMINATION</h3>
<p>Either party may terminate with 15 days written notice. Fees for the current month are non-refundable.</p>

<h3>10. LIMITATION OF LIABILITY</h3>
<p>Agency liability capped at one month's fee. No liability for indirect or consequential damages.</p>

<h3>11. OWNERSHIP</h3>
<p>Upon full payment, Client owns final deliverables. Agency retains portfolio rights (no confidential data disclosed).</p>

<h3>14. JURISDICTION</h3>
<p>Disputes resolved under jurisdiction of courts in Bangalore, Karnataka, India.</p>

<div class="signature-section">
  <p><strong>IN WITNESS WHEREOF</strong>, the Parties have executed this Agreement on ${formattedDate}.</p>
  <div class="signature-grid">
    <div>
      <p><strong>For AdGrades</strong></p>
      <p>Name: <strong>Chandan B Krishna</strong></p>
      <p>Designation: CEO</p>
      <div class="signature-line"></div>
      <p>Signature &nbsp;&nbsp;&nbsp; Date: ${formattedDate}</p>
    </div>
    <div>
      <p><strong>For ${f.clientName || agr.client_name || 'Client'}</strong></p>
      <p>Name: ${f.clientRepName || '________________________________'}</p>
      <p>Designation: ${f.clientRepDesignation || '________________________________'}</p>
      <div class="signature-line"></div>
      <p>Signature &nbsp;&nbsp;&nbsp; Date: ________________________________</p>
    </div>
  </div>
</div>

<div class="footer">AdGrades Marketing Agency • Service Agreement • Confidential</div>
</body>
</html>`;
}
