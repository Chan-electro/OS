import db from '../db.js';
import { AppError } from './users.js';

function validateProjectInput(data, isUpdate = false) {
  const details = {};

  if (!isUpdate || data.name !== undefined) {
    if (!data.name) {
      details.name = 'Project name is required.';
    } else if (data.name.length > 200) {
      details.name = 'Project name must be 200 characters or less.';
    }
  }

  if (!isUpdate || data.client_id !== undefined) {
    if (!data.client_id) {
      details.client_id = 'Client reference is required.';
    } else {
      const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(data.client_id);
      if (!client) {
        details.client_id = 'Referenced client does not exist.';
      }
    }
  }

  if (data.type !== undefined) {
    if (!['retainer', 'one_off'].includes(data.type)) {
      details.type = 'Type must be retainer or one_off.';
    }
  }

  if (data.status !== undefined) {
    if (!['active', 'paused', 'completed'].includes(data.status)) {
      details.status = 'Status must be active, paused, or completed.';
    }
  }

  if (data.start_date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(data.start_date) || isNaN(Date.parse(data.start_date))) {
      details.start_date = 'Start date must be a valid date in YYYY-MM-DD format.';
    }
  }

  if (data.renewal_date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(data.renewal_date) || isNaN(Date.parse(data.renewal_date))) {
      details.renewal_date = 'Renewal date must be a valid date in YYYY-MM-DD format.';
    }
  }

  if (Object.keys(details).length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Validation failed.', 400, details);
  }
}

export function createProject(projectData) {
  validateProjectInput(projectData);

  const {
    client_id,
    name,
    type = 'retainer',
    status = 'active',
    start_date = null,
    renewal_date = null,
    notes = null
  } = projectData;

  try {
    const result = db.prepare(`
      INSERT INTO projects (client_id, name, type, status, start_date, renewal_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(client_id, name, type, status, start_date, renewal_date, notes);

    return getProjectById(result.lastInsertRowid);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to create project.', 500);
  }
}

export function getProjectById(id) {
  const project = db.prepare(`
    SELECT p.*, c.name as client_name 
    FROM projects p
    JOIN clients c ON p.client_id = c.id
    WHERE p.id = ?
  `).get(id);

  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found.', 404);
  }
  return project;
}

export function listProjects({ client_id, status, page = 1, pageSize = 25 }) {
  const offset = (page - 1) * pageSize;
  const conditions = [];
  const params = [];

  if (client_id) {
    conditions.push('p.client_id = ?');
    params.push(client_id);
  }

  if (status) {
    conditions.push('p.status = ?');
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM projects p ${whereClause}`).get(...params);
  const total = countRow.total;

  const dataParams = [...params, pageSize, offset];
  const data = db.prepare(`
    SELECT p.*, c.name as client_name
    FROM projects p
    JOIN clients c ON p.client_id = c.id
    ${whereClause}
    ORDER BY p.name ASC
    LIMIT ? OFFSET ?
  `).all(...dataParams);

  return {
    data,
    page,
    pageSize,
    total
  };
}

export function updateProject(id, updates) {
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Project not found.', 404);
  }

  validateProjectInput(updates, true);

  const fields = [];
  const params = [];
  const allowedFields = ['client_id', 'name', 'type', 'status', 'start_date', 'renewal_date', 'notes'];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      params.push(updates[field] === '' ? null : updates[field]);
    }
  }

  if (fields.length === 0) {
    return getProjectById(id);
  }

  params.push(id);
  const query = `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`;

  try {
    db.prepare(query).run(...params);
    return getProjectById(id);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to update project.', 500);
  }
}
