import express from 'express';
import { authRequired, roleRequired, adminOnly } from '../auth.js';
import { createUser, getUserById, listUsers, updateUser } from '../services/users.js';

const router = express.Router();

// Managers and Admins can list users
router.get('/', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const users = listUsers(req.user.role);
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// Admin-only endpoints below
router.post('/', authRequired, adminOnly, (req, res, next) => {
  try {
    const newUser = createUser(req.body);
    res.status(201).json(newUser);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authRequired, adminOnly, (req, res, next) => {
  try {
    const user = getUserById(parseInt(req.params.id, 10));
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authRequired, adminOnly, (req, res, next) => {
  try {
    const updated = updateUser(parseInt(req.params.id, 10), req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
