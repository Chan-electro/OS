import db from '../db.js';
import { AppError } from './users.js';

function validateClientInput(data, isUpdate = false) {
  const details = {};

  if (!isUpdate || data.name !== undefined) {
    if (!data.name) {
      details.name = 'Client name is required.';
    } else if (data.name.length > 200) {
      details.name = 'Client name must be 200 characters or less.';
    }
  }

  if (data.contact_email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.contact_email)) {
      details.contact_email = 'Invalid email address format.';
    }
  }

  if (data.contact_phone) {
    if (data.contact_phone.length < 7 || data.contact_phone.length > 20) {
      details.contact_phone = 'Phone number must be between 7 and 20 characters.';
    }
  }

  if (data.status !== undefined) {
    if (!['lead', 'active', 'paused', 'churned'].includes(data.status)) {
      details.status = 'Status must be lead, active, paused, or churned.';
    }
  }

  if (data.retainer_amount !== undefined && data.retainer_amount !== null) {
    if (typeof data.retainer_amount !== 'number' || data.retainer_amount < 0) {
      details.retainer_amount = 'Retainer amount must be a number greater than or equal to 0.';
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

export function createClient(clientData, creatorId) {
  validateClientInput(clientData);

  const { name, industry, contact_name, contact_email, contact_phone, status = 'active', retainer_amount = null, renewal_date = null, notes = null } = clientData;

  try {
    const result = db.prepare(`
      INSERT INTO clients (name, industry, contact_name, contact_email, contact_phone, status, retainer_amount, renewal_date, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, industry || null, contact_name || null, contact_email || null, contact_phone || null, status, retainer_amount, renewal_date, notes, creatorId);

    return getClientById(result.lastInsertRowid);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to create client.', 500);
  }
}

export function getClientById(id, user = null) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!client) {
    throw new AppError('NOT_FOUND', 'Client not found.', 404);
  }

  if (user && user.role === 'member') {
    const hasTask = db.prepare('SELECT id FROM tasks WHERE client_id = ? AND assignee_id = ? LIMIT 1').get(id, user.id);
    if (!hasTask) {
      throw new AppError('FORBIDDEN', 'Access denied to this client.', 403);
    }
  }

  return client;
}

/**
 * Lists clients based on query filters, pagination, and user scope
 */
export function listClients({ status, search, page = 1, pageSize = 25 }, user = null) {
  const offset = (page - 1) * pageSize;
  const conditions = [];
  const params = [];

  if (user && user.role === 'member') {
    conditions.push('id IN (SELECT DISTINCT client_id FROM tasks WHERE assignee_id = ? AND client_id IS NOT NULL)');
    params.push(user.id);
  }

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (search) {
    conditions.push('(name LIKE ? OR contact_name LIKE ? OR contact_email LIKE ?)');
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM clients ${whereClause}`).get(...params);
  const total = countRow.total;

  // Get paginated data
  const dataParams = [...params, pageSize, offset];
  const data = db.prepare(`
    SELECT * FROM clients
    ${whereClause}
    ORDER BY name ASC
    LIMIT ? OFFSET ?
  `).all(...dataParams);

  return {
    data,
    page,
    pageSize,
    total
  };
}

export function updateClient(id, updates) {
  const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(id);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Client not found.', 404);
  }

  validateClientInput(updates, true);

  const fields = [];
  const params = [];

  const allowedFields = ['name', 'industry', 'contact_name', 'contact_email', 'contact_phone', 'status', 'retainer_amount', 'renewal_date', 'notes'];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      params.push(updates[field] === '' ? null : updates[field]);
    }
  }

  if (fields.length === 0) {
    return getClientById(id);
  }

  params.push(id);
  const query = `UPDATE clients SET ${fields.join(', ')} WHERE id = ?`;

  try {
    db.prepare(query).run(...params);
    return getClientById(id);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to update client.', 500);
  }
}
