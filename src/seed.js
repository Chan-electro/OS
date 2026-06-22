import db, { initSchema } from './db.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const defaultPassword = process.env.SEED_DEFAULT_PASSWORD || 'adgrades123';

async function seed() {
  console.log('Initializing schema...');
  initSchema();

  console.log('Seeding default users...');
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(defaultPassword, salt);

  const defaultUsers = [
    { name: 'Chandan B Krishna', username: 'chandan', role: 'admin' },
    { name: 'Likitesh', username: 'likitesh', role: 'manager' },
    { name: 'Harshith', username: 'harshith', role: 'manager' },
    { name: 'Maneesh', username: 'maneesh', role: 'manager' },
    { name: 'Padmini', username: 'padmini', role: 'member' },
    { name: 'Prathap', username: 'prathap', role: 'member' }
  ];

  db.transaction(() => {
    // Clear existing data in correct dependency order
    db.prepare('DELETE FROM life_calendar_events').run();
    db.prepare('DELETE FROM life_content_ideas').run();
    db.prepare('DELETE FROM life_journal').run();
    db.prepare('DELETE FROM life_learning').run();
    db.prepare('DELETE FROM life_finance_entries').run();
    db.prepare('DELETE FROM life_health_logs').run();
    db.prepare('DELETE FROM life_habit_logs').run();
    db.prepare('DELETE FROM life_habits').run();
    db.prepare('DELETE FROM content_calendar').run();
    db.prepare('DELETE FROM agreements').run();
    db.prepare('DELETE FROM invoices').run();
    db.prepare('DELETE FROM tasks').run();
    db.prepare('DELETE FROM projects').run();
    db.prepare('DELETE FROM clients').run();
    db.prepare('DELETE FROM users').run();

    // Reset autoincrement sequences
    const tables = [
      'users', 'clients', 'projects', 'tasks', 'content_calendar',
      'invoices', 'agreements',
      'life_habits', 'life_habit_logs', 'life_health_logs',
      'life_finance_entries', 'life_learning', 'life_journal',
      'life_content_ideas', 'life_calendar_events'
    ];
    for (const t of tables) {
      db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(t);
    }

    // Insert users
    const insertUser = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, active)
      VALUES (?, ?, ?, ?, 1)
    `);

    const usersMap = {};
    for (const u of defaultUsers) {
      const result = insertUser.run(u.name, u.username, passwordHash, u.role);
      usersMap[u.username] = result.lastInsertRowid;
    }

    console.log('Users seeded successfully:', Object.keys(usersMap));

    // Helper for relative dates
    const getRelativeDateStr = (daysOffset) => {
      const d = new Date();
      d.setDate(d.getDate() + daysOffset);
      return d.toISOString().split('T')[0];
    };

    const todayStr = getRelativeDateStr(0);
    const tomorrowStr = getRelativeDateStr(1);
    const yesterdayStr = getRelativeDateStr(-1);
    const dayBeforeYesterdayStr = getRelativeDateStr(-2);
    const threeDaysStr = getRelativeDateStr(3);

    // Seed default clients
    const insertClient = db.prepare(`
      INSERT INTO clients (name, industry, contact_name, contact_email, status, retainer_amount, renewal_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Client 1: Acme F&B
    const client1Id = insertClient.run(
      'Acme F&B',
      'F&B',
      'R. Rao',
      'r@acme.in',
      'active',
      75000,
      getRelativeDateStr(10),
      usersMap['chandan']
    ).lastInsertRowid;

    // Client 2: Beta Ads
    const client2Id = insertClient.run(
      'Beta Ads',
      'Marketing',
      'John Doe',
      'john@beta.com',
      'active',
      45000,
      getRelativeDateStr(30),
      usersMap['chandan']
    ).lastInsertRowid;

    // Client 3: Gamma Tech
    const client3Id = insertClient.run(
      'Gamma Tech',
      'Technology',
      'Jane Smith',
      'jane@gamma.io',
      'paused',
      100000,
      getRelativeDateStr(5),
      usersMap['chandan']
    ).lastInsertRowid;

    console.log('Clients seeded.');

    // Seed projects
    const insertProject = db.prepare(`
      INSERT INTO projects (client_id, name, type, status, start_date, renewal_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const project1Id = insertProject.run(
      client1Id,
      'Website Design Grid Layout',
      'one_off',
      'active',
      todayStr,
      getRelativeDateStr(10),
      'Brand grid design project.'
    ).lastInsertRowid;

    const project2Id = insertProject.run(
      client2Id,
      'Ads Optimization Retainer',
      'retainer',
      'active',
      todayStr,
      getRelativeDateStr(30),
      'Google ads and Facebook ads optimization retainer.'
    ).lastInsertRowid;

    console.log('Projects seeded.');

    // Seed tasks
    const insertTask = db.prepare(`
      INSERT INTO tasks (title, description, client_id, project_id, assignee_id, created_by, priority, status, due_date, needs_approval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Task 1: Assigned to likitesh, due today
    insertTask.run(
      'Client Onboarding Strategy',
      'Create the initial onboarding campaign document.',
      client1Id,
      project1Id,
      usersMap['likitesh'],
      usersMap['chandan'],
      'high',
      'todo',
      todayStr,
      0
    );

    // Task 2: Assigned to harshith, due tomorrow, needs approval
    insertTask.run(
      'Design July Grid Layout',
      'Create Figma layout designs and present for review.',
      client1Id,
      project1Id,
      usersMap['harshith'],
      usersMap['chandan'],
      'urgent',
      'in_progress',
      tomorrowStr,
      1
    );

    // Task 3: Assigned to padmini, due yesterday (overdue)
    insertTask.run(
      'Lead List Verification',
      'Verify new incoming leads dataset.',
      client3Id,
      null,
      usersMap['padmini'],
      usersMap['chandan'],
      'medium',
      'todo',
      yesterdayStr,
      0
    );

    console.log('Tasks seeded.');

    // Seed Content Calendar
    const insertContent = db.prepare(`
      INSERT INTO content_calendar (client_id, title, platform, content_type, scheduled_date, status, assignee_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertContent.run(
      client1Id,
      'F&B Brand Grid Launch Reel',
      'instagram',
      'reel',
      todayStr,
      'approved',
      usersMap['harshith'],
      'Launching grid preview.'
    );

    insertContent.run(
      client2Id,
      'B2B Ads Growth Hacks Post',
      'linkedin',
      'post',
      tomorrowStr,
      'draft',
      usersMap['maneesh'],
      'LinkedIn carousel outline.'
    );

    console.log('Content calendar seeded.');

    // Seed Life OS Tables (Chandan user ID 1)
    const chandanId = usersMap['chandan'];

    // Habits
    const habit1Id = db.prepare(`
      INSERT INTO life_habits (owner_id, name, cadence, target_per_period, active)
      VALUES (?, 'Morning Stretch & Workout', 'daily', 1, 1)
    `).run(chandanId).lastInsertRowid;

    const habit2Id = db.prepare(`
      INSERT INTO life_habits (owner_id, name, cadence, target_per_period, active)
      VALUES (?, 'Weekly Finance Bookkeeping', 'weekly', 1, 1)
    `).run(chandanId).lastInsertRowid;

    // Habit Logs (Streak creation for Habit 1)
    const insertHabitLog = db.prepare(`
      INSERT INTO life_habit_logs (habit_id, owner_id, log_date, done)
      VALUES (?, ?, ?, 1)
    `);

    insertHabitLog.run(habit1Id, chandanId, todayStr);
    insertHabitLog.run(habit1Id, chandanId, yesterdayStr);
    insertHabitLog.run(habit1Id, chandanId, dayBeforeYesterdayStr);

    // Health logs
    const insertHealth = db.prepare(`
      INSERT INTO life_health_logs (owner_id, type, value, note, logged_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    insertHealth.run(chandanId, 'workout', '45 mins run', 'Felt great. HR max 160.');
    insertHealth.run(chandanId, 'water', '2500 ml', 'Met daily hydration goal.');

    // Finances ledger
    const insertFinance = db.prepare(`
      INSERT INTO life_finance_entries (owner_id, kind, category, amount, currency, note, entry_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Monthly stats: current month
    const curMonth = todayStr.substring(0, 7);
    insertFinance.run(chandanId, 'income', 'Retainer - Acme', 75000, 'INR', 'Monthly retainer payment.', `${curMonth}-05`);
    insertFinance.run(chandanId, 'income', 'Retainer - Beta', 45000, 'INR', 'Ads management fee.', `${curMonth}-10`);
    insertFinance.run(chandanId, 'expense', 'Rent', 22000, 'INR', 'Office space rent.', `${curMonth}-01`);
    insertFinance.run(chandanId, 'expense', 'Internet', 1500, 'INR', 'Fiber broadband.', `${curMonth}-02`);
    insertFinance.run(chandanId, 'expense', 'Server hosting', 3500, 'INR', 'Headless box backup cost.', `${curMonth}-12`);

    // Learning track
    const insertLearning = db.prepare(`
      INSERT INTO life_learning (owner_id, title, source, status, hours, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertLearning.run(chandanId, 'NextJS 15 Core Concepts', 'Udemy', 'in_progress', 8.5, 'Focusing on Server Actions.');
    insertLearning.run(chandanId, 'Autonomous AI Agents Architecture', 'Google DeepMind Research', 'to_learn', 0.0, 'Review AGY SDK implementation hooks.');

    // Journaling
    const insertJournal = db.prepare(`
      INSERT INTO life_journal (owner_id, entry_date, mood, body)
      VALUES (?, ?, ?, ?)
    `);
    insertJournal.run(chandanId, todayStr, 'focused', 'Successfully deployed Phase 1 and style layouts. Monochrome styling feels highly structured and functional.');

    // Content ideas
    const insertIdea = db.prepare(`
      INSERT INTO life_content_ideas (owner_id, idea, hook, platform, status, scheduled_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertIdea.run(chandanId, 'Why ORMs slow down small apps', 'Prisma took 300ms, raw SQLite took 1ms. Here is why.', 'linkedin', 'drafting', tomorrowStr);

    // Calendar events
    const insertEvent = db.prepare(`
      INSERT INTO life_calendar_events (owner_id, title, start_at, end_at, all_day, type, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertEvent.run(chandanId, 'Acme Grid Design Review Meeting', `${todayStr}T11:00:00`, `${todayStr}T12:00:00`, 0, 'meeting', 'Discuss website grid with Likitesh.');
    insertEvent.run(chandanId, 'Founder Focus Block', `${todayStr}T14:00:00`, `${todayStr}T17:00:00`, 0, 'focus', 'Deep work block.');

    console.log('Life OS tables seeded.');
  })();

  console.log('Seeding complete.');
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
