import cron from 'node-cron';
import db from './db.js';
import { sendTelegramMessage, formatDailyDigest, formatBreakMessage } from './telegram.js';
import { handleRecurrence } from './services/tasks.js';

// Helper to get date string in YYYY-MM-DD in Asia/Kolkata timezone
function getKolkataDate(offsetDays = 0) {
  const date = new Date();
  if (offsetDays !== 0) {
    date.setDate(date.getDate() + offsetDays);
  }
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Daily Task Digest Job (Runs at 9:00 AM Kolkata time)
 */
export const digestJob = cron.schedule('0 9 * * *', async () => {
  console.log('[Cron] Running daily task digest job...');
  const today = getKolkataDate(0);

  try {
    const activeUsers = db.prepare('SELECT id, name, telegram_chat_id FROM users WHERE active = 1 AND telegram_chat_id IS NOT NULL').all();

    for (const user of activeUsers) {
      // Gather overdue tasks
      const overdue = db.prepare(`
        SELECT t.*, c.name as client_name 
        FROM tasks t
        LEFT JOIN clients c ON t.client_id = c.id
        WHERE t.assignee_id = ? AND t.due_date < ? AND t.status != 'done'
      `).all(user.id, today);

      // Gather today's tasks
      const dueToday = db.prepare(`
        SELECT t.*, c.name as client_name 
        FROM tasks t
        LEFT JOIN clients c ON t.client_id = c.id
        WHERE t.assignee_id = ? AND t.due_date = ? AND t.status != 'done'
      `).all(user.id, today);

      if (overdue.length > 0 || dueToday.length > 0) {
        const text = formatDailyDigest(user.name, overdue, dueToday);
        await sendTelegramMessage(user.telegram_chat_id, text);
        console.log(`[Cron] Sent digest to ${user.name}`);
      }
    }
  } catch (err) {
    console.error('[Cron Error] Daily digest failed:', err);
  }
}, {
  timezone: "Asia/Kolkata"
});

/**
 * Safety Recurrence Generator (Runs at 1:00 AM Kolkata time)
 */
export const recurrenceSafetyJob = cron.schedule('0 1 * * *', async () => {
  console.log('[Cron] Running safety recurrence generator check...');
  
  try {
    // Find all completed tasks that have a recurrence set
    const completedRecurringTasks = db.prepare(`
      SELECT * FROM tasks 
      WHERE recurrence IS NOT NULL AND status = 'done'
    `).all();

    // Group by lineage (using parent_task_id or id) to find the latest completed task in each
    const lineages = {};
    for (const t of completedRecurringTasks) {
      const lineageId = t.parent_task_id || t.id;
      if (!lineages[lineageId] || t.id > lineages[lineageId].id) {
        lineages[lineageId] = t;
      }
    }

    for (const lineageId of Object.keys(lineages)) {
      const latestDone = lineages[lineageId];
      
      // Check if there is already an active task in this lineage
      const activeTask = db.prepare(`
        SELECT id FROM tasks 
        WHERE status != 'done' 
          AND (parent_task_id = ? OR id = ?)
      `).get(lineageId, lineageId);

      if (!activeTask) {
        console.log(`[Cron] Safety recurrence triggered for task ID ${latestDone.id} in lineage ${lineageId}`);
        handleRecurrence(latestDone);
      }
    }
  } catch (err) {
    console.error('[Cron Error] Safety recurrence check failed:', err);
  }
}, {
  timezone: "Asia/Kolkata"
});

/**
 * Break Stretch Reminder for Admin (Runs every 90 mins between 10 AM and 7 PM Kolkata time)
 */
export const breakReminderJob = cron.schedule('*/90 * * * *', async () => {
  const currentHour = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false, hour: 'numeric' });
  const hr = parseInt(currentHour, 10);
  
  // Work hours start/end config
  const startHour = parseInt(process.env.WORK_HOURS_START || '10', 10);
  const endHour = parseInt(process.env.WORK_HOURS_END || '19', 10);

  if (hr >= startHour && hr < endHour) {
    console.log('[Cron] Running stretch break nudge...');
    try {
      const admin = db.prepare("SELECT telegram_chat_id FROM users WHERE role = 'admin' AND active = 1").get();
      if (admin && admin.telegram_chat_id) {
        const text = formatBreakMessage();
        await sendTelegramMessage(admin.telegram_chat_id, text);
        console.log('[Cron] Stretch reminder sent to Admin.');
      }
    } catch (err) {
      console.error('[Cron Error] Break nudge failed:', err);
    }
  }
}, {
  timezone: "Asia/Kolkata"
});

/**
 * Start all crons
 */
export function initCrons() {
  console.log('[Cron] Initializing scheduled cron jobs...');
  digestJob.start();
  recurrenceSafetyJob.start();
  breakReminderJob.start();
}
