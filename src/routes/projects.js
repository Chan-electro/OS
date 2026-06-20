import express from 'express';
import { authRequired, roleRequired } from '../auth.js';
import { createProject, getProjectById, listProjects, updateProject } from '../services/projects.js';

const router = express.Router();

router.get('/', authRequired, (req, res, next) => {
  try {
    const { client_id, status, page, pageSize } = req.query;
    const filter = {
      client_id: client_id ? parseInt(client_id, 10) : undefined,
      status,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25
    };
    const result = listProjects(filter);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const newProject = createProject(req.body);
    res.status(201).json(newProject);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authRequired, (req, res, next) => {
  try {
    const project = getProjectById(parseInt(req.params.id, 10));
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authRequired, roleRequired(['admin', 'manager']), (req, res, next) => {
  try {
    const updated = updateProject(parseInt(req.params.id, 10), req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
