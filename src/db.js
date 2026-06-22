import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DB_PATH || './data/app.db';

// Ensure the directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Create connection
const db = new Database(dbPath);

// Configure Pragmas
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

/**
 * Initializes the database schema.
 * Idempotent: uses CREATE TABLE IF NOT EXISTS.
 */
export function initSchema() {
  db.transaction(() => {
    // 1. Users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'member')),
        telegram_chat_id TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 2. Clients table
    db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        industry TEXT,
        contact_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('lead', 'active', 'paused', 'churned')),
        retainer_amount REAL,
        renewal_date TEXT,
        notes TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
    `);

    // 3. Projects table
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'retainer' CHECK(type IN ('retainer', 'one_off')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed')),
        start_date TEXT,
        renewal_date TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (client_id) REFERENCES clients(id)
      );
    `);

    // 4. Tasks table
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        client_id INTEGER,
        project_id INTEGER,
        assignee_id INTEGER,
        created_by INTEGER NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'in_review', 'done')),
        due_date TEXT,
        needs_approval INTEGER NOT NULL DEFAULT 0 CHECK(needs_approval IN (0, 1)),
        approved_by INTEGER,
        approved_at TEXT,
        recurrence TEXT CHECK(recurrence IN ('daily', 'weekly', 'monthly')),
        recurrence_interval INTEGER DEFAULT 1 CHECK(recurrence_interval >= 1),
        recurrence_until TEXT,
        parent_task_id INTEGER,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (assignee_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id),
        FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
      );
    `);

    // Task Indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_client_id ON tasks(client_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`);

    // 5. Content Calendar (Phase 3)
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_calendar (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        platform TEXT,
        content_type TEXT,
        scheduled_date TEXT,
        status TEXT NOT NULL DEFAULT 'idea' CHECK(status IN ('idea', 'draft', 'in_review', 'approved', 'scheduled', 'published')),
        assignee_id INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (assignee_id) REFERENCES users(id)
      );
    `);

    // 6. Life OS Tables (Phase 2, Admin Only)
    db.exec(`
      CREATE TABLE IF NOT EXISTS life_habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        cadence TEXT NOT NULL DEFAULT 'daily' CHECK(cadence IN ('daily', 'weekly')),
        target_per_period INTEGER NOT NULL DEFAULT 1 CHECK(target_per_period >= 1),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS life_habit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER NOT NULL,
        owner_id INTEGER NOT NULL,
        log_date TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 1 CHECK(done IN (0, 1)),
        UNIQUE(habit_id, log_date),
        FOREIGN KEY (habit_id) REFERENCES life_habits(id),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS life_health_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('workout', 'break', 'sleep', 'weight', 'water')),
        value TEXT NOT NULL,
        note TEXT,
        logged_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS life_finance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('income', 'expense')),
        category TEXT,
        amount REAL NOT NULL CHECK(amount >= 0),
        currency TEXT NOT NULL DEFAULT 'INR',
        note TEXT,
        entry_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS life_learning (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        source TEXT,
        status TEXT NOT NULL DEFAULT 'to_learn' CHECK(status IN ('to_learn', 'in_progress', 'done')),
        hours REAL DEFAULT 0 CHECK(hours >= 0),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS life_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        entry_date TEXT NOT NULL,
        mood TEXT,
        body TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS life_content_ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        idea TEXT NOT NULL,
        hook TEXT,
        platform TEXT,
        status TEXT NOT NULL DEFAULT 'idea' CHECK(status IN ('idea', 'drafting', 'scheduled', 'posted')),
        scheduled_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS life_calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT,
        all_day INTEGER NOT NULL DEFAULT 0 CHECK(all_day IN (0, 1)),
        type TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
    `);

    // Invoices table
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT NOT NULL UNIQUE,
        client_id INTEGER,
        client_name TEXT,
        client_address TEXT,
        items TEXT NOT NULL DEFAULT '[]',
        tax_rate REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        subtotal REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','paid','overdue')),
        due_date TEXT,
        notes TEXT,
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
    `);

    // Agreements table
    db.exec(`
      CREATE TABLE IF NOT EXISTS agreements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        client_name TEXT,
        content TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','signed')),
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
    `);
  })();
}

export default db;
