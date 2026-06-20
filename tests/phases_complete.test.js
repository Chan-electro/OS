import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import fs from 'fs';
import path from 'path';

// Set test environment variables BEFORE importing application code
process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/test-complete.db';
process.env.JWT_SECRET = 'test-secret-value-longer-than-32-chars-for-testing';
process.env.SEED_DEFAULT_PASSWORD = 'testpassword123';
process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token-for-testing';

// Mock global fetch to capture Telegram Bot API requests
const originalFetch = globalThis.fetch;
let telegramCalls = [];

globalThis.fetch = async (url, options) => {
  if (typeof url === 'string' && url.includes('api.telegram.org')) {
    telegramCalls.push({
      url,
      method: options.method,
      headers: options.headers,
      body: options.body ? JSON.parse(options.body) : null
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: {} })
    };
  }
  return originalFetch(url, options);
};

import bcrypt from 'bcryptjs';

// Application modules will be loaded dynamically to respect the environment variables set above
let db, initSchema, app, addInterval;
let server;
let baseUrl;

// Test variables to store cookie strings for roles
let adminCookie = '';
let managerCookie = '';
let memberCookie = '';

test.before(async () => {
  // Dynamically load the modules so that their top-level code (like database initialization)
  // runs with the correct DB_PATH and TELEGRAM_BOT_TOKEN set in process.env.
  const dbModule = await import('../src/db.js');
  db = dbModule.default;
  initSchema = dbModule.initSchema;

  const serverModule = await import('../src/server.js');
  app = serverModule.default;

  const taskModule = await import('../src/services/tasks.js');
  addInterval = taskModule.addInterval;

  // Initialize schema (in case db file is not yet created)
  initSchema();

  // Seed test users
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('testpassword123', salt);

  db.transaction(() => {
    // Delete child rows first to avoid foreign key violations
    db.prepare('DELETE FROM life_habit_logs').run();
    db.prepare('DELETE FROM life_habits').run();
    db.prepare('DELETE FROM life_health_logs').run();
    db.prepare('DELETE FROM life_finance_entries').run();
    db.prepare('DELETE FROM life_learning').run();
    db.prepare('DELETE FROM life_journal').run();
    db.prepare('DELETE FROM life_content_ideas').run();
    db.prepare('DELETE FROM life_calendar_events').run();
    db.prepare('DELETE FROM content_calendar').run();
    db.prepare('DELETE FROM tasks').run();
    db.prepare('DELETE FROM projects').run();
    db.prepare('DELETE FROM clients').run();
    db.prepare('DELETE FROM users').run();

    // Insert users
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, username, password_hash, role, telegram_chat_id, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    
    insertUser.run(1, 'Admin Chandan', 'chandan', passwordHash, 'admin', '123456789');
    insertUser.run(2, 'Manager Likitesh', 'likitesh', passwordHash, 'manager', '987654321');
    insertUser.run(3, 'Member Padmini', 'padmini', passwordHash, 'member', '555555555');

    // Insert clients
    const insertClient = db.prepare(`
      INSERT INTO clients (id, name, status, renewal_date, created_by)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Client 1: Acme F&B, renewal due in 10 days
    const d1 = new Date();
    d1.setDate(d1.getDate() + 10);
    const renewal1 = d1.toISOString().split('T')[0];
    insertClient.run(10, 'Acme F&B', 'active', renewal1, 1);

    // Client 2: Beta Ads, renewal due in 30 days
    const d2 = new Date();
    d2.setDate(d2.getDate() + 30);
    const renewal2 = d2.toISOString().split('T')[0];
    insertClient.run(20, 'Beta Ads', 'active', renewal2, 1);
  })();

  // Start server on a random port
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  // Log in as all roles to capture cookie tokens
  adminCookie = await getAuthCookie('chandan', 'testpassword123');
  managerCookie = await getAuthCookie('likitesh', 'testpassword123');
  memberCookie = await getAuthCookie('padmini', 'testpassword123');
});

test.after(async () => {
  // Close database and server connections
  db.close();
  if (server) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
  }
  
  // Cleanup test db files
  const dbFile = path.resolve(process.env.DB_PATH);
  if (fs.existsSync(dbFile)) {
    try { fs.unlinkSync(dbFile); } catch (e) {}
  }
  const dbWal = dbFile + '-wal';
  if (fs.existsSync(dbWal)) {
    try { fs.unlinkSync(dbWal); } catch (e) {}
  }
  const dbShm = dbFile + '-shm';
  if (fs.existsSync(dbShm)) {
    try { fs.unlinkSync(dbShm); } catch (e) {}
  }

  // Force process exit to release global fetch agent handles
  setTimeout(() => {
    process.exit(0);
  }, 100);
});

// Helper to login and get session cookie
async function getAuthCookie(username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error(`Auth failed for ${username}`);
  const cookie = res.headers.get('set-cookie');
  return cookie ? cookie.split(';')[0] : '';
}

// --- TEST CASES ---

/**
 * 1. Projects CRUD Endpoints
 */
test('Projects - Manager can create, read, list, and update projects; Member can list/read but not create', async () => {
  // Create project as manager
  const createRes = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': managerCookie
    },
    body: JSON.stringify({
      client_id: 10,
      name: 'Acme Winter Campaign',
      type: 'retainer',
      status: 'active',
      start_date: '2026-06-20',
      notes: 'Initial kick-off notes'
    })
  });
  assert.strictEqual(createRes.status, 201);
  const project = await createRes.json();
  assert.strictEqual(project.name, 'Acme Winter Campaign');
  assert.strictEqual(project.client_name, 'Acme F&B');

  // Member tries to create project -> 403 Forbidden
  const memberCreateRes = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': memberCookie
    },
    body: JSON.stringify({
      client_id: 10,
      name: 'Illegal Project'
    })
  });
  assert.strictEqual(memberCreateRes.status, 403);

  // List projects as member -> 200 OK
  const listRes = await fetch(`${baseUrl}/api/projects`, {
    headers: { 'Cookie': memberCookie }
  });
  assert.strictEqual(listRes.status, 200);
  const listData = await listRes.json();
  assert.ok(listData.data.length > 0);
  assert.ok(listData.data.some(p => p.name === 'Acme Winter Campaign'));

  // Read project details as member -> 200 OK
  const readRes = await fetch(`${baseUrl}/api/projects/${project.id}`, {
    headers: { 'Cookie': memberCookie }
  });
  assert.strictEqual(readRes.status, 200);
  const readProject = await readRes.json();
  assert.strictEqual(readProject.name, 'Acme Winter Campaign');

  // Update project as manager -> 200 OK
  const updateRes = await fetch(`${baseUrl}/api/projects/${project.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': managerCookie
    },
    body: JSON.stringify({
      name: 'Acme Winter Campaign v2',
      status: 'paused'
    })
  });
  assert.strictEqual(updateRes.status, 200);
  const updatedProject = await updateRes.json();
  assert.strictEqual(updatedProject.name, 'Acme Winter Campaign v2');
  assert.strictEqual(updatedProject.status, 'paused');
});

/**
 * 2. Task Recurrence
 */
test('Recurrence - addInterval utility correctly adds intervals and clamps months', () => {
  // Test daily
  assert.strictEqual(addInterval('2026-06-20', 'daily', 1), '2026-06-21');
  assert.strictEqual(addInterval('2026-06-20', 'daily', 5), '2026-06-25');

  // Test weekly
  assert.strictEqual(addInterval('2026-06-20', 'weekly', 1), '2026-06-27');
  assert.strictEqual(addInterval('2026-06-20', 'weekly', 2), '2026-07-04');

  // Test monthly leap year vs non-leap year clamp
  // 2024 is leap year, 2024-02 should end in 29
  assert.strictEqual(addInterval('2024-01-31', 'monthly', 1), '2024-02-29');
  // 2023 is non-leap year, 2023-02 should end in 28
  assert.strictEqual(addInterval('2023-01-31', 'monthly', 1), '2023-02-28');
  // Normal month addition
  assert.strictEqual(addInterval('2026-06-15', 'monthly', 2), '2026-08-15');
});

test('Recurrence - Task transition to done generates next recurrence instance, respecting boundaries', async () => {
  // Create a project to link tasks to
  const projectRes = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': managerCookie },
    body: JSON.stringify({ client_id: 10, name: 'Recurrence Test' })
  });
  const project = await projectRes.json();

  // Create a recurring task (no approval required)
  const taskRes = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': managerCookie },
    body: JSON.stringify({
      title: 'Daily Cleanup Job',
      client_id: 10,
      project_id: project.id,
      assignee_id: 3,
      priority: 'low',
      due_date: '2026-06-20',
      recurrence: 'daily',
      recurrence_interval: 2,
      recurrence_until: '2026-06-23' // Only allows next task due on 22, next-next on 24 should be blocked
    })
  });
  assert.strictEqual(taskRes.status, 201);
  const task = await taskRes.json();

  // Advance task status: todo -> in_progress (by member)
  const progressRes = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
    body: JSON.stringify({ status: 'in_progress' })
  });
  assert.strictEqual(progressRes.status, 200);

  // Complete task (in_progress -> done). This should trigger recurrence since needs_approval is 0
  const completeRes = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
    body: JSON.stringify({ status: 'done' })
  });
  assert.strictEqual(completeRes.status, 200);

  // Check db for the newly generated task
  // Since original due was 2026-06-20, next due should be 2026-06-22 (daily with interval 2)
  const listTasksRes = await fetch(`${baseUrl}/api/tasks?status=todo`, {
    headers: { 'Cookie': managerCookie }
  });
  const tasksList = await listTasksRes.json();
  const nextTask = tasksList.data.find(t => t.parent_task_id === task.id || t.parent_task_id === task.parent_task_id);
  assert.ok(nextTask);
  assert.strictEqual(nextTask.title, 'Daily Cleanup Job');
  assert.strictEqual(nextTask.due_date, '2026-06-22');
  assert.strictEqual(nextTask.status, 'todo');

  // Complete the next task (2026-06-22). The next recurrence would be 2026-06-24,
  // which is after recurrence_until ('2026-06-23'). So no new task should be created.
  await fetch(`${baseUrl}/api/tasks/${nextTask.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
    body: JSON.stringify({ status: 'in_progress' })
  });
  await fetch(`${baseUrl}/api/tasks/${nextTask.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
    body: JSON.stringify({ status: 'done' })
  });

  // Verify that no task with due date 2026-06-24 exists
  const listTasksRes2 = await fetch(`${baseUrl}/api/tasks`, {
    headers: { 'Cookie': managerCookie }
  });
  const tasksList2 = await listTasksRes2.json();
  const endedTask = tasksList2.data.find(t => t.due_date === '2026-06-24');
  assert.strictEqual(endedTask, undefined);
});

/**
 * 3. Gated Approvals
 */
test('Gated Approvals - Gating blocks direct done transitions for tasks needing approval', async () => {
  // Create task needing approval
  const taskRes = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': managerCookie },
    body: JSON.stringify({
      title: 'Verify Financial Ledger',
      client_id: 10,
      assignee_id: 3,
      priority: 'high',
      due_date: '2026-06-21',
      needs_approval: 1
    })
  });
  assert.strictEqual(taskRes.status, 201);
  const task = await taskRes.json();

  // Try to transition directly: todo -> in_progress (succeeds)
  const progressRes = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
    body: JSON.stringify({ status: 'in_progress' })
  });
  assert.strictEqual(progressRes.status, 200);

  // Try to transition directly to done: in_progress -> done (fails with 409)
  const completeRes = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
    body: JSON.stringify({ status: 'done' })
  });
  assert.strictEqual(completeRes.status, 409);
  const errBody = await completeRes.json();
  assert.strictEqual(errBody.error.code, 'CONFLICT');

  // Transition to in_review: in_progress -> in_review (succeeds)
  const reviewRes = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
    body: JSON.stringify({ status: 'in_review' })
  });
  assert.strictEqual(reviewRes.status, 200);

  // Try to complete as member: in_review -> done (fails with 409)
  const completeFromReviewRes = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': memberCookie },
    body: JSON.stringify({ status: 'done' })
  });
  assert.strictEqual(completeFromReviewRes.status, 409);

  // Member tries to approve task endpoint -> 403 Forbidden
  const memberApproveRes = await fetch(`${baseUrl}/api/tasks/${task.id}/approve`, {
    method: 'POST',
    headers: { 'Cookie': memberCookie }
  });
  assert.strictEqual(memberApproveRes.status, 403);

  // Approve task as manager -> 200 OK
  const approveRes = await fetch(`${baseUrl}/api/tasks/${task.id}/approve`, {
    method: 'POST',
    headers: { 'Cookie': managerCookie }
  });
  assert.strictEqual(approveRes.status, 200);
  const approvedTask = await approveRes.json();
  assert.strictEqual(approvedTask.status, 'done');
  assert.strictEqual(approvedTask.approved_by, 2); // manager user_id
  assert.ok(approvedTask.approved_at);
  assert.ok(approvedTask.completed_at);
});

/**
 * 4. Member Client Scoping
 */
test('Client Scoping - Members only see clients they have task assignments for', async () => {
  // Clear any existing task mappings
  db.prepare('DELETE FROM tasks').run();

  // Client 10 (Acme F&B) renewal is due.
  // Client 20 (Beta Ads) renewal is due.

  // Let's create a task for Client 10 assigned to Member (3)
  db.prepare(`
    INSERT INTO tasks (title, client_id, assignee_id, created_by, status, due_date)
    VALUES ('Acme Member Task', 10, 3, 1, 'todo', '2026-06-20')
  `).run();

  // List clients as member Padmini
  const listRes = await fetch(`${baseUrl}/api/clients`, {
    headers: { 'Cookie': memberCookie }
  });
  assert.strictEqual(listRes.status, 200);
  const clientsData = await listRes.json();
  
  // Member should see Client 10 (Acme F&B), but NOT Client 20 (Beta Ads)
  const clientIds = clientsData.data.map(c => c.id);
  assert.ok(clientIds.includes(10));
  assert.ok(!clientIds.includes(20));

  // Trying to fetch Client 20 details as member should return 403 Forbidden
  const detailRes = await fetch(`${baseUrl}/api/clients/20`, {
    headers: { 'Cookie': memberCookie }
  });
  assert.strictEqual(detailRes.status, 403);

  // Fetching Client 10 details should succeed
  const client10Res = await fetch(`${baseUrl}/api/clients/10`, {
    headers: { 'Cookie': memberCookie }
  });
  assert.strictEqual(client10Res.status, 200);
});

/**
 * 5. Life OS Role Gating (Admin only)
 */
test('Life OS Gating - Life OS routes reject non-admins with 403 FORBIDDEN', async () => {
  const routes = [
    '/api/life/habits',
    '/api/life/health',
    '/api/life/finance',
    '/api/life/finance/summary?month=2026-06',
    '/api/life/learning',
    '/api/life/journal',
    '/api/life/content-ideas',
    '/api/life/events'
  ];

  for (const route of routes) {
    const res = await fetch(`${baseUrl}${route}`, {
      headers: { 'Cookie': memberCookie }
    });
    assert.strictEqual(res.status, 403, `Route ${route} should reject members`);

    const managerRes = await fetch(`${baseUrl}${route}`, {
      headers: { 'Cookie': managerCookie }
    });
    assert.strictEqual(managerRes.status, 403, `Route ${route} should reject managers`);
  }
});

/**
 * 6. Life OS Core Capabilities (Admin Only)
 */
test('Life OS Habits - Habits tracking, logging, and streak mathematics', async () => {
  // 1. Create a habit
  const habitRes = await fetch(`${baseUrl}/api/life/habits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({
      name: 'Morning Meditation',
      cadence: 'daily',
      target_per_period: 1
    })
  });
  assert.strictEqual(habitRes.status, 201);
  const habit = await habitRes.json();
  assert.strictEqual(habit.name, 'Morning Meditation');

  // Clean log table to run streak tests
  db.prepare('DELETE FROM life_habit_logs').run();

  // Helper relative dates
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  
  const getOffsetDate = (offset) => {
    const d = new Date(todayStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().split('T')[0];
  };

  const yesterdayStr = getOffsetDate(-1);
  const twoDaysAgoStr = getOffsetDate(-2);
  const threeDaysAgoStr = getOffsetDate(-3);

  // 2. Log today as completed
  const logTodayRes = await fetch(`${baseUrl}/api/life/habits/${habit.id}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({ log_date: todayStr, done: true })
  });
  assert.strictEqual(logTodayRes.status, 200);

  // List habits and check streak (should be 1)
  let listRes = await fetch(`${baseUrl}/api/life/habits`, { headers: { 'Cookie': adminCookie } });
  let list = await listRes.json();
  let habitItem = list.find(h => h.id === habit.id);
  assert.strictEqual(habitItem.streak, 1);
  assert.strictEqual(habitItem.completed_today, true);

  // 3. Log yesterday as completed -> Streak should become 2
  await fetch(`${baseUrl}/api/life/habits/${habit.id}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({ log_date: yesterdayStr, done: true })
  });
  listRes = await fetch(`${baseUrl}/api/life/habits`, { headers: { 'Cookie': adminCookie } });
  list = await listRes.json();
  habitItem = list.find(h => h.id === habit.id);
  assert.strictEqual(habitItem.streak, 2);

  // 4. Log 3 days ago as completed, but leave 2 days ago unlogged -> Streak should stay 2 (broken at 2 days ago)
  await fetch(`${baseUrl}/api/life/habits/${habit.id}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({ log_date: threeDaysAgoStr, done: true })
  });
  listRes = await fetch(`${baseUrl}/api/life/habits`, { headers: { 'Cookie': adminCookie } });
  list = await listRes.json();
  habitItem = list.find(h => h.id === habit.id);
  assert.strictEqual(habitItem.streak, 2);

  // 5. Log 2 days ago as completed -> Streak should now fill in the gap and become 4
  await fetch(`${baseUrl}/api/life/habits/${habit.id}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({ log_date: twoDaysAgoStr, done: true })
  });
  listRes = await fetch(`${baseUrl}/api/life/habits`, { headers: { 'Cookie': adminCookie } });
  list = await listRes.json();
  habitItem = list.find(h => h.id === habit.id);
  assert.strictEqual(habitItem.streak, 4);

  // 6. Test Toggle off: Log today as NOT completed (done: false) -> Streak should become 3 (starts from yesterday)
  await fetch(`${baseUrl}/api/life/habits/${habit.id}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({ log_date: todayStr, done: false })
  });
  listRes = await fetch(`${baseUrl}/api/life/habits`, { headers: { 'Cookie': adminCookie } });
  list = await listRes.json();
  habitItem = list.find(h => h.id === habit.id);
  assert.strictEqual(habitItem.streak, 3);
  assert.strictEqual(habitItem.completed_today, false);
});

test('Life OS Finance - Income/Expense tracking and monthly summaries', async () => {
  // Create expense entry
  const expRes = await fetch(`${baseUrl}/api/life/finance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({
      kind: 'expense',
      category: 'Software License',
      amount: 1500,
      currency: 'INR',
      entry_date: '2026-06-15',
      note: 'Vim subscription'
    })
  });
  assert.strictEqual(expRes.status, 201);

  // Create income entry
  const incRes = await fetch(`${baseUrl}/api/life/finance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({
      kind: 'income',
      category: 'Freelancing',
      amount: 10000,
      currency: 'INR',
      entry_date: '2026-06-16',
      note: 'AdGrades OS contract payment'
    })
  });
  assert.strictEqual(incRes.status, 201);

  // Get summary for June 2026
  const summaryRes = await fetch(`${baseUrl}/api/life/finance/summary?month=2026-06`, {
    headers: { 'Cookie': adminCookie }
  });
  assert.strictEqual(summaryRes.status, 200);
  const summary = await summaryRes.json();
  assert.strictEqual(summary.income, 10000);
  assert.strictEqual(summary.expense, 1500);
  assert.strictEqual(summary.net, 8500);
  assert.strictEqual(summary.categories[0].category, 'Software License');
  assert.strictEqual(summary.categories[0].total, 1500);
});

test('Life OS Content Ideas, Learning, Journal, Events CRUD', async () => {
  // 1. Learning items
  const learnPost = await fetch(`${baseUrl}/api/life/learning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({
      title: 'Systems Programming in Go',
      source: 'Coursera',
      status: 'to_learn',
      hours: 0
    })
  });
  assert.strictEqual(learnPost.status, 201);
  const learnItem = await learnPost.json();

  const learnPatch = await fetch(`${baseUrl}/api/life/learning/${learnItem.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({ status: 'in_progress', hours: 4.5 })
  });
  assert.strictEqual(learnPatch.status, 200);
  const learnItemUpdated = await learnPatch.json();
  assert.strictEqual(learnItemUpdated.status, 'in_progress');
  assert.strictEqual(learnItemUpdated.hours, 4.5);

  // 2. Journaling
  const journalPost = await fetch(`${baseUrl}/api/life/journal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({
      entry_date: '2026-06-20',
      mood: 'energized',
      body: 'Today I completed all phases in one go and built a minimalist design.'
    })
  });
  assert.strictEqual(journalPost.status, 201);
  const journalEntry = await journalPost.json();
  assert.strictEqual(journalEntry.mood, 'energized');

  // 3. Calendar Events
  const eventPost = await fetch(`${baseUrl}/api/life/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
    body: JSON.stringify({
      title: 'AGY Review Meeting',
      start_at: '2026-06-25T14:30:00',
      end_at: '2026-06-25T15:30:00',
      all_day: false,
      type: 'work'
    })
  });
  assert.strictEqual(eventPost.status, 201);
  const event = await eventPost.json();

  // List & delete calendar event
  const eventsListRes = await fetch(`${baseUrl}/api/life/events?from=2026-06-01`, {
    headers: { 'Cookie': adminCookie }
  });
  const events = await eventsListRes.json();
  assert.ok(events.length > 0);

  const deleteEventRes = await fetch(`${baseUrl}/api/life/events/${event.id}`, {
    method: 'DELETE',
    headers: { 'Cookie': adminCookie }
  });
  assert.strictEqual(deleteEventRes.status, 200);
});

/**
 * 7. Telegram Outbound Notifications Trigger
 */
test('Telegram - Task assignments trigger Telegram HTTP push notification', async () => {
  // Clear mock call logs
  telegramCalls = [];

  // Create a task assigned to Member (who has chat ID '555555555' configured above)
  const taskRes = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': managerCookie },
    body: JSON.stringify({
      title: 'Critique Landing Page copy',
      client_id: 10,
      assignee_id: 3,
      priority: 'medium',
      due_date: '2026-06-22'
    })
  });
  assert.strictEqual(taskRes.status, 201);

  // Assert Telegram mock intercepted the call
  assert.strictEqual(telegramCalls.length, 1);
  const telegramCall = telegramCalls[0];
  assert.ok(telegramCall.url.includes('/sendMessage'));
  assert.strictEqual(telegramCall.body.chat_id, '555555555');
  assert.ok(telegramCall.body.text.includes('Critique Landing Page copy'));
  assert.ok(telegramCall.body.text.includes('MEDIUM'));
  assert.ok(telegramCall.body.text.includes('Likitesh'));
});

/**
 * 8. Marketing Content Calendar Board (CRUD)
 */
test('Content Calendar - CRUD operations and security restrictions', async () => {
  // Create a content item as manager
  const createRes = await fetch(`${baseUrl}/api/content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': managerCookie
    },
    body: JSON.stringify({
      client_id: 10,
      title: 'SEO Strategy Post',
      platform: 'LinkedIn',
      content_type: 'Article',
      scheduled_date: '2026-06-25',
      status: 'idea',
      assignee_id: 3,
      notes: 'Draft to outline main SEO parameters.'
    })
  });
  assert.strictEqual(createRes.status, 201);
  const item = await createRes.json();
  assert.strictEqual(item.title, 'SEO Strategy Post');
  assert.strictEqual(item.client_name, 'Acme F&B');

  // List content items as member (shows only assigned items)
  const listRes = await fetch(`${baseUrl}/api/content`, {
    headers: { 'Cookie': memberCookie }
  });
  assert.strictEqual(listRes.status, 200);
  const listData = await listRes.json();
  assert.ok(listData.data.length > 0);
  assert.strictEqual(listData.data[0].title, 'SEO Strategy Post');

  // Member updates status -> succeeds
  const memberPatchRes = await fetch(`${baseUrl}/api/content/${item.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': memberCookie
    },
    body: JSON.stringify({ status: 'draft' })
  });
  assert.strictEqual(memberPatchRes.status, 200);
  const updatedItem = await memberPatchRes.json();
  assert.strictEqual(updatedItem.status, 'draft');

  // Member tries to edit title -> 403 Forbidden
  const memberIllegalPatch = await fetch(`${baseUrl}/api/content/${item.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': memberCookie
    },
    body: JSON.stringify({ title: 'Hacked Title' })
  });
  assert.strictEqual(memberIllegalPatch.status, 403);
});
