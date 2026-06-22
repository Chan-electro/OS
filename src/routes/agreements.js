import express from 'express';
import { authRequired, roleRequired } from '../auth.js';
import { listAgreements, getAgreement, createAgreement, updateAgreement, deleteAgreement, generateAgreementHTML } from '../services/agreements.js';

const router = express.Router();

router.get('/', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const { client_id, status, page, pageSize } = req.query;
    res.json(listAgreements({
      client_id: client_id ? parseInt(client_id, 10) : undefined,
      status,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25
    }));
  } catch (err) { next(err); }
});

router.post('/', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try { res.status(201).json(createAgreement(req.body, req.user.id)); } catch (err) { next(err); }
});

router.get('/:id/preview', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const agr = getAgreement(parseInt(req.params.id, 10));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(generateAgreementHTML(agr));
  } catch (err) { next(err); }
});

router.get('/:id', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try { res.json(getAgreement(parseInt(req.params.id, 10))); } catch (err) { next(err); }
});

router.patch('/:id', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try { res.json(updateAgreement(parseInt(req.params.id, 10), req.body)); } catch (err) { next(err); }
});

router.delete('/:id', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try { res.status(204).json(deleteAgreement(parseInt(req.params.id, 10))); } catch (err) { next(err); }
});

export default router;
