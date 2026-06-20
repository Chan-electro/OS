import db from '../db.js';
import { AppError } from './users.js';

function validateContentInput(data, isUpdate = false) {
  const details = {};

  if (!isUpdate || data.title !== undefined) {
    if (!data.title) {
      details.title = 'Content title is required.';
    } else if (data.title.length > 200) {
      details.title = 'Content title must be 200 characters or less.';
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

  if (data.status !== undefined) {
    if (!['idea', 'draft', 'in_review', 'approved', 'scheduled', 'published'].includes(data.status)) {
      details.status = 'Status must be idea, draft, in_review, approved, scheduled, or published.';
    }
  }

  if (data.scheduled_date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(data.scheduled_date) || isNaN(Date.parse(data.scheduled_date))) {
      details.scheduled_date = 'Scheduled date must be a valid date in YYYY-MM-DD format.';
    }
  }

  if (data.assignee_id) {
    const user = db.prepare('SELECT id, active FROM users WHERE id = ?').get(data.assignee_id);
    if (!user) {
      details.assignee_id = 'Referenced assignee does not exist.';
    } else if (user.active !== 1) {
      details.assignee_id = 'Referenced assignee is a deactivated user.';
    }
  }

  if (Object.keys(details).length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Validation failed.', 400, details);
  }
}

export function createContentItem(contentData) {
  validateContentInput(contentData);

  const {
    client_id,
    title,
    platform = null,
    content_type = null,
    scheduled_date = null,
    status = 'idea',
    assignee_id = null,
    notes = null
  } = contentData;

  try {
    const result = db.prepare(`
      INSERT INTO content_calendar (client_id, title, platform, content_type, scheduled_date, status, assignee_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(client_id, title, platform, content_type, scheduled_date, status, assignee_id, notes);

    return getContentItemById(result.lastInsertRowid);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to create content item.', 500);
  }
}

export function getContentItemById(id, user = null) {
  const item = db.prepare(`
    SELECT cc.*, c.name as client_name, u.name as assignee_name
    FROM content_calendar cc
    JOIN clients c ON cc.client_id = c.id
    LEFT JOIN users u ON cc.assignee_id = u.id
    WHERE cc.id = ?
  `).get(id);

  if (!item) {
    throw new AppError('NOT_FOUND', 'Content item not found.', 404);
  }

  // Scoping: member can only read their assigned content items
  if (user && user.role === 'member' && item.assignee_id !== user.id) {
    throw new AppError('FORBIDDEN', 'Access denied to this content item.', 403);
  }

  return item;
}

export function listContentItems({ client_id, status, from, to, page = 1, pageSize = 25 }, user) {
  const offset = (page - 1) * pageSize;
  const conditions = [];
  const params = [];

  // Scoping: member can only list items assigned to them
  if (user.role === 'member') {
    conditions.push('cc.assignee_id = ?');
    params.push(user.id);
  }

  if (client_id) {
    conditions.push('cc.client_id = ?');
    params.push(client_id);
  }

  if (status) {
    conditions.push('cc.status = ?');
    params.push(status);
  }

  if (from) {
    conditions.push('cc.scheduled_date >= ?');
    params.push(from);
  }

  if (to) {
    conditions.push('cc.scheduled_date <= ?');
    params.push(to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM content_calendar cc ${whereClause}`).get(...params);
  const total = countRow.total;

  const dataParams = [...params, pageSize, offset];
  const data = db.prepare(`
    SELECT cc.*, c.name as client_name, u.name as assignee_name
    FROM content_calendar cc
    JOIN clients c ON cc.client_id = c.id
    LEFT JOIN users u ON cc.assignee_id = u.id
    ${whereClause}
    ORDER BY cc.scheduled_date ASC, cc.id DESC
    LIMIT ? OFFSET ?
  `).all(...dataParams);

  return {
    data,
    page,
    pageSize,
    total
  };
}

export function updateContentItem(id, updates, user) {
  const item = getContentItemById(id, user);

  if (user.role === 'member') {
    // Member can only update status
    const keys = Object.keys(updates);
    if (keys.length !== 1 || keys[0] !== 'status') {
      throw new AppError('FORBIDDEN', 'Members can only update the status of content items.', 403);
    }
  }

  validateContentInput(updates, true);

  const fields = [];
  const params = [];
  const allowedFields = ['client_id', 'title', 'platform', 'content_type', 'scheduled_date', 'status', 'assignee_id', 'notes'];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      params.push(updates[field] === '' ? null : updates[field]);
    }
  }

  if (fields.length === 0) {
    return getContentItemById(id, user);
  }

  params.push(id);
  const query = `UPDATE content_calendar SET ${fields.join(', ')} WHERE id = ?`;

  try {
    db.prepare(query).run(...params);
    return getContentItemById(id, user);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to update content item.', 500);
  }
}
