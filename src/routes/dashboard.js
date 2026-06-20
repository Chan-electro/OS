import express from 'express';
import { authRequired } from '../auth.js';
import { getDashboardData } from '../services/dashboard.js';

const router = express.Router();

router.get('/', authRequired, (req, res, next) => {
  try {
    const data = getDashboardData(req.user);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
