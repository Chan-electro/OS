import express from 'express';
import { authRequired, roleRequired } from '../auth.js';
import { createClient, getClientById, listClients, updateClient } from '../services/clients.js';

const router = express.Router();

router.get('/', authRequired, (req, res, next) => {
  try {
    const { status, search, page, pageSize } = req.query;
    const filter = {
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25
    };
    
    const result = listClients(filter, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const newClient = createClient(req.body, req.user.id);
    res.status(201).json(newClient);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authRequired, (req, res, next) => {
  try {
    const client = getClientById(parseInt(req.params.id, 10), req.user);
    res.json(client);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const updated = updateClient(parseInt(req.params.id, 10), req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
