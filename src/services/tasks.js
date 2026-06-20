import db from '../db.js';
import { AppError } from './users.js';

function validateTaskInput(data, isUpdate = false) {
  const details = {};

  if (!isUpdate || data.title !== undefined) {
    if (!data.title) {
      details.title = 'Task title is required.';
    } else if (data.title.length > 200) {
      details.title = 'Task title must be 200 characters or less.';
    }
  }

  if (data.priority !== undefined) {
    if (!['low', 'medium', 'high', 'urgent'].includes(data.priority)) {
      details.priority = 'Priority must be low, medium, high, or urgent.';
    }
  }

  if (data.status !== undefined) {
    if (!['todo', 'in_progress', 'in_review', 'done'].includes(data.status)) {
      details.status = 'Status must be todo, in_progress, in_review, or done.';
    }
  }

  if (data.due_date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(data.due_date) || isNaN(Date.parse(data.due_date))) {
      details.due_date = 'Due date must be a valid date in YYYY-MM-DD format.';
    }
  }

  if (data.needs_approval !== undefined) {
    if (data.needs_approval !== 0 && data.needs_approval !== 1 && typeof data.needs_approval !== 'boolean') {
      details.needs_approval = 'needs_approval must be a boolean or 0/1.';
    }
  }

  if (data.recurrence !== undefined && data.recurrence !== null && data.recurrence !== '') {
    if (!['daily', 'weekly', 'monthly'].includes(data.recurrence)) {
      details.recurrence = 'Recurrence must be daily, weekly, or monthly.';
    }
    if (data.recurrence_interval !== undefined && data.recurrence_interval !== null) {
      if (typeof data.recurrence_interval !== 'number' || data.recurrence_interval < 1) {
        details.recurrence_interval = 'Recurrence interval must be an integer greater than or equal to 1.';
      }
    }
    if (data.recurrence_until) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(data.recurrence_until) || isNaN(Date.parse(data.recurrence_until))) {
        details.recurrence_until = 'recurrence_until must be a valid date in YYYY-MM-DD format.';
      }
    }
  }

  // Validate FK constraints if IDs provided
  if (data.client_id) {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(data.client_id);
    if (!client) {
      details.client_id = 'Referenced client does not exist.';
    }
  }

  if (data.project_id) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(data.project_id);
    if (!project) {
      details.project_id = 'Referenced project does not exist.';
    }
  }

  if (data.assignee_id) {
    const assignee = db.prepare('SELECT id, active FROM users WHERE id = ?').get(data.assignee_id);
    if (!assignee) {
      details.assignee_id = 'Referenced assignee does not exist.';
    } else if (assignee.active !== 1) {
      details.assignee_id = 'Referenced assignee is a deactivated user.';
    }
  }

  if (Object.keys(details).length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Validation failed.', 400, details);
  }
}

export function createTask(taskData, creatorId) {
  validateTaskInput(taskData);

  const {
    title,
    description = null,
    client_id = null,
    project_id = null,
    assignee_id = null,
    priority = 'medium',
    status = 'todo',
    due_date = null,
    needs_approval = 0,
    recurrence = null,
    recurrence_interval = 1,
    recurrence_until = null
  } = taskData;

  const approvalVal = needs_approval === true || needs_approval === 1 ? 1 : 0;

  try {
    const result = db.prepare(`
      INSERT INTO tasks (
        title, description, client_id, project_id, assignee_id, created_by,
        priority, status, due_date, needs_approval, recurrence, recurrence_interval, recurrence_until, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      title,
      description,
      client_id || null,
      project_id || null,
      assignee_id || null,
      creatorId,
      priority,
      status,
      due_date || null,
      approvalVal,
      recurrence || null,
      recurrence_interval || 1,
      recurrence_until || null
    );

    const newTaskId = result.lastInsertRowid;
    if (assignee_id) {
      triggerAssignmentNotification(newTaskId);
    }
    return getTaskById(newTaskId);
  } catch (err) {
    console.error(err);
    throw new AppError('INTERNAL', 'Failed to create task.', 500);
  }
}

export function getTaskById(id, user = null) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) {
    throw new AppError('NOT_FOUND', 'Task not found.', 404);
  }

  // Row-level permission check: member can only read their own tasks
  if (user && user.role === 'member' && task.assignee_id !== user.id) {
    throw new AppError('FORBIDDEN', 'Access denied to this task.', 403);
  }

  task.needs_approval = !!task.needs_approval;
  return task;
}

export function listTasks({ status, priority, client_id, project_id, assignee_id, due_before, due_after, page = 1, pageSize = 25 }, user) {
  const offset = (page - 1) * pageSize;
  const conditions = [];
  const params = [];

  // Scoping: Member can only view tasks assigned to them
  if (user.role === 'member') {
    conditions.push('t.assignee_id = ?');
    params.push(user.id);
  } else if (assignee_id) {
    conditions.push('t.assignee_id = ?');
    params.push(assignee_id);
  }

  if (status) {
    conditions.push('t.status = ?');
    params.push(status);
  }

  if (priority) {
    conditions.push('t.priority = ?');
    params.push(priority);
  }

  if (client_id) {
    conditions.push('t.client_id = ?');
    params.push(client_id);
  }

  if (project_id) {
    conditions.push('t.project_id = ?');
    params.push(project_id);
  }

  if (due_before) {
    conditions.push('t.due_date <= ?');
    params.push(due_before);
  }

  if (due_after) {
    conditions.push('t.due_date >= ?');
    params.push(due_after);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM tasks t ${whereClause}`).get(...params);
  const total = countRow.total;

  // Get paginated data
  const dataParams = [...params, pageSize, offset];
  const data = db.prepare(`
    SELECT t.*, c.name as client_name, u.name as assignee_name
    FROM tasks t
    LEFT JOIN clients c ON t.client_id = c.id
    LEFT JOIN users u ON t.assignee_id = u.id
    ${whereClause}
    ORDER BY
      CASE t.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END ASC,
      t.due_date ASC
    LIMIT ? OFFSET ?
  `).all(...dataParams);

  return {
    data: data.map(t => ({ ...t, needs_approval: !!t.needs_approval })),
    page,
    pageSize,
    total
  };
}

export function updateTask(id, updates, user) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) {
    throw new AppError('NOT_FOUND', 'Task not found.', 404);
  }

  // Row-level permissions
  if (user.role === 'member') {
    // Members can ONLY update tasks assigned to them
    if (task.assignee_id !== user.id) {
      throw new AppError('FORBIDDEN', 'Access denied. You can only update tasks assigned to you.', 403);
    }
    // Members can ONLY update status
    const updateKeys = Object.keys(updates);
    if (updateKeys.length !== 1 || updateKeys[0] !== 'status') {
      throw new AppError('FORBIDDEN', 'Members can only update the status of their tasks.', 403);
    }
  }

  validateTaskInput(updates, true);

  // Validate state transitions
  if (updates.status && updates.status !== task.status) {
    validateStateTransition(task, updates.status, user);
  }

  const fields = [];
  const params = [];
  const now = new Date().toISOString();

  // If status is transitioning to 'done' (and it did not require approval, or was approved)
  if (updates.status === 'done' && task.status !== 'done') {
    fields.push('completed_at = ?');
    params.push(now);
  } else if (updates.status && updates.status !== 'done' && task.status === 'done') {
    // If resetting from done, clear completed_at
    fields.push('completed_at = ?');
    params.push(null);
  }

  const allowedFields = [
    'title', 'description', 'client_id', 'project_id', 'assignee_id',
    'priority', 'status', 'due_date', 'needs_approval', 'recurrence',
    'recurrence_interval', 'recurrence_until'
  ];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      let val = updates[field];
      if (field === 'needs_approval') {
        val = val === true || val === 1 ? 1 : 0;
      }
      params.push(val === '' ? null : val);
    }
  }

  if (fields.length === 0) {
    return getTaskById(id, user);
  }

  // Always update updated_at
  fields.push("updated_at = datetime('now')");

  params.push(id);
  const query = `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`;

  try {
    db.prepare(query).run(...params);
    
    // Check if assignee has changed
    if (updates.assignee_id && updates.assignee_id !== task.assignee_id) {
      triggerAssignmentNotification(id);
    }

    // Check if task completed (and triggers recurrence)
    const updatedTask = getTaskById(id, user);
    if (updates.status === 'done' && task.status !== 'done') {
      handleRecurrence(updatedTask);
    }

    return updatedTask;
  } catch (err) {
    console.error(err);
    throw new AppError('INTERNAL', 'Failed to update task.', 500);
  }
}

export function approveTask(id, user) {
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new AppError('FORBIDDEN', 'Only admins and managers can approve tasks.', 403);
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) {
    throw new AppError('NOT_FOUND', 'Task not found.', 404);
  }

  if (task.status !== 'in_review') {
    throw new AppError('CONFLICT', 'Only tasks in in_review status can be approved.', 409);
  }

  const now = new Date().toISOString();

  try {
    db.prepare(`
      UPDATE tasks
      SET status = 'done',
          approved_by = ?,
          approved_at = ?,
          completed_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(user.id, now, now, id);

    const approvedTask = getTaskById(id);
    handleRecurrence(approvedTask);

    return approvedTask;
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to approve task.', 500);
  }
}

export function deleteTask(id, user) {
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new AppError('FORBIDDEN', 'Only admins and managers can delete tasks.', 403);
  }

  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!task) {
    throw new AppError('NOT_FOUND', 'Task not found.', 404);
  }

  try {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return { success: true };
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to delete task.', 500);
  }
}

/**
 * Validates whether a state machine transition is allowed
 */
function validateStateTransition(task, nextStatus, user) {
  const current = task.status;

  // Rule: Resetting to todo is only allowed by manager or admin
  if (nextStatus === 'todo') {
    if (user.role !== 'admin' && user.role !== 'manager') {
      throw new AppError('CONFLICT', 'Only admins and managers can reset a task to TODO.', 409);
    }
    return;
  }

  if (current === 'todo') {
    if (nextStatus !== 'in_progress') {
      throw new AppError('CONFLICT', `Cannot transition directly from todo to ${nextStatus}.`, 409);
    }
  } else if (current === 'in_progress') {
    if (nextStatus === 'done') {
      // Cannot transition to done directly if needs_approval is true
      if (task.needs_approval === 1) {
        throw new AppError('CONFLICT', 'This task requires approval. Transition to in_review first.', 409);
      }
    } else if (nextStatus !== 'in_review') {
      throw new AppError('CONFLICT', `Cannot transition directly from in_progress to ${nextStatus}.`, 409);
    }
  } else if (current === 'in_review') {
    if (nextStatus === 'done') {
      // Must use /approve endpoint or be manager/admin to transition in_review -> done
      if (user.role !== 'admin' && user.role !== 'manager') {
        throw new AppError('CONFLICT', 'Approval required. Only admins and managers can transition a task to done from in_review.', 409);
      }
    } else if (nextStatus !== 'in_progress') {
      // Reject back to in_progress (rework)
      throw new AppError('CONFLICT', `Invalid transition from in_review to ${nextStatus}.`, 409);
    } else {
      // Transition back to in_progress requires manager/admin
      if (user.role !== 'admin' && user.role !== 'manager') {
        throw new AppError('CONFLICT', 'Only admins and managers can reject a task back to in_progress.', 409);
      }
    }
  } else if (current === 'done') {
    // Transitioning OUT of done is only allowed by manager or admin (using reset to todo)
    throw new AppError('CONFLICT', 'Completed tasks cannot be edited. Reset to todo first (admin/manager only).', 409);
  }
}

export function addInterval(baseDate, recurrence, interval = 1) {
  if (!baseDate) {
    baseDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }
  const dateObj = new Date(baseDate + 'T00:00:00Z');
  
  if (recurrence === 'daily') {
    dateObj.setUTCDate(dateObj.getUTCDate() + interval);
  } else if (recurrence === 'weekly') {
    dateObj.setUTCDate(dateObj.getUTCDate() + interval * 7);
  } else if (recurrence === 'monthly') {
    const originalDay = dateObj.getUTCDate();
    dateObj.setUTCMonth(dateObj.getUTCMonth() + interval);
    if (dateObj.getUTCDate() !== originalDay) {
      dateObj.setUTCDate(0); // clamp to end of month
    }
  }
  return dateObj.toISOString().split('T')[0];
}

export function handleRecurrence(task) {
  if (!task.recurrence) return null;
  
  const base = task.due_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const nextDue = addInterval(base, task.recurrence, task.recurrence_interval || 1);
  
  if (task.recurrence_until && nextDue > task.recurrence_until) {
    return null; // past recurrence limit
  }
  
  const parentId = task.parent_task_id || task.id;
  
  // Create next recurrence task
  try {
    const result = db.prepare(`
      INSERT INTO tasks (
        title, description, client_id, project_id, assignee_id, created_by,
        priority, status, due_date, needs_approval, recurrence, recurrence_interval, recurrence_until, parent_task_id, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      task.title,
      task.description,
      task.client_id,
      task.project_id,
      task.assignee_id,
      task.created_by,
      task.priority,
      nextDue,
      task.needs_approval ? 1 : 0,
      task.recurrence,
      task.recurrence_interval || 1,
      task.recurrence_until,
      parentId
    );
    
    return result.lastInsertRowid;
  } catch (err) {
    console.error('Failed to create recurring task:', err);
    return null;
  }
}

async function triggerAssignmentNotification(taskId) {
  try {
    const task = db.prepare(`
      SELECT t.title, t.priority, t.due_date, c.name as client_name, u.name as creator_name, a.telegram_chat_id
      FROM tasks t
      LEFT JOIN clients c ON t.client_id = c.id
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN users a ON t.assignee_id = a.id
      WHERE t.id = ?
    `).get(taskId);

    if (task && task.telegram_chat_id) {
      const { sendTelegramMessage, formatAssignmentMessage } = await import('../telegram.js');
      const text = formatAssignmentMessage(task.title, task.client_name, task.priority, task.due_date, task.creator_name);
      await sendTelegramMessage(task.telegram_chat_id, text);
    }
  } catch (err) {
    console.error('[Notification Trigger Error]', err);
  }
}
