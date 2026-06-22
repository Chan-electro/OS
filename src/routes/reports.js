import express from 'express';
import path from 'path';
import fs from 'fs';
import { authRequired, roleRequired } from '../auth.js';
import { getClientReportData, buildPDF, REPORTS_DIR } from '../services/reports.js';

const router = express.Router();

// Generate PDF for a client + month, save to disk, stream to browser
router.get('/client/:id', authRequired, roleRequired(['admin', 'manager']), async (req, res, next) => {
  try {
    const clientId = parseInt(req.params.id, 10);
    if (isNaN(clientId)) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid client id.' } });

    const month = req.query.month ||
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'month must be YYYY-MM.' } });
    }

    const data = getClientReportData(clientId, month);
    const [year] = month.split('-');
    const safeName = data.client.name.replace(/[^a-zA-Z0-9]/g, '_');
    const outputPath = path.join(REPORTS_DIR, year, month, `${safeName}.pdf`);

    await buildPDF(data, outputPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_${month}.pdf"`);
    fs.createReadStream(outputPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// List all saved reports on disk
router.get('/saved', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    if (!fs.existsSync(REPORTS_DIR)) return res.json([]);

    const files = [];
    const years = fs.readdirSync(REPORTS_DIR).filter(f => /^\d{4}$/.test(f));
    for (const year of years) {
      const yearPath = path.join(REPORTS_DIR, year);
      const months = fs.readdirSync(yearPath).filter(f => /^\d{4}-\d{2}$/.test(f));
      for (const month of months) {
        const monthPath = path.join(yearPath, month);
        const pdfs = fs.readdirSync(monthPath).filter(f => f.endsWith('.pdf'));
        for (const filename of pdfs) {
          const stat = fs.statSync(path.join(monthPath, filename));
          files.push({
            month,
            year,
            filename,
            sizeKb: Math.round(stat.size / 1024),
            generatedAt: stat.mtime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            downloadUrl: `/api/reports/download/${year}/${month}/${encodeURIComponent(filename)}`
          });
        }
      }
    }
    files.sort((a, b) => b.month.localeCompare(a.month) || b.filename.localeCompare(a.filename));
    res.json(files);
  } catch (err) {
    next(err);
  }
});

// Download a previously saved report
router.get('/download/:year/:month/:filename', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const { year, month, filename } = req.params;
    if (!/^\d{4}$/.test(year) || !/^\d{4}-\d{2}$/.test(month) || !/^[\w\-]+\.pdf$/.test(filename)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid path parameters.' } });
    }
    const filePath = path.join(REPORTS_DIR, year, month, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found.' } });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

export default router;
