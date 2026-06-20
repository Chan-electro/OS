import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import fs from 'fs';
import path from 'path';

// Set test environment variables BEFORE importing application code
process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/test-app.db';
process.env.JWT_SECRET = 'test-secret-value-longer-than-32-chars-for-testing';
process.env.SEED_DEFAULT_PASSWORD = 'testpassword123';

import bcrypt from 'bcryptjs';

// Application modules will be loaded dynamically to respect the environment variables set above
let db, initSchema, app;
let server;
let baseUrl;

// Test variables to store cookie strings for roles
let adminCookie = '';
let managerCookie = '';
let memberCookie = '';

test.before(async () => {
  // Dynamically load the modules so that their top-level code (like database initialization)
  // runs with the correct DB_PATH set in process.env.
  const dbModule = await import('../src/db.js');
  db = dbModule.default;
  initSchema = dbModule.initSchema;

  const serverModule = await import('../src/server.js');
  app = serverModule.default;

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
    db.prepare('DELETE FROM clients').run();
    db.prepare('DELETE FROM users').run();

    // Insert users
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, username, password_hash, role, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    
    insertUser.run(1, 'Chandan B Krishna', 'chandan', passwordHash, 'admin');
    insertUser.run(2, 'Likitesh', 'likitesh', passwordHash, 'manager');
    insertUser.run(3, 'Padmini', 'padmini', passwordHash, 'member');

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

    // Insert tasks
    const insertTask = db.prepare(`
      INSERT INTO tasks (id, title, assignee_id, client_id, created_by, priority, status, due_date, needs_approval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const today = new Date().toISOString().split('T')[0];
    // Task 1: assigned to member, due today
    insertTask.run(100, 'Member Task 1', 3, 10, 1, 'high', 'todo', today, 0);
    // Task 2: assigned to manager, due today, needs approval
    insertTask.run(200, 'Manager Task 1', 2, 20, 1, 'urgent', 'in_progress', today, 1);
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

// --- Test Cases ---

test('T-1: Login wrong password returns 401 AUTH_INVALID_CREDENTIALS', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'chandan', password: 'wrongpassword' })
  });

  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.strictEqual(body.error.code, 'AUTH_INVALID_CREDENTIALS');
});

test('T-2: Access endpoints without cookie returns 401 AUTH_REQUIRED', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard`);
  
  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.strictEqual(body.error.code, 'AUTH_REQUIRED');
});

test('T-3: Member POST /api/tasks returns 403 FORBIDDEN', async () => {
  const res = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': memberCookie
    },
    body: JSON.stringify({
      title: 'New Member Task',
      assignee_id: 3,
      priority: 'low'
    })
  });

  assert.strictEqual(res.status, 403);
  const body = await res.json();
  assert.strictEqual(body.error.code, 'FORBIDDEN');
});

test('T-4: Member GET /api/tasks only returns tasks assigned to them', async () => {
  const res = await fetch(`${baseUrl}/api/tasks`, {
    headers: { 'Cookie': memberCookie }
  });

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  
  // Ensure that all tasks returned have assignee_id === 3
  assert.ok(body.data.length > 0);
  for (const task of body.data) {
    assert.strictEqual(task.assignee_id, 3);
  }
});

test('T-12: Create user duplicate username returns 409 CONFLICT', async () => {
  const res = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookie
    },
    body: JSON.stringify({
      name: 'Duplicate Chandan',
      username: 'chandan',
      password: 'newpassword123',
      role: 'member'
    })
  });

  assert.strictEqual(res.status, 409);
  const body = await res.json();
  assert.strictEqual(body.error.code, 'CONFLICT');
});

test('T-13: Dashboard lists differ between Member and Manager roles', async () => {
  // Fetch as Member
  const memberRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { 'Cookie': memberCookie }
  });
  assert.strictEqual(memberRes.status, 200);
  const memberBody = await memberRes.json();

  // Fetch as Manager
  const managerRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { 'Cookie': managerCookie }
  });
  assert.strictEqual(managerRes.status, 200);
  const managerBody = await managerRes.json();

  // Manager sees approvals and client renewals widget properties
  assert.ok('awaitingApproval' in managerBody);
  assert.ok('renewals' in managerBody);

  // Member does not see renewals or awaitingApproval widgets
  assert.ok(!('awaitingApproval' in memberBody));
  assert.ok(!('renewals' in memberBody));
  
  // Member status counts are scoped (only counts task 100 which is todo)
  assert.strictEqual(memberBody.counts.todo, 1);
  assert.strictEqual(memberBody.counts.in_progress, 0);

  // Manager sees all status counts (task 100 is todo, task 200 is in_progress)
  assert.strictEqual(managerBody.counts.todo, 1);
  assert.strictEqual(managerBody.counts.in_progress, 1);
});

test('T-14: Client renewal in 10 days flags in the renewals panel', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { 'Cookie': managerCookie }
  });

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  
  // Client 10 (Acme F&B) renewal is in 10 days, client 20 (Beta Ads) is in 30 days.
  // Renewals widget flags <= 14 days, so Acme F&B should be present, Beta Ads should be absent.
  assert.ok(body.renewals.length > 0);
  const clientNames = body.renewals.map(c => c.name);
  assert.ok(clientNames.includes('Acme F&B'));
  assert.ok(!clientNames.includes('Beta Ads'));
});

test('T-15: Login rate limiter blocks after 5 requests', async () => {
  // Trigger 5 fast logins
  for (let i = 0; i < 5; i++) {
    await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'chandan', password: 'wrongpassword' })
    });
  }

  // 6th login should return 429
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'chandan', password: 'wrongpassword' })
  });

  assert.strictEqual(res.status, 429);
  const body = await res.json();
  assert.strictEqual(body.error.code, 'RATE_LIMITED');
});
