import express from 'express';
import { authRequired, roleRequired } from '../auth.js';
import { createTask, getTaskById, listTasks, updateTask, approveTask, deleteTask } from '../services/tasks.js';

const router = express.Router();

router.get('/', authRequired, (req, res, next) => {
  try {
    const { status, priority, client_id, project_id, assignee_id, due_before, due_after, mine, page, pageSize } = req.query;

    const filters = {
      status,
      priority,
      client_id: client_id ? parseInt(client_id, 10) : undefined,
      project_id: project_id ? parseInt(project_id, 10) : undefined,
      assignee_id: mine === 'true' ? req.user.id : (assignee_id ? parseInt(assignee_id, 10) : undefined),
      due_before,
      due_after,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25
    };

    const result = listTasks(filters, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const newTask = createTask(req.body, req.user.id);
    res.status(201).json(newTask);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authRequired, (req, res, next) => {
  try {
    const task = getTaskById(parseInt(req.params.id, 10), req.user);
    res.json(task);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authRequired, (req, res, next) => {
  try {
    const updated = updateTask(parseInt(req.params.id, 10), req.body, req.user);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const approved = approveTask(parseInt(req.params.id, 10), req.user);
    res.json(approved);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const result = deleteTask(parseInt(req.params.id, 10), req.user);
    res.status(204).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
