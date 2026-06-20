import db from '../db.js';
import bcrypt from 'bcryptjs';

// Custom error classes that can be mapped to API status codes in server error handler
export class AppError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Validates user creation/update inputs
 */
function validateUserInput(data, isUpdate = false) {
  const details = {};

  if (!isUpdate || data.username !== undefined) {
    if (!data.username) {
      details.username = 'Username is required.';
    } else if (data.username.length < 3 || data.username.length > 32) {
      details.username = 'Username must be between 3 and 32 characters.';
    } else if (!/^[a-z0-9._-]+$/.test(data.username)) {
      details.username = 'Username must contain only lowercase letters, numbers, dots, underscores, or hyphens.';
    }
  }

  if (!isUpdate || data.password !== undefined) {
    if (!isUpdate && !data.password) {
      details.password = 'Password is required.';
    } else if (data.password && data.password.length < 8) {
      details.password = 'Password must be at least 8 characters long.';
    }
  }

  if (!isUpdate || data.role !== undefined) {
    if (!data.role) {
      details.role = 'Role is required.';
    } else if (!['admin', 'manager', 'member'].includes(data.role)) {
      details.role = 'Role must be admin, manager, or member.';
    }
  }

  if (!isUpdate || data.name !== undefined) {
    if (!data.name) {
      details.name = 'Name is required.';
    } else if (data.name.length > 200) {
      details.name = 'Name must be 200 characters or less.';
    }
  }

  if (Object.keys(details).length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Validation failed.', 400, details);
  }
}

export function createUser({ name, username, password, role, telegram_chat_id }) {
  validateUserInput({ name, username, password, role });

  // Check username uniqueness
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    throw new AppError('CONFLICT', 'Username is already taken.', 409);
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  try {
    const result = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, telegram_chat_id, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(name, username, passwordHash, role, telegram_chat_id || null);

    return getUserById(result.lastInsertRowid);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to create user.', 500);
  }
}

export function getUserById(id) {
  const user = db.prepare('SELECT id, name, username, role, telegram_chat_id, active, created_at FROM users WHERE id = ?').get(id);
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found.', 404);
  }
  user.active = !!user.active; // convert to boolean
  return user;
}

export function listUsers(requestingUserRole) {
  if (requestingUserRole === 'admin') {
    const users = db.prepare('SELECT id, name, username, role, telegram_chat_id, active, created_at FROM users ORDER BY name ASC').all();
    return users.map(u => ({ ...u, active: !!u.active }));
  } else if (requestingUserRole === 'manager') {
    // Managers can list users for task assignment but cannot see telegram_chat_id or active status
    return db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name ASC').all();
  } else {
    // Members cannot list users
    throw new AppError('FORBIDDEN', 'Access denied to user lists.', 403);
  }
}

export function updateUser(id, updates) {
  const existing = db.prepare('SELECT id, password_hash, username FROM users WHERE id = ?').get(id);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'User not found.', 404);
  }

  // Validate updates
  validateUserInput(updates, true);

  if (updates.username && updates.username !== existing.username) {
    const duplicate = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(updates.username, id);
    if (duplicate) {
      throw new AppError('CONFLICT', 'Username is already taken.', 409);
    }
  }

  let passwordHash = existing.password_hash;
  if (updates.password) {
    const salt = bcrypt.genSaltSync(10);
    passwordHash = bcrypt.hashSync(updates.password, salt);
  }

  // Build dynamic update query
  const fields = [];
  const params = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    params.push(updates.name);
  }
  if (updates.username !== undefined) {
    fields.push('username = ?');
    params.push(updates.username);
  }
  if (updates.password !== undefined) {
    fields.push('password_hash = ?');
    params.push(passwordHash);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    params.push(updates.role);
  }
  if (updates.telegram_chat_id !== undefined) {
    fields.push('telegram_chat_id = ?');
    params.push(updates.telegram_chat_id || null);
  }
  if (updates.active !== undefined) {
    fields.push('active = ?');
    params.push(updates.active ? 1 : 0);
  }

  if (fields.length === 0) {
    return getUserById(id);
  }

  params.push(id);
  const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;

  try {
    db.prepare(query).run(...params);
    return getUserById(id);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to update user.', 500);
  }
}

export function changePassword(userId, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new AppError('VALIDATION_ERROR', 'New password must be at least 8 characters.', 400, {
      newPassword: 'New password must be at least 8 characters.'
    });
  }

  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId);
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found.', 404);
  }

  const matches = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!matches) {
    throw new AppError('VALIDATION_ERROR', 'Current password is incorrect.', 400, {
      currentPassword: 'Current password is incorrect.'
    });
  }

  const salt = bcrypt.genSaltSync(10);
  const newHash = bcrypt.hashSync(newPassword, salt);

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
  return { success: true };
}
