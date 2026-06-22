import express from 'express';
import { authRequired, roleRequired } from '../auth.js';
import { listInvoices, getInvoice, createInvoice, updateInvoice, deleteInvoice, generateInvoiceHTML, nextInvoiceNumber } from '../services/invoices.js';

const router = express.Router();

router.get('/next-number', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try { res.json(nextInvoiceNumber()); } catch (err) { next(err); }
});

router.get('/', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const { client_id, status, page, pageSize } = req.query;
    res.json(listInvoices({
      client_id: client_id ? parseInt(client_id, 10) : undefined,
      status,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25
    }, req.user));
  } catch (err) { next(err); }
});

router.post('/', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try { res.status(201).json(createInvoice(req.body, req.user.id)); } catch (err) { next(err); }
});

router.get('/:id/preview', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const inv = getInvoice(parseInt(req.params.id, 10));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(generateInvoiceHTML(inv));
  } catch (err) { next(err); }
});

router.get('/:id', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try { res.json(getInvoice(parseInt(req.params.id, 10))); } catch (err) { next(err); }
});

router.patch('/:id', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try { res.json(updateInvoice(parseInt(req.params.id, 10), req.body, req.user.id)); } catch (err) { next(err); }
});

router.delete('/:id', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try { res.status(204).json(deleteInvoice(parseInt(req.params.id, 10))); } catch (err) { next(err); }
});

export default router;
