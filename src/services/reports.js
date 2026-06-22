import db from '../db.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPORTS_DIR = path.join(__dirname, '../../reports');

export function getClientReportData(clientId, month) {
  const [year, mon] = month.split('-');
  const from = `${year}-${mon}-01`;
  const lastDay = new Date(parseInt(year), parseInt(mon), 0).getDate();
  const to = `${year}-${mon}-${String(lastDay).padStart(2, '0')}`;

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) throw new Error('Client not found');

  const tasks = db.prepare(`
    SELECT t.*, u.name as assignee_name, p.name as project_name
    FROM tasks t
    LEFT JOIN users u ON t.assignee_id = u.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.client_id = ? AND t.due_date >= ? AND t.due_date <= ?
    ORDER BY
      CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      t.due_date ASC
  `).all(clientId, from, to);

  const projects = db.prepare('SELECT * FROM projects WHERE client_id = ? ORDER BY name ASC').all(clientId);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const inReview = tasks.filter(t => t.status === 'in_review').length;
  const todo = tasks.filter(t => t.status === 'todo').length;
  const overdue = tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < today).length;

  return {
    client, tasks, projects,
    stats: { total: tasks.length, done, inProgress, inReview, todo, overdue },
    month, from, to,
    generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  };
}

export function buildPDF(data, outputPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const { client, tasks, projects, stats, month, generatedAt } = data;
    const [year, mon] = month.split('-');
    const monthLabel = new Date(parseInt(year), parseInt(mon) - 1, 1)
      .toLocaleString('en-IN', { month: 'long', year: 'numeric' });

    const C = {
      black:  '#111111',
      gray:   '#6b7280',
      lgray:  '#e5e7eb',
      red:    '#dc2626',
      green:  '#16a34a',
      blue:   '#2563eb',
      yellow: '#d97706',
      bg:     '#f9fafb',
    };

    // ── Header ──────────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').fillColor(C.black).text('AdGrades OS');
    doc.fontSize(10).font('Helvetica').fillColor(C.gray).text('Client Monthly Report');
    doc.fontSize(9).fillColor(C.gray)
      .text(`Generated: ${generatedAt}`, { align: 'right' })
      .moveUp(1);

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(1).stroke(C.lgray);
    doc.moveDown(0.8);

    // ── Client Info ─────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').fillColor(C.black).text(client.name);
    doc.fontSize(13).font('Helvetica').fillColor(C.gray).text(monthLabel);
    doc.moveDown(0.6);

    const infoRows = [
      ['Industry',  client.industry   || '—'],
      ['Contact',   client.contact_name  || '—'],
      ['Email',     client.contact_email || '—'],
      ['Phone',     client.contact_phone || '—'],
      ['Status',    (client.status || 'active').toUpperCase()],
      ['Retainer',  client.retainer_amount
        ? `₹${Number(client.retainer_amount).toLocaleString('en-IN')}`
        : '—'],
    ];
    infoRows.forEach(([lbl, val]) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor(C.gray)
        .text(lbl, { continued: true, width: 70 });
      doc.font('Helvetica').fillColor(C.black).text(`  ${val}`);
    });

    doc.moveDown(1);

    // ── Stats boxes ─────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').fillColor(C.black).text('Task Summary');
    doc.moveDown(0.5);

    const boxItems = [
      ['Total',       stats.total,      C.black],
      ['Completed',   stats.done,       C.green],
      ['In Progress', stats.inProgress, C.blue],
      ['In Review',   stats.inReview,   C.yellow],
      ['Pending',     stats.todo,       C.gray],
      ['Overdue',     stats.overdue,    C.red],
    ];
    const pct = stats.total > 0 ? `${Math.round((stats.done / stats.total) * 100)}%` : 'N/A';

    const bw = 80, bh = 52, gap = 6;
    const rowY = doc.y;
    let bx = 50;
    boxItems.forEach(([lbl, val, col]) => {
      doc.roundedRect(bx, rowY, bw, bh, 5).fillAndStroke(C.bg, C.lgray);
      doc.fontSize(20).font('Helvetica-Bold').fillColor(col)
        .text(String(val), bx + 2, rowY + 8, { width: bw - 4, align: 'center' });
      doc.fontSize(7).font('Helvetica').fillColor(C.gray)
        .text(lbl, bx + 2, rowY + 36, { width: bw - 4, align: 'center' });
      bx += bw + gap;
    });
    doc.y = rowY + bh + 10;

    // Completion rate badge
    doc.fontSize(11).font('Helvetica-Bold').fillColor(C.green)
      .text(`Completion Rate: ${pct}`, { align: 'right' });
    doc.moveDown(1);

    // ── Projects ────────────────────────────────────────────
    if (projects.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(C.black).text('Projects');
      doc.moveDown(0.4);
      projects.forEach(p => {
        const renewStr = p.renewal_date ? `  · Renews ${p.renewal_date}` : '';
        doc.fontSize(9).font('Helvetica-Bold').fillColor(C.black)
          .text(`▸ ${p.name}`, { continued: true });
        doc.font('Helvetica').fillColor(C.gray)
          .text(`  ${p.type} · ${p.status}${renewStr}`);
      });
      doc.moveDown(1);
    }

    // ── Task Groups ─────────────────────────────────────────
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    const groups = [
      { label: 'Completed',   color: C.green,  filter: t => t.status === 'done' },
      { label: 'In Progress', color: C.blue,   filter: t => t.status === 'in_progress' },
      { label: 'In Review',   color: C.yellow, filter: t => t.status === 'in_review' },
      { label: 'Pending',     color: C.gray,   filter: t => t.status === 'todo' },
    ];

    groups.forEach(g => {
      const list = tasks.filter(g.filter);
      if (list.length === 0) return;

      if (doc.y > 680) doc.addPage();

      doc.fontSize(11).font('Helvetica-Bold').fillColor(g.color)
        .text(`${g.label}  (${list.length})`);
      doc.moveDown(0.3);

      list.forEach(t => {
        if (doc.y > 720) doc.addPage();
        const isOverdue = t.status !== 'done' && t.due_date && t.due_date < today;
        doc.fontSize(9).font('Helvetica-Bold').fillColor(isOverdue ? C.red : C.black)
          .text(`▸ ${t.title}`, { continued: true });
        doc.font('Helvetica').fillColor(C.gray)
          .text(`  [${t.priority.toUpperCase()}]` +
            (t.due_date   ? `  Due: ${t.due_date}` : '') +
            (t.assignee_name ? `  ·  ${t.assignee_name}` : ''));
        if (t.description) {
          doc.fontSize(8).fillColor(C.gray)
            .text(t.description, { indent: 14, width: 480 });
        }
        doc.moveDown(0.2);
      });
      doc.moveDown(0.7);
    });

    // ── Footer ───────────────────────────────────────────────
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).font('Helvetica').fillColor(C.gray)
        .text(
          `AdGrades OS  ·  Confidential  ·  ${monthLabel} Report for ${client.name}  ·  Page ${i + 1} of ${pageCount}`,
          50, 800, { align: 'center', width: 495 }
        );
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}
