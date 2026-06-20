import express from 'express';
import { authRequired, adminOnly } from '../auth.js';
import * as lifeService from '../services/life.js';

const router = express.Router();

// Apply auth & role gate on ALL life endpoints
router.use(authRequired, adminOnly);

/**
 * Habits
 */
router.get('/habits', (req, res, next) => {
  try {
    const list = lifeService.listHabits(req.user.id);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post('/habits', (req, res, next) => {
  try {
    const habit = lifeService.createHabit(req.user.id, req.body);
    res.status(201).json(habit);
  } catch (err) {
    next(err);
  }
});

router.patch('/habits/:id', (req, res, next) => {
  try {
    const updated = lifeService.updateHabit(parseInt(req.params.id, 10), req.user.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/habits/:id/log', (req, res, next) => {
  try {
    const result = lifeService.logHabit(parseInt(req.params.id, 10), req.user.id, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Health Logs
 */
router.get('/health', (req, res, next) => {
  try {
    const list = lifeService.listHealthLogs(req.user.id, req.query);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post('/health', (req, res, next) => {
  try {
    const log = lifeService.createHealthLog(req.user.id, req.body);
    res.status(201).json(log);
  } catch (err) {
    next(err);
  }
});

/**
 * Finance
 */
router.get('/finance', (req, res, next) => {
  try {
    const list = lifeService.listFinanceEntries(req.user.id, req.query);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post('/finance', (req, res, next) => {
  try {
    const entry = lifeService.createFinanceEntry(req.user.id, req.body);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

router.get('/finance/summary', (req, res, next) => {
  try {
    const summary = lifeService.getFinanceSummary(req.user.id, req.query);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * Learning Items
 */
router.get('/learning', (req, res, next) => {
  try {
    const list = lifeService.listLearningItems(req.user.id);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post('/learning', (req, res, next) => {
  try {
    const item = lifeService.createLearningItem(req.user.id, req.body);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.patch('/learning/:id', (req, res, next) => {
  try {
    const updated = lifeService.updateLearningItem(parseInt(req.params.id, 10), req.user.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * Journaling
 */
router.get('/journal', (req, res, next) => {
  try {
    const list = lifeService.listJournalEntries(req.user.id, req.query);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post('/journal', (req, res, next) => {
  try {
    const entry = lifeService.createJournalEntry(req.user.id, req.body);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

/**
 * Content Ideas
 */
router.get('/content-ideas', (req, res, next) => {
  try {
    const list = lifeService.listContentIdeas(req.user.id);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post('/content-ideas', (req, res, next) => {
  try {
    const idea = lifeService.createContentIdea(req.user.id, req.body);
    res.status(201).json(idea);
  } catch (err) {
    next(err);
  }
});

router.patch('/content-ideas/:id', (req, res, next) => {
  try {
    const updated = lifeService.updateContentIdea(parseInt(req.params.id, 10), req.user.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * Calendar Events
 */
router.get('/events', (req, res, next) => {
  try {
    const list = lifeService.listCalendarEvents(req.user.id, req.query);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post('/events', (req, res, next) => {
  try {
    const event = lifeService.createCalendarEvent(req.user.id, req.body);
    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});

router.patch('/events/:id', (req, res, next) => {
  try {
    const updated = lifeService.updateCalendarEvent(parseInt(req.params.id, 10), req.user.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/events/:id', (req, res, next) => {
  try {
    const result = lifeService.deleteCalendarEvent(parseInt(req.params.id, 10), req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
