import express from 'express';
import { authRequired, roleRequired } from '../auth.js';
import { createContentItem, getContentItemById, listContentItems, updateContentItem } from '../services/content.js';

const router = express.Router();

router.get('/', authRequired, (req, res, next) => {
  try {
    const { client_id, status, from, to, page, pageSize } = req.query;
    const filters = {
      client_id: client_id ? parseInt(client_id, 10) : undefined,
      status,
      from,
      to,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25
    };
    
    const result = listContentItems(filters, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const item = createContentItem(req.body);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authRequired, (req, res, next) => {
  try {
    const item = getContentItemById(parseInt(req.params.id, 10), req.user);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authRequired, (req, res, next) => {
  try {
    const updated = updateContentItem(parseInt(req.params.id, 10), req.body, req.user);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
