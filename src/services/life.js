import db from '../db.js';
import { AppError } from './users.js';

// Helper to get relative dates in YYYY-MM-DD
function getRelativeDateStr(offsetDays = 0) {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() + offsetDays);
  }
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// Get Monday of the ISO week for a date
function getMondayStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

/**
 * --- Habits Services ---
 */
export function createHabit(ownerId, { name, cadence = 'daily', target_per_period = 1 }) {
  if (!name) throw new AppError('VALIDATION_ERROR', 'Habit name is required.', 400);
  if (!['daily', 'weekly'].includes(cadence)) throw new AppError('VALIDATION_ERROR', 'Invalid cadence.', 400);

  try {
    const result = db.prepare(`
      INSERT INTO life_habits (owner_id, name, cadence, target_per_period, active)
      VALUES (?, ?, ?, ?, 1)
    `).run(ownerId, name, cadence, target_per_period);

    return getHabitById(result.lastInsertRowid, ownerId);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to create habit.', 500);
  }
}

export function getHabitById(id, ownerId) {
  const habit = db.prepare('SELECT * FROM life_habits WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!habit) throw new AppError('NOT_FOUND', 'Habit not found.', 404);
  habit.active = !!habit.active;
  return habit;
}

export function listHabits(ownerId) {
  const habits = db.prepare('SELECT * FROM life_habits WHERE owner_id = ? AND active = 1').all(ownerId);
  return habits.map(h => {
    h.active = !!h.active;
    h.streak = calculateHabitStreak(h.id, ownerId, h.cadence);
    h.completed_today = isHabitCompletedToday(h.id, ownerId, h.cadence);
    return h;
  });
}

export function updateHabit(id, ownerId, updates) {
  const existing = getHabitById(id, ownerId);
  
  const fields = [];
  const params = [];
  const allowed = ['name', 'cadence', 'target_per_period', 'active'];

  for (const field of allowed) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      let val = updates[field];
      if (field === 'active') val = val ? 1 : 0;
      params.push(val);
    }
  }

  if (fields.length === 0) return existing;

  params.push(id, ownerId);
  db.prepare(`UPDATE life_habits SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`).run(...params);
  return getHabitById(id, ownerId);
}

export function logHabit(habitId, ownerId, { log_date, done }) {
  // Validate habit existence
  getHabitById(habitId, ownerId);

  if (!log_date) throw new AppError('VALIDATION_ERROR', 'log_date is required.', 400);
  const doneVal = done === true || done === 1 ? 1 : 0;

  try {
    db.prepare(`
      INSERT INTO life_habit_logs (habit_id, owner_id, log_date, done)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(habit_id, log_date) DO UPDATE SET done = excluded.done
    `).run(habitId, ownerId, log_date, doneVal);

    return { success: true, log_date, done: !!doneVal };
  } catch (err) {
    console.error(err);
    throw new AppError('INTERNAL', 'Failed to log habit.', 500);
  }
}

function calculateHabitStreak(habitId, ownerId, cadence) {
  const today = getRelativeDateStr(0);

  if (cadence === 'daily') {
    let streak = 0;
    let offset = 0;
    let checkedToday = false;

    while (true) {
      const dateToCheck = getRelativeDateStr(-offset);
      const log = db.prepare('SELECT done FROM life_habit_logs WHERE habit_id = ? AND owner_id = ? AND log_date = ?').get(habitId, ownerId, dateToCheck);

      if (log && log.done === 1) {
        streak++;
        offset++;
        if (offset === 1) checkedToday = true;
      } else {
        // If today is not logged, but yesterday was logged done, we count starting from yesterday
        if (offset === 0) {
          offset = 1; // skip today and check yesterday
          continue;
        }
        break; // break at first gap
      }
    }
    return streak;
  } else {
    // cadence === 'weekly'
    // log_date is stored as Monday date of that week
    let streak = 0;
    let currentMonday = getMondayStr(today);
    let offsetWeeks = 0;
    
    while (true) {
      const targetDate = new Date(currentMonday + 'T00:00:00');
      targetDate.setDate(targetDate.getDate() - (offsetWeeks * 7));
      const targetMondayStr = targetDate.toISOString().split('T')[0];

      const log = db.prepare('SELECT done FROM life_habit_logs WHERE habit_id = ? AND owner_id = ? AND log_date = ?').get(habitId, ownerId, targetMondayStr);

      if (log && log.done === 1) {
        streak++;
        offsetWeeks++;
      } else {
        if (offsetWeeks === 0) {
          offsetWeeks = 1; // skip current week and check previous week
          continue;
        }
        break;
      }
    }
    return streak;
  }
}

function isHabitCompletedToday(habitId, ownerId, cadence) {
  const today = getRelativeDateStr(0);
  const logDate = cadence === 'weekly' ? getMondayStr(today) : today;
  const log = db.prepare('SELECT done FROM life_habit_logs WHERE habit_id = ? AND owner_id = ? AND log_date = ?').get(habitId, ownerId, logDate);
  return log ? !!log.done : false;
}

/**
 * --- Health Services ---
 */
export function createHealthLog(ownerId, { type, value, note = null }) {
  if (!['workout', 'break', 'sleep', 'weight', 'water'].includes(type)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid health type.', 400);
  }
  if (!value) throw new AppError('VALIDATION_ERROR', 'Value is required.', 400);

  try {
    const result = db.prepare(`
      INSERT INTO life_health_logs (owner_id, type, value, note, logged_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(ownerId, type, value, note);

    return db.prepare('SELECT * FROM life_health_logs WHERE id = ?').get(result.lastInsertRowid);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to create health log.', 500);
  }
}

export function listHealthLogs(ownerId, { type, from, to }) {
  const conditions = ['owner_id = ?'];
  const params = [ownerId];

  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (from) {
    conditions.push("logged_at >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("logged_at <= ?");
    params.push(to);
  }

  const query = `
    SELECT * FROM life_health_logs 
    WHERE ${conditions.join(' AND ')} 
    ORDER BY logged_at DESC
  `;
  return db.prepare(query).all(...params);
}

/**
 * --- Finance Services ---
 */
export function createFinanceEntry(ownerId, { kind, category, amount, currency = 'INR', note = null, entry_date }) {
  if (!['income', 'expense'].includes(kind)) throw new AppError('VALIDATION_ERROR', 'Invalid kind.', 400);
  if (!amount || amount < 0) throw new AppError('VALIDATION_ERROR', 'Amount must be greater than or equal to 0.', 400);
  if (!entry_date) throw new AppError('VALIDATION_ERROR', 'Entry date is required.', 400);

  try {
    const result = db.prepare(`
      INSERT INTO life_finance_entries (owner_id, kind, category, amount, currency, note, entry_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ownerId, kind, category || null, amount, currency, note, entry_date);

    return db.prepare('SELECT * FROM life_finance_entries WHERE id = ?').get(result.lastInsertRowid);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to create finance entry.', 500);
  }
}

export function listFinanceEntries(ownerId, { kind, from, to }) {
  const conditions = ['owner_id = ?'];
  const params = [ownerId];

  if (kind) {
    conditions.push('kind = ?');
    params.push(kind);
  }
  if (from) {
    conditions.push('entry_date >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('entry_date <= ?');
    params.push(to);
  }

  const query = `
    SELECT * FROM life_finance_entries 
    WHERE ${conditions.join(' AND ')} 
    ORDER BY entry_date DESC, id DESC
  `;
  return db.prepare(query).all(...params);
}

export function getFinanceSummary(ownerId, { month }) {
  if (!month) throw new AppError('VALIDATION_ERROR', 'Month (YYYY-MM) is required.', 400);

  const start = `${month}-01`;
  const end = `${month}-31`; // sqlite text comparison works fine with YYYY-MM-DD

  // Total Income
  const incomeRow = db.prepare(`
    SELECT SUM(amount) as total FROM life_finance_entries 
    WHERE owner_id = ? AND kind = 'income' AND entry_date >= ? AND entry_date <= ?
  `).get(ownerId, start, end);

  // Total Expenses
  const expenseRow = db.prepare(`
    SELECT SUM(amount) as total FROM life_finance_entries 
    WHERE owner_id = ? AND kind = 'expense' AND entry_date >= ? AND entry_date <= ?
  `).get(ownerId, start, end);

  // Expense breakdown by category
  const categories = db.prepare(`
    SELECT category, SUM(amount) as total 
    FROM life_finance_entries 
    WHERE owner_id = ? AND kind = 'expense' AND entry_date >= ? AND entry_date <= ?
    GROUP BY category
    ORDER BY total DESC
  `).all(ownerId, start, end);

  return {
    month,
    income: incomeRow.total || 0,
    expense: expenseRow.total || 0,
    net: (incomeRow.total || 0) - (expenseRow.total || 0),
    categories
  };
}

/**
 * --- Learning Services ---
 */
export function createLearningItem(ownerId, { title, source = null, status = 'to_learn', hours = 0, notes = null }) {
  if (!title) throw new AppError('VALIDATION_ERROR', 'Learning item title is required.', 400);

  try {
    const result = db.prepare(`
      INSERT INTO life_learning (owner_id, title, source, status, hours, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ownerId, title, source, status, hours, notes);

    return getLearningItemById(result.lastInsertRowid, ownerId);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to create learning item.', 500);
  }
}

export function getLearningItemById(id, ownerId) {
  const item = db.prepare('SELECT * FROM life_learning WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!item) throw new AppError('NOT_FOUND', 'Learning item not found.', 404);
  return item;
}

export function listLearningItems(ownerId) {
  return db.prepare('SELECT * FROM life_learning WHERE owner_id = ? ORDER BY status ASC, created_at DESC').all(ownerId);
}

export function updateLearningItem(id, ownerId, updates) {
  getLearningItemById(id, ownerId);

  const fields = [];
  const params = [];
  const allowed = ['title', 'source', 'status', 'hours', 'notes'];

  for (const field of allowed) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      params.push(updates[field] === '' ? null : updates[field]);
    }
  }

  if (fields.length === 0) return getLearningItemById(id, ownerId);

  fields.push("updated_at = datetime('now')");
  params.push(id, ownerId);

  db.prepare(`UPDATE life_learning SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`).run(...params);
  return getLearningItemById(id, ownerId);
}

/**
 * --- Journaling Services ---
 */
export function createJournalEntry(ownerId, { entry_date, mood = null, body = null }) {
  if (!entry_date) throw new AppError('VALIDATION_ERROR', 'Journal entry date is required.', 400);

  try {
    const result = db.prepare(`
      INSERT INTO life_journal (owner_id, entry_date, mood, body)
      VALUES (?, ?, ?, ?)
    `).run(ownerId, entry_date, mood, body);

    return db.prepare('SELECT * FROM life_journal WHERE id = ?').get(result.lastInsertRowid);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to save journal entry.', 500);
  }
}

export function listJournalEntries(ownerId, { from, to }) {
  const conditions = ['owner_id = ?'];
  const params = [ownerId];

  if (from) {
    conditions.push('entry_date >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('entry_date <= ?');
    params.push(to);
  }

  const query = `
    SELECT * FROM life_journal 
    WHERE ${conditions.join(' AND ')} 
    ORDER BY entry_date DESC
  `;
  return db.prepare(query).all(...params);
}

/**
 * --- Content Ideas Services ---
 */
export function createContentIdea(ownerId, { idea, hook = null, platform = null, status = 'idea', scheduled_date = null }) {
  if (!idea) throw new AppError('VALIDATION_ERROR', 'Content idea title is required.', 400);

  try {
    const result = db.prepare(`
      INSERT INTO life_content_ideas (owner_id, idea, hook, platform, status, scheduled_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ownerId, idea, hook, platform, status, scheduled_date);

    return getContentIdeaById(result.lastInsertRowid, ownerId);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to save content idea.', 500);
  }
}

export function getContentIdeaById(id, ownerId) {
  const row = db.prepare('SELECT * FROM life_content_ideas WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!row) throw new AppError('NOT_FOUND', 'Content idea not found.', 404);
  return row;
}

export function listContentIdeas(ownerId) {
  return db.prepare('SELECT * FROM life_content_ideas WHERE owner_id = ? ORDER BY created_at DESC').all(ownerId);
}

export function updateContentIdea(id, ownerId, updates) {
  getContentIdeaById(id, ownerId);

  const fields = [];
  const params = [];
  const allowed = ['idea', 'hook', 'platform', 'status', 'scheduled_date'];

  for (const field of allowed) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      params.push(updates[field] === '' ? null : updates[field]);
    }
  }

  if (fields.length === 0) return getContentIdeaById(id, ownerId);

  params.push(id, ownerId);
  db.prepare(`UPDATE life_content_ideas SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`).run(...params);
  return getContentIdeaById(id, ownerId);
}

/**
 * --- Calendar Events Services ---
 */
export function createCalendarEvent(ownerId, { title, start_at, end_at = null, all_day = 0, type = null, note = null }) {
  if (!title) throw new AppError('VALIDATION_ERROR', 'Event title is required.', 400);
  if (!start_at) throw new AppError('VALIDATION_ERROR', 'Event start time is required.', 400);

  const allDayVal = all_day === true || all_day === 1 ? 1 : 0;

  try {
    const result = db.prepare(`
      INSERT INTO life_calendar_events (owner_id, title, start_at, end_at, all_day, type, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ownerId, title, start_at, end_at, allDayVal, type, note);

    return getCalendarEventById(result.lastInsertRowid, ownerId);
  } catch (err) {
    throw new AppError('INTERNAL', 'Failed to create calendar event.', 500);
  }
}

export function getCalendarEventById(id, ownerId) {
  const row = db.prepare('SELECT * FROM life_calendar_events WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!row) throw new AppError('NOT_FOUND', 'Event not found.', 404);
  row.all_day = !!row.all_day;
  return row;
}

export function listCalendarEvents(ownerId, { from, to }) {
  const conditions = ['owner_id = ?'];
  const params = [ownerId];

  if (from) {
    conditions.push('start_at >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('start_at <= ?');
    params.push(to);
  }

  const query = `
    SELECT * FROM life_calendar_events 
    WHERE ${conditions.join(' AND ')} 
    ORDER BY start_at ASC
  `;
  const rows = db.prepare(query).all(...params);
  return rows.map(r => ({ ...r, all_day: !!r.all_day }));
}

export function updateCalendarEvent(id, ownerId, updates) {
  getCalendarEventById(id, ownerId);

  const fields = [];
  const params = [];
  const allowed = ['title', 'start_at', 'end_at', 'all_day', 'type', 'note'];

  for (const field of allowed) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      let val = updates[field];
      if (field === 'all_day') val = val ? 1 : 0;
      params.push(val === '' ? null : val);
    }
  }

  if (fields.length === 0) return getCalendarEventById(id, ownerId);

  params.push(id, ownerId);
  db.prepare(`UPDATE life_calendar_events SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`).run(...params);
  return getCalendarEventById(id, ownerId);
}

export function deleteCalendarEvent(id, ownerId) {
  getCalendarEventById(id, ownerId);
  db.prepare('DELETE FROM life_calendar_events WHERE id = ? AND owner_id = ?').run(id, ownerId);
  return { success: true };
}
