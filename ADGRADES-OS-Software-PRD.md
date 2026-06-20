# AdGrades OS — Complete Software PRD & Technical Specification

| Field | Value |
|-------|-------|
| **Product** | AdGrades OS (Company OS + private Life OS) |
| **Owner** | Chandan B Krishna — Founder, AdGrades |
| **Document type** | Complete Software PRD / Build Specification |
| **Version** | 2.0 (supersedes & expands v1.0 outline) |
| **Date** | 19 June 2026 |
| **Build tooling** | Claude Code + Antigravity IDE (solo developer) |
| **Target host** | Self-hosted Ubuntu PC, LAN-only |
| **Status** | Approved for Phase 1 build |

### Revision history
| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 19 Jun 2026 | Initial outline PRD (architecture, schema, phases). |
| 2.0 | 19 Jun 2026 | Complete software spec: full data dictionary, full REST API, business rules, validation/error catalogs, UI spec, security, ops, test plan. |

---

## Table of Contents
1. Introduction
2. Product Overview
3. Personas & Roles
4. Assumptions, Constraints & Dependencies
5. System Architecture
6. Technology Stack
7. Functional Requirements (by module)
8. Data Model & Data Dictionary
9. Authorization Model & Permissions Matrix
10. Business Rules & State Machines
11. REST API Specification
12. Validation Rules
13. Error Handling & Error Catalog
14. Notifications & Scheduled Jobs
15. Frontend / UX Specification
16. Security Requirements
17. Non-Functional Requirements
18. Deployment & Operations
19. Build Phases & Acceptance Criteria
20. Test Plan
21. Repository Structure
22. Risks & Mitigations
23. Future Roadmap & Open Questions
24. Appendices (env vars, message templates, seed data, glossary)

---

## 1. Introduction

### 1.1 Purpose
This document fully specifies **AdGrades OS**, a self-hosted web application that runs AdGrades' client/work operations (**Company OS**) and the founder's personal productivity system (**Life OS**), on a single Ubuntu machine accessible over the office WiFi from laptops and phones.

### 1.2 Scope
**In scope:** authentication, role-based access, client management, projects, an assignable task engine (priority, recurrence, approval), a daily dashboard, a founder-only Life OS (calendar, habits, health/breaks, finances, learning, journaling, content ideas), Telegram reminders, and self-hosted deployment on a 4 GB box.
**Out of scope (this version):** public internet access, multi-company support, invoicing/billing automation, a public client portal, and replacement of existing SaaS (ClickUp, Google Workspace, Canva, Figma).

### 1.3 Audience
Solo developer building via Claude Code + Antigravity. The document is written to be executed by an AI coding agent: precise, testable, phase-gated.

### 1.4 Definitions
See the Glossary (Appendix 24.4).

---

## 2. Product Overview

### 2.1 Problem statement
1. Client work slips because there's no single source of truth for clients → projects → tasks with owners and due dates.
2. The founder's productivity (workouts, breaks, habits, study, journaling, finances, content) is unmanaged.
3. Personal data must stay private to the founder while company data is shared by role.

### 2.2 Vision
*Open one app on login → instantly see what's due today and overdue across all clients, assign and approve team work, and (founder only) run my personal life — on hardware we own, on our own network.*

### 2.3 Goals
- **G1** Zero missed client work via a daily dashboard of due/overdue tasks.
- **G2** Full task lifecycle: assignment, priority, recurrence, approval.
- **G3** Private founder Life OS, invisible to the team.
- **G4** Clean role-based access (Admin / Manager / Member).
- **G5** Telegram reminders to laptop + mobile.
- **G6** Reliable operation within a 4 GB RAM budget.

### 2.4 Non-goals
Remote (off-LAN) access, multi-business, SaaS replacement, public hosting, billing.

### 2.5 Success metrics
| Metric | Target |
|--------|--------|
| Overdue tasks with no owner | 0 |
| Daily dashboard load time (LAN) | < 1 s |
| App idle RAM | < 300 MB |
| App peak RAM | < 700 MB |
| Founder Life-OS data exposure to non-admins | 0 (verified by tests) |
| Daily reminder delivery success | ≥ 99% when Telegram configured |

---

## 3. Personas & Roles

| Persona | Member of team | Role | Primary needs |
|---------|----------------|------|----------------|
| Chandan (Founder) | Yes | **admin** | Oversee all clients/tasks; assign & approve; private Life OS. |
| Likitesh (Client Ops) | Yes | **manager** | Manage clients, create/assign tasks, track delivery. |
| Harshith (Designer, Task Mgr) | Yes | **manager** | Assign tasks, approve design work. |
| Maneesh (Ads & Strategy) | Yes | **manager** | Manage campaigns/projects, assign tasks. |
| Padmini (Sales) | Yes | **member** | See own tasks & assigned clients; update status. |
| Prathap (Sales) | Yes | **member** | Same as above. |

---

## 4. Assumptions, Constraints & Dependencies

### 4.1 Assumptions
- All users are on the same office WiFi when using the app.
- The box has stable power/network during work hours.
- The box has outbound internet for Telegram (optional; app works without it).

### 4.2 Constraints (hardware/environment)
| Item | Value |
|------|-------|
| CPU | Intel i3-7020U @ 2.30 GHz (2C/4T) |
| RAM | **4 GB (binding constraint)** |
| Storage | 1 TB |
| OS | Ubuntu Server (recommended) or Desktop with GUI disabled |
| Node.js | v20 LTS or v22 LTS |
| Access | LAN-only, `http://<box-ip>:<port>` |

### 4.3 Dependencies
Node.js runtime; npm packages in Section 6; optional Telegram Bot API.

### 4.4 Hard rules (must not be violated)
| # | Rule |
|---|------|
| R1 | Runtime = Node.js + SQLite only. No Postgres/MySQL/Mongo/Redis. |
| R2 | DB via `better-sqlite3`, prepared statements, WAL mode. No heavy ORM (no Prisma). |
| R3 | Total app RAM < 700 MB; single Node process; paginate all lists. |
| R4 | Auth = JWT in httpOnly, SameSite=Lax cookie; passwords hashed with `bcryptjs`. |
| R5 | Permissions enforced server-side on every request — never via hidden UI. |
| R6 | Life OS is admin-only; every Life query filters `owner_id = admin`; non-admin → 403. |
| R7 | LAN-only; firewall-restricted; only outbound call allowed is Telegram. |
| R8 | Frontend = mobile-friendly PWA; static build only; NO SSR server (no Next.js/Nuxt) on the box. |
| R9 | Minimal dependencies; justify each. |
| R10 | Timestamps ISO 8601; dates `YYYY-MM-DD`; timezone `Asia/Kolkata`. |
| R11 | Seed/migrations idempotent. |
| R12 | Foreign keys ON; CHECK constraints; validate all input server-side. |

---

## 5. System Architecture

### 5.1 Component / deployment view
```
                 Office WiFi / LAN
   ┌───────────────┐        ┌───────────────┐
   │ Laptop (PWA)  │        │  Phone (PWA)  │
   └──────┬────────┘        └───────┬───────┘
          │  http://<box-ip>:<port> │
          └────────────┬────────────┘
                       ▼
        ┌──────────────────────────────┐
        │   Ubuntu box (4 GB, headless) │
        │  ┌────────────────────────┐   │
        │  │  Node (Express)        │   │
        │  │  • Auth (JWT cookie)   │   │
        │  │  • Company OS API      │   │
        │  │  • Life OS API (admin) │   │
        │  │  • node-cron jobs      │───┼──► Telegram Bot API (outbound only)
        │  │  • static PWA host     │   │
        │  └─────────┬──────────────┘   │
        │            ▼                   │
        │     SQLite (WAL) app.db        │
        │     + daily file backup        │
        └──────────────────────────────┘
```

### 5.2 Logical layering
- **Routes** (`/src/routes`): HTTP endpoints, thin.
- **Middleware** (`/src/auth.js`): `authRequired`, `roleRequired(...roles)`, `adminOnly`, error handler, rate limiter.
- **Services** (`/src/services`): business logic + permission/ownership checks (the only place writes happen).
- **DB** (`/src/db.js`): connection, PRAGMAs, schema, prepared-statement helpers.
- **Jobs** (`/src/cron.js`): reminders + recurring-task generation.
- **Static** (`/public`): PWA assets.

### 5.3 Request lifecycle
1. Browser sends request with `token` cookie.
2. `authRequired` verifies JWT → sets `req.user = {id, role, name}`.
3. `roleRequired`/`adminOnly` gate the route.
4. Service performs the action with row-level ownership/assignment checks.
5. JSON response in the standard envelope (Section 11.2).

---

## 6. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Server | `express` | Lightweight HTTP/routing. |
| DB | `better-sqlite3` | Embedded, synchronous, one file, low RAM. |
| Hashing | `bcryptjs` | Pure JS, no native compile pain. |
| Tokens | `jsonwebtoken` | Stateless auth in cookie. |
| Cookies | `cookie-parser` | Read auth cookie. |
| Scheduling | `node-cron` | Reminders + recurrence. |
| Config | `dotenv` | `.env` config. |
| Frontend | PWA (vanilla HTML/JS + `fetch`; htmx/Alpine optional) | No build server on box; minimal RAM. |

Telegram is called via built-in `fetch` (Node ≥18) — **no extra dependency**.

---

## 7. Functional Requirements

> IDs are stable references. Each module lists requirements; acceptance is in Section 19, tests in Section 20.

### 7.1 Authentication & Account (FR-AUTH)
- **FR-AUTH-1** Users log in with username + password; on success a JWT is set as an httpOnly cookie.
- **FR-AUTH-2** `GET /api/auth/me` returns the current user; 401 if not logged in.
- **FR-AUTH-3** Logout clears the cookie.
- **FR-AUTH-4** Users can change their own password (current + new).
- **FR-AUTH-5** Failed logins are rate-limited (Section 16).

### 7.2 User Management (FR-USER) — admin
- **FR-USER-1** Admin can create users (name, username, password, role, optional telegram_chat_id).
- **FR-USER-2** Admin can edit role, name, active flag, telegram_chat_id, and reset password.
- **FR-USER-3** Admin can deactivate (soft-disable) a user; deactivated users cannot log in.
- **FR-USER-4** Admin and manager can list users (id, name, role) for task assignment; **only admin** sees telegram_chat_id.

### 7.3 Clients (FR-CLIENT)
- **FR-CLIENT-1** Admin/manager create and edit client profiles (Section 8 fields).
- **FR-CLIENT-2** All roles can view clients per the visibility rules (admin/manager: all; member: assigned only).
- **FR-CLIENT-3** Clients are never hard-deleted; set `status='churned'`.
- **FR-CLIENT-4** Clients with `renewal_date` within 14 days are flagged on the dashboard.

### 7.4 Projects (FR-PROJ) — Phase 1.5
- **FR-PROJ-1** Admin/manager create projects under a client (retainer/one-off, status, dates).
- **FR-PROJ-2** Tasks may link to a project; closing a project does not delete tasks.

### 7.5 Tasks (FR-TASK) — core engine
- **FR-TASK-1** Admin/manager create tasks with title, description, optional client/project, assignee, priority, due date, `needs_approval`, recurrence.
- **FR-TASK-2** Tasks follow the status state machine (Section 10.1).
- **FR-TASK-3** Members can update status only on tasks assigned to them, within allowed transitions.
- **FR-TASK-4** Approval tasks require an admin/manager **approve** action to reach `done`.
- **FR-TASK-5** Completing a recurring task generates the next instance (Section 10.2).
- **FR-TASK-6** On assignment, the assignee receives a Telegram message (if configured).
- **FR-TASK-7** Tasks are filterable by status, priority, client, project, assignee, due-date range.
- **FR-TASK-8** Admin/manager can reassign or delete tasks.

### 7.6 Dashboard (FR-DASH)
- **FR-DASH-1** On login the dashboard shows **overdue**, **due today**, **due next 7 days**, scoped by role.
- **FR-DASH-2** Admin/manager also see an **awaiting-approval** queue and per-status counts.
- **FR-DASH-3** Admin sees a compact **Life OS strip** (today's habits, last break, quick-log buttons).

### 7.7 Content Calendar (FR-CONTENT) — Phase 3
- **FR-CONTENT-1** Admin/manager schedule per-client content (platform, type, date, status, assignee).
- **FR-CONTENT-2** Members manage only their assigned content items.

### 7.8 Life OS (FR-LIFE) — admin only
- **FR-LIFE-1** Calendar: personal events CRUD.
- **FR-LIFE-2** Habits: define habits; daily/weekly check-ins; current streak computed.
- **FR-LIFE-3** Health: log workouts, breaks, sleep, weight, water.
- **FR-LIFE-4** Finances: personal income/expense ledger; monthly summary.
- **FR-LIFE-5** Learning: items with status + hours.
- **FR-LIFE-6** Journaling: dated entries with mood + body.
- **FR-LIFE-7** Content ideas: founder content pipeline.
- **FR-LIFE-8** Every Life endpoint requires `role=admin` and filters by `owner_id`; non-admin → 403.

---

## 8. Data Model & Data Dictionary

**Startup PRAGMAs:** `PRAGMA foreign_keys = ON;` `PRAGMA journal_mode = WAL;` `PRAGMA busy_timeout = 5000;`
Set `updated_at` in code on updates. All `created_at` default to `datetime('now')` (UTC) unless noted; the app renders in `Asia/Kolkata`.

### 8.1 Entity relationships
- `users (1) ──< tasks` (assignee_id, created_by, approved_by)
- `clients (1) ──< projects (1) ──< tasks`
- `clients (1) ──< tasks` (optional direct link)
- `clients (1) ──< content_calendar`
- `users (1, admin) ──< life_*` (owner_id)

### 8.2 Data dictionary — Company OS + Auth

**users**
| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| id | INTEGER | No | auto | PK | User id |
| name | TEXT | No | | | Display name |
| username | TEXT | No | | UNIQUE | Login handle |
| password_hash | TEXT | No | | | bcryptjs hash |
| role | TEXT | No | | CHECK in (admin,manager,member) | Role |
| telegram_chat_id | TEXT | Yes | | | Telegram chat id |
| active | INTEGER | No | 1 | 0/1 | Login allowed |
| created_at | TEXT | No | now | | Created |

**clients**
| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| id | INTEGER | No | auto | PK | |
| name | TEXT | No | | | Client/brand name |
| industry | TEXT | Yes | | | Industry |
| contact_name | TEXT | Yes | | | Primary contact |
| contact_email | TEXT | Yes | | | Email |
| contact_phone | TEXT | Yes | | | Phone |
| status | TEXT | No | active | CHECK in (lead,active,paused,churned) | Lifecycle |
| retainer_amount | REAL | Yes | | | Monthly retainer (INR) |
| renewal_date | TEXT | Yes | | YYYY-MM-DD | Next renewal |
| notes | TEXT | Yes | | | Free notes |
| created_by | INTEGER | Yes | | FK users(id) | Creator |
| created_at | TEXT | No | now | | |

**projects**
| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| id | INTEGER | No | auto | PK | |
| client_id | INTEGER | No | | FK clients(id) | Parent client |
| name | TEXT | No | | | Project name |
| type | TEXT | Yes | retainer | CHECK in (retainer,one_off) | Engagement type |
| status | TEXT | No | active | CHECK in (active,paused,completed) | State |
| start_date | TEXT | Yes | | YYYY-MM-DD | Start |
| renewal_date | TEXT | Yes | | YYYY-MM-DD | Renewal |
| notes | TEXT | Yes | | | |
| created_at | TEXT | No | now | | |

**tasks**
| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| id | INTEGER | No | auto | PK | |
| title | TEXT | No | | | Task title |
| description | TEXT | Yes | | | Details |
| client_id | INTEGER | Yes | | FK clients(id) | Optional client link |
| project_id | INTEGER | Yes | | FK projects(id) | Optional project link |
| assignee_id | INTEGER | Yes | | FK users(id) | Owner of the work |
| created_by | INTEGER | No | | FK users(id) | Creator |
| priority | TEXT | No | medium | CHECK in (low,medium,high,urgent) | Priority |
| status | TEXT | No | todo | CHECK in (todo,in_progress,in_review,done) | State |
| due_date | TEXT | Yes | | YYYY-MM-DD or ISO | Due |
| needs_approval | INTEGER | No | 0 | 0/1 | Requires approval to finish |
| approved_by | INTEGER | Yes | | FK users(id) | Approver |
| approved_at | TEXT | Yes | | | Approval time |
| recurrence | TEXT | Yes | | CHECK in (daily,weekly,monthly) | Recurrence unit |
| recurrence_interval | INTEGER | Yes | 1 | ≥1 | Every N units |
| recurrence_until | TEXT | Yes | | YYYY-MM-DD | Stop date |
| parent_task_id | INTEGER | Yes | | FK tasks(id) | Recurrence lineage |
| completed_at | TEXT | Yes | | | Completion time |
| created_at | TEXT | No | now | | |
| updated_at | TEXT | No | now | | Set on update |

Indexes: `assignee_id`, `client_id`, `due_date`, `status`.

**content_calendar** (Phase 3)
| Column | Type | Null | Default | Constraints | Description |
|--------|------|------|---------|-------------|-------------|
| id | INTEGER | No | auto | PK | |
| client_id | INTEGER | No | | FK clients(id) | Client |
| title | TEXT | No | | | Content title |
| platform | TEXT | Yes | | | instagram/linkedin/youtube/... |
| content_type | TEXT | Yes | | | post/reel/story/blog |
| scheduled_date | TEXT | Yes | | YYYY-MM-DD | Publish date |
| status | TEXT | No | idea | CHECK in (idea,draft,in_review,approved,scheduled,published) | Pipeline |
| assignee_id | INTEGER | Yes | | FK users(id) | Owner |
| notes | TEXT | Yes | | | |
| created_at | TEXT | No | now | | |

### 8.3 Data dictionary — Life OS (admin-only; every table has `owner_id` FK users(id), NOT NULL)

**life_habits**: id PK; owner_id; name; cadence CHECK(daily,weekly) default daily; target_per_period INT default 1; active 0/1 default 1; created_at.
**life_habit_logs**: id PK; habit_id FK; owner_id; log_date (YYYY-MM-DD); done 0/1 default 1; **UNIQUE(habit_id, log_date)**.
**life_health_logs**: id PK; owner_id; type CHECK(workout,break,sleep,weight,water); value TEXT; note TEXT; logged_at default now.
**life_finance_entries**: id PK; owner_id; kind CHECK(income,expense); category TEXT; amount REAL NOT NULL; currency TEXT default 'INR'; note TEXT; entry_date (YYYY-MM-DD) NOT NULL; created_at.
**life_learning**: id PK; owner_id; title NOT NULL; source TEXT; status CHECK(to_learn,in_progress,done) default to_learn; hours REAL default 0; notes TEXT; created_at; updated_at.
**life_journal**: id PK; owner_id; entry_date (YYYY-MM-DD) NOT NULL; mood TEXT; body TEXT; created_at.
**life_content_ideas**: id PK; owner_id; idea NOT NULL; hook TEXT; platform TEXT; status CHECK(idea,drafting,scheduled,posted) default idea; scheduled_date TEXT; created_at.
**life_calendar_events**: id PK; owner_id; title NOT NULL; start_at ISO NOT NULL; end_at ISO; all_day 0/1 default 0; type TEXT; note TEXT; created_at.

> The full `CREATE TABLE` SQL (identical to these definitions) is in Appendix 24.1.

---

## 9. Authorization Model & Permissions Matrix

### 9.1 Roles
- **admin** — everything in Company OS + sole owner of Life OS + user management.
- **manager** — full Company OS (clients, projects, tasks, approvals); **no** Life OS.
- **member** — assigned clients (read) + own tasks (status updates); **no** Life OS, **no** user management.

### 9.2 Matrix (enforced server-side — R5)
| Resource / Action | admin | manager | member |
|---|---|---|---|
| Users: create/edit/deactivate | ✅ | ❌ | ❌ |
| Users: list for assignment | ✅ | ✅ | ❌ |
| Clients: create/edit | ✅ | ✅ | ❌ |
| Clients: view | all | all | assigned only |
| Projects: create/edit | ✅ | ✅ | ❌ |
| Tasks: create/assign/reassign/delete | ✅ | ✅ | ❌ |
| Tasks: view | all | all | assigned to me |
| Tasks: update own status | ✅ | ✅ | ✅ |
| Tasks: approve | ✅ | ✅ | ❌ |
| Content calendar: manage | ✅ | ✅ | own items |
| Life OS (all) | ✅ owner | ❌ 403 | ❌ 403 |

### 9.3 Ownership rules
- Life OS: `WHERE owner_id = req.user.id` on every read/write; route guarded by `adminOnly`.
- Member client visibility: scoped via task assignment — a member can read a client only if they have ≥1 task on it (Phase 1.5). Until then, members get **read-only all clients** and this MUST be documented and replaced.

---

## 10. Business Rules & State Machines

### 10.1 Task status state machine
States: `todo → in_progress → in_review → done`.

| From | To | Allowed by | Condition |
|------|----|-----------|-----------|
| todo | in_progress | assignee, manager, admin | — |
| in_progress | in_review | assignee, manager, admin | required path when `needs_approval=1` |
| in_progress | done | assignee, manager, admin | only if `needs_approval=0` |
| in_review | done | manager, admin (via **approve**) | sets approved_by/approved_at/completed_at |
| in_review | in_progress | manager, admin | rework/rejection |
| any → todo | manager, admin | reset |

Reaching `done` sets `completed_at`. If `needs_approval=1`, `done` is reachable **only** through the approve action.

### 10.2 Recurrence algorithm
On a task transition **to `done`** (final), if `recurrence IS NOT NULL`:
1. `base = due_date ?? today`.
2. `next_due = addInterval(base, recurrence, recurrence_interval)`:
   - daily → `+ interval` days
   - weekly → `+ interval*7` days
   - monthly → `+ interval` months (clamp day to last day of target month)
3. If `recurrence_until IS NULL` **or** `next_due <= recurrence_until`:
   - Insert a new task copying `title, description, client_id, project_id, assignee_id, created_by, priority, needs_approval, recurrence, recurrence_interval, recurrence_until`; set `due_date=next_due`, `status='todo'`, `parent_task_id = original.parent_task_id ?? original.id`.
4. A daily safety cron ensures every active recurring lineage has exactly one open future instance (idempotent).

### 10.3 Client renewal flag
A client/project with `renewal_date` within the next 14 days appears in the dashboard "Renewals due" panel (admin/manager).

### 10.4 Habit streak
Current streak = count of consecutive prior periods (day for daily, ISO week for weekly) up to today with a `done=1` log, stopping at the first gap.

### 10.5 Assignment notification
On task create or reassignment, if assignee has `telegram_chat_id` and `TELEGRAM_BOT_TOKEN` is set, send the assignment message (Appendix 24.2). Failures are logged, never block the request.

---

## 11. REST API Specification

### 11.1 Conventions
- Base path `/api`. JSON in/out. Auth via `token` httpOnly cookie.
- Dates `YYYY-MM-DD`; datetimes ISO 8601. All list endpoints paginate.

### 11.2 Standard envelopes
**Success (single):** `200/201` → resource object.
**Success (list):** `200` → `{ "data": [...], "page": 1, "pageSize": 25, "total": 123 }`
**Error:** `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {...} } }` with the matching HTTP status (Section 13).

### 11.3 Common query params (lists)
`page` (default 1), `pageSize` (default 25, max 100), plus per-resource filters below.

### 11.4 Resource representations (shared shapes)
```jsonc
// User (response; password never returned)
{ "id":1, "name":"Chandan", "username":"chandan", "role":"admin",
  "telegram_chat_id":"123456", "active":true, "created_at":"2026-06-19T05:00:00Z" }

// Client
{ "id":10, "name":"Acme F&B", "industry":"F&B", "contact_name":"R. Rao",
  "contact_email":"r@acme.in", "contact_phone":"+91...", "status":"active",
  "retainer_amount":74999, "renewal_date":"2026-07-15", "notes":"...",
  "created_by":1, "created_at":"..." }

// Task
{ "id":55, "title":"Design July grid", "description":"...", "client_id":10,
  "project_id":3, "assignee_id":4, "created_by":2, "priority":"high",
  "status":"in_review", "due_date":"2026-06-25", "needs_approval":true,
  "approved_by":null, "approved_at":null, "recurrence":"monthly",
  "recurrence_interval":1, "recurrence_until":null, "parent_task_id":40,
  "completed_at":null, "created_at":"...", "updated_at":"..." }
```

### 11.5 Endpoints

**Health & Auth**
| Method | Path | Roles | Body | Success | Errors |
|--------|------|-------|------|---------|--------|
| GET | /api/health | public | — | 200 `{status,uptime,version}` | — |
| POST | /api/auth/login | public | `{username,password}` | 200 `{user}` + cookie | 401, 429 |
| POST | /api/auth/logout | auth | — | 204 | 401 |
| GET | /api/auth/me | auth | — | 200 `{user}` | 401 |
| POST | /api/auth/change-password | auth | `{currentPassword,newPassword}` | 200 | 400,401 |

**Users**
| Method | Path | Roles | Body | Success | Errors |
|--------|------|-------|------|---------|--------|
| GET | /api/users | admin, manager | — (manager gets id,name,role only) | 200 list | 401,403 |
| POST | /api/users | admin | `{name,username,password,role,telegram_chat_id?}` | 201 `{user}` | 400,403,409 |
| GET | /api/users/:id | admin | — | 200 `{user}` | 403,404 |
| PATCH | /api/users/:id | admin | `{name?,role?,active?,telegram_chat_id?,password?}` | 200 `{user}` | 400,403,404 |

**Clients**
| Method | Path | Roles | Filters/Body | Success | Errors |
|--------|------|-------|--------------|---------|--------|
| GET | /api/clients | all (scoped) | `status,search,page,pageSize` | 200 list | 401 |
| POST | /api/clients | admin, manager | client fields | 201 | 400,403 |
| GET | /api/clients/:id | all (scoped) | — | 200 | 403,404 |
| PATCH | /api/clients/:id | admin, manager | partial fields | 200 | 400,403,404 |

**Projects**
| Method | Path | Roles | Filters/Body | Success | Errors |
|--------|------|-------|--------------|---------|--------|
| GET | /api/projects | all (scoped) | `client_id,status,page,pageSize` | 200 list | 401 |
| POST | /api/projects | admin, manager | project fields | 201 | 400,403 |
| GET | /api/projects/:id | all (scoped) | — | 200 | 403,404 |
| PATCH | /api/projects/:id | admin, manager | partial | 200 | 400,403,404 |

**Tasks**
| Method | Path | Roles | Filters/Body | Success | Errors |
|--------|------|-------|--------------|---------|--------|
| GET | /api/tasks | all (member→own) | `status,priority,client_id,project_id,assignee_id,due_before,due_after,mine,page,pageSize` | 200 list | 401 |
| POST | /api/tasks | admin, manager | task fields | 201 | 400,403,404 |
| GET | /api/tasks/:id | scoped | — | 200 | 403,404 |
| PATCH | /api/tasks/:id | scoped (members: status of own only, allowed transitions) | partial / `{status}` | 200 | 400,403,404,409 |
| POST | /api/tasks/:id/approve | admin, manager | optional `{comment}` | 200 `{task}` | 403,404,409 |
| DELETE | /api/tasks/:id | admin, manager | — | 204 | 403,404 |

**Dashboard**
| Method | Path | Roles | Success |
|--------|------|-------|---------|
| GET | /api/dashboard | auth (scoped) | 200 `{ overdue:[], today:[], upcoming:[], awaitingApproval:[] (mgr/admin), renewals:[] (mgr/admin), counts:{...}, life:{...} (admin only) }` |

**Content Calendar** (Phase 3)
| Method | Path | Roles | Filters/Body |
|--------|------|-------|--------------|
| GET | /api/content | scoped | `client_id,status,from,to,page,pageSize` |
| POST | /api/content | admin, manager | content fields |
| PATCH | /api/content/:id | admin, manager (member: own) | partial |

**Life OS** (all `adminOnly`, owner-scoped — Phase 2)
| Method | Path | Body / Filters |
|--------|------|----------------|
| GET/POST | /api/life/habits | — / `{name,cadence,target_per_period}` |
| PATCH | /api/life/habits/:id | partial |
| POST | /api/life/habits/:id/log | `{log_date,done}` |
| GET/POST | /api/life/health | `type,from,to` / `{type,value,note}` |
| GET/POST | /api/life/finance | `kind,from,to` / `{kind,category,amount,currency,note,entry_date}` |
| GET | /api/life/finance/summary | `month=YYYY-MM` → totals by kind/category |
| GET/POST/PATCH | /api/life/learning | learning fields |
| GET/POST/PATCH | /api/life/journal | `from,to` / journal fields |
| GET/POST/PATCH | /api/life/content-ideas | idea fields |
| GET/POST/PATCH/DELETE | /api/life/events | `from,to` / event fields |

---

## 12. Validation Rules

| Field | Rule |
|-------|------|
| username | required, 3–32 chars, unique, `[a-z0-9._-]` |
| password | required, ≥ 8 chars (create/change) |
| role | one of admin/manager/member |
| name/title | required, 1–200 chars |
| email | if present, valid email format |
| phone | if present, 7–20 chars |
| amount | number ≥ 0 |
| priority | one of low/medium/high/urgent |
| task.status | only via allowed transitions (Section 10.1) |
| recurrence | one of daily/weekly/monthly; `recurrence_interval ≥ 1` |
| dates | `YYYY-MM-DD`; datetimes ISO 8601; reject malformed |
| pageSize | 1–100 |
| FK ids | must reference existing rows |

Reject invalid input with `400 VALIDATION_ERROR` and a `details` map of field → message. Never trust client-sent role/ownership.

---

## 13. Error Handling & Error Catalog

Standard error body: `{ "error": { "code", "message", "details?" } }`.

| HTTP | Code | When |
|------|------|------|
| 400 | VALIDATION_ERROR | Bad/missing input |
| 401 | AUTH_REQUIRED | No/invalid token |
| 401 | AUTH_INVALID_CREDENTIALS | Wrong username/password |
| 403 | FORBIDDEN | Role/ownership not allowed (incl. non-admin Life OS) |
| 404 | NOT_FOUND | Resource missing / not visible to caller |
| 409 | CONFLICT | Duplicate (username, habit log) or illegal status transition |
| 429 | RATE_LIMITED | Too many login attempts |
| 500 | INTERNAL | Unhandled error (logged; generic message to client) |

A central Express error-handling middleware maps thrown typed errors to this catalog. 500s log a stack trace server-side but never leak details to the client.

---

## 14. Notifications & Scheduled Jobs

| Job | Default schedule (Asia/Kolkata) | Behavior |
|-----|--------------------------------|----------|
| Daily task digest | `0 9 * * *` (`REMINDER_CRON`) | For each active user with a chat_id, send due-today + overdue tasks. |
| Recurring-task generator | `0 1 * * *` | Ensure each active recurring lineage has one open future instance. |
| Break reminder (admin only) | every N min within work hours (`BREAK_REMINDER_CRON`, `WORK_HOURS_START/END`) | Nudge the founder to take a break/stretch. |
| Assignment ping | event-driven | On task create/reassign, message assignee. |

- Transport: Telegram Bot API `sendMessage` via `fetch` (outbound only).
- If `TELEGRAM_BOT_TOKEN` is blank, all Telegram sends are no-ops; the in-app dashboard remains the source of truth.
- Setup helper: `npm run telegram:chatids` calls `getUpdates` and prints `{name → chat_id}` for the admin to fill in.
- Message templates: Appendix 24.2.

---

## 15. Frontend / UX Specification

### 15.1 Global
- Responsive PWA (`manifest.json`, service worker, installable, "Add to Home Screen").
- Top nav adapts to role; Life OS section visible **only** to admin.
- Every list view: loading, empty, and error states.
- Mobile-first layout; tap targets ≥ 44px.

### 15.2 Screens
| Screen | Roles | Key components | States / notes |
|--------|-------|----------------|----------------|
| Login | public | username, password, submit | error on bad creds |
| Dashboard | all | Overdue / Today / Next-7-days task lists; counts | member→own; mgr/admin→all + Awaiting approval + Renewals due; admin→Life strip |
| Tasks | all | filter bar (status/priority/client/assignee); task list; create/assign form (mgr/admin); status controls; **Approve** button (mgr/admin) | member sees own; transitions limited |
| Task detail | scoped | full fields; status timeline; approve/reject | recurrence + approval visible |
| Clients | all (scoped) | list + search; create/edit form (mgr/admin); detail with projects & tasks; renewal badge | member→assigned read-only |
| Projects | all (scoped) | list by client; create/edit (mgr/admin) | Phase 1.5 |
| Team | admin | user list; create/edit; role; telegram_chat_id; reset password | admin only |
| Content calendar | scoped | month/list view per client; status pipeline | Phase 3 |
| Life: Calendar | admin | event list/agenda; create/edit | admin only |
| Life: Habits | admin | habit list with streaks; daily check-in | admin only |
| Life: Health | admin | quick-log workout/break/sleep/weight/water; history | admin only |
| Life: Finances | admin | add income/expense; monthly summary | admin only |
| Life: Learning | admin | items with status + hours | admin only |
| Life: Journal | admin | dated entries, mood, body | admin only |
| Life: Content ideas | admin | pipeline board/list | admin only |

### 15.3 Daily dashboard priority ordering
Within each bucket, sort by priority (urgent→low) then due_date ascending.

---

## 16. Security Requirements

| ID | Requirement |
|----|-------------|
| SEC-1 | Passwords hashed with bcryptjs (cost 10–12); never stored or returned in plaintext. |
| SEC-2 | JWT signed with `JWT_SECRET` (≥ 32 random bytes); expiry `JWT_EXPIRES_IN` (default 7d). |
| SEC-3 | Token in httpOnly + SameSite=Lax cookie; `Secure` only when served over HTTPS (LAN HTTP → false; documented). |
| SEC-4 | Every endpoint runs auth + role/ownership checks server-side (R5/R6). |
| SEC-5 | All SQL uses parameterized prepared statements (no string concatenation). |
| SEC-6 | Login rate-limited (e.g., 5 attempts/min/IP) → 429. |
| SEC-7 | `.env` and `data/` are git-ignored; secrets never committed. |
| SEC-8 | LAN-only via firewall (Section 18); app not exposed to the internet. |
| SEC-9 | Input validated/sanitized (Section 12); output JSON-encoded. |
| SEC-10 | Deactivated users cannot authenticate; tokens checked against active flag on sensitive actions. |

---

## 17. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Idle RAM | < 300 MB |
| NFR-2 | Peak RAM | < 700 MB |
| NFR-3 | Dashboard response (LAN) | < 1 s |
| NFR-4 | Cold start | < 3 s |
| NFR-5 | Concurrent users | ≥ 6 comfortable |
| NFR-6 | DB | SQLite WAL; indexed; lists paginated |
| NFR-7 | Reliability | systemd auto-restart; survives reboot |
| NFR-8 | Backups | daily; retain 14 |
| NFR-9 | Logging | request + error logs to stdout/journald |
| NFR-10 | Maintainability | layered modules; raw SQL readable; deps justified |
| NFR-11 | Browser support | current Chrome/Firefox/Safari (desktop + mobile) |
| NFR-12 | Accessibility | semantic HTML, labels, contrast, keyboard nav |

---

## 18. Deployment & Operations

### 18.1 Install
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential
git clone <repo> adgrades-os && cd adgrades-os
npm ci
cp .env.example .env        # edit: JWT_SECRET, TELEGRAM_BOT_TOKEN, etc.
mkdir -p data backups
npm run seed                # idempotent: tables + 6 users
npm start                   # or systemd (below)
```

### 18.2 Fixed IP
Set a **DHCP reservation** on the router for the box so its LAN IP is stable.

### 18.3 Firewall (LAN-only)
```bash
sudo ufw default deny incoming
sudo ufw allow from 192.168.0.0/16 to any port 3000   # match your LAN subnet
sudo ufw enable
```

### 18.4 systemd service `/etc/systemd/system/adgrades-os.service`
```ini
[Unit]
Description=AdGrades OS
After=network.target

[Service]
WorkingDirectory=/home/<user>/adgrades-os
ExecStart=/usr/bin/node src/server.js
Restart=always
Environment=NODE_ENV=production
User=<user>

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now adgrades-os
journalctl -u adgrades-os -f   # logs
```

### 18.5 Backup (cron, 02:00 daily, keep 14)
```bash
0 2 * * * sqlite3 /home/<user>/adgrades-os/data/app.db "PRAGMA wal_checkpoint(TRUNCATE);" && \
          cp /home/<user>/adgrades-os/data/app.db /home/<user>/backups/app-$(date +\%F).db && \
          ls -1t /home/<user>/backups/app-*.db | tail -n +15 | xargs -r rm
```

### 18.6 Restore
Stop service → replace `data/app.db` with a backup copy → start service.

### 18.7 Update
`git pull && npm ci && npm run seed && sudo systemctl restart adgrades-os`.

---

## 19. Build Phases & Acceptance Criteria

### Phase 1 — The Spine
Scope: scaffold; DB+schema; auth (JWT cookie); roles + middleware; Users; Clients; Tasks (assignable, priority, due, status); Daily Dashboard; seed 6 users.
**Done when:** health OK & idle RAM < 300 MB · login/me/logout work · member cannot create/assign or see others' tasks (403) · manager can create & assign · dashboard overdue/today/7-day correct & role-scoped · 6 users seeded with hashed passwords.

### Phase 1.5 — Projects, Recurrence, Approval, Member scoping
**Done when:** completing a recurring task spawns the correct next instance & stops past `recurrence_until` · approval task can't reach `done` without approve (records approver/time) · members see only assigned clients/tasks.

### Phase 2 — Life OS (admin only)
**Done when:** any non-admin `/api/life/*` → 403 · habits show correct streaks · health/break/finance/learning/journal/content-ideas CRUD works · Life data invisible to manager/member anywhere.

### Phase 3 — Telegram, Content Calendar, Workload, PWA polish
**Done when:** 9 AM digest reaches configured users with real due/overdue · break reminders fire only for admin in-window · content calendar + workload view work · app installs as a PWA on a phone.

---

## 20. Test Plan

### 20.1 Priority test cases
| ID | Scenario | Expected |
|----|----------|----------|
| T-1 | Login wrong password | 401 AUTH_INVALID_CREDENTIALS |
| T-2 | Access any endpoint without cookie | 401 AUTH_REQUIRED |
| T-3 | Member POST /api/tasks | 403 FORBIDDEN |
| T-4 | Member GET /api/tasks | only own tasks returned |
| T-5 | Manager creates+assigns task to member | 201; assignee notified (if TG set) |
| T-6 | Member sets own approval task to `done` directly | 409 (must go to in_review) |
| T-7 | Manager approves in_review task | status done; approved_by/at set |
| T-8 | Complete monthly recurring task | next instance created with +1 month due |
| T-9 | Recurring past recurrence_until | no new instance |
| T-10 | Non-admin GET /api/life/habits | 403 |
| T-11 | Admin habit check-ins 3 consecutive days | streak = 3 |
| T-12 | Create user duplicate username | 409 CONFLICT |
| T-13 | Dashboard as member vs manager | scoped sets differ correctly |
| T-14 | Client renewal in 10 days | appears in renewals panel |
| T-15 | 6 logins/min | 6th → 429 |

### 20.2 Test approach
Lightweight integration tests hitting the API with a seeded DB (node:test or a tiny runner). Focus on permission boundaries (T-3,4,6,10), the approval gate (T-6,7), and recurrence (T-8,9).

---

## 21. Repository Structure
```
adgrades-os/
├─ PRD.md                  (this document)
├─ CLAUDE.md               (restate Section 4.4 + "build phase by phase")
├─ package.json
├─ .env.example
├─ data/                   (app.db — git-ignored)
├─ backups/                (git-ignored)
├─ src/
│  ├─ server.js            (express app, static host, error middleware)
│  ├─ db.js                (better-sqlite3 init, PRAGMAs, schema, helpers)
│  ├─ seed.js              (idempotent: schema + 6 users)
│  ├─ auth.js              (login, JWT, middleware, rate limit)
│  ├─ telegram.js          (sendMessage, templates)
│  ├─ telegram-chatids.js  (getUpdates helper)
│  ├─ cron.js              (digest, recurrence, break reminders)
│  ├─ services/            (users, clients, projects, tasks, dashboard, content, life)
│  └─ routes/              (auth, users, clients, projects, tasks, dashboard, content, life)
└─ public/                 (index.html, app, app.js, styles.css, manifest.json, sw.js)
```

---

## 22. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| 4 GB RAM exhaustion | Headless OS; single process; SQLite; pagination; RAM budget tests. |
| Box failure / disk loss | Daily backups (14 retained); documented restore. |
| Permission leak (esp. Life OS) | Server-side checks; explicit 403 tests (T-3,4,6,10). |
| Telegram outage | Sends are best-effort, non-blocking; dashboard is source of truth. |
| Recurrence bugs | Deterministic algorithm + safety cron + tests (T-8,9). |
| IP changes break access | DHCP reservation (fixed IP). |
| Scope creep before Phase 1 ships | Phase gates with acceptance criteria. |

---

## 23. Future Roadmap & Open Questions
- **Tailscale** for secure off-LAN access without internet exposure (keeps the security model intact).
- **Inbound Telegram commands** (e.g., mark task done from chat).
- **Multi-business** via an `org_id` to add Pure Blend / Fresh And Fluffy.
- **Scale-out** to Postgres only if it ever outgrows one box (not before).
- Open question: should sales (Padmini/Prathap) gain limited client-create rights? Default = no (member) for now.

---

## 24. Appendices

### 24.1 Full CREATE TABLE SQL
> Use exactly the column definitions in Section 8 (Company OS + Auth and Life OS). Wrap creation in the startup PRAGMAs (`foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000`). All statements use `IF NOT EXISTS` for idempotency. Create the four task indexes (`assignee_id`, `client_id`, `due_date`, `status`).

### 24.2 Telegram message templates
```
[Assignment] 🆕 New task: "{title}"
Client: {client}  • Priority: {priority}  • Due: {due_date}
Assigned by {creator}.

[Daily digest] ☀️ Good morning {name}.
Overdue ({n}):
- {title} — {client} — was due {due_date}
Due today ({m}):
- {title} — {client} — {priority}
Open AdGrades OS to update.

[Break] 🧘 Time for a 5-minute break — stand up, stretch, hydrate.
```

### 24.3 Environment variables
| Var | Default | Purpose |
|-----|---------|---------|
| PORT | 3000 | Listen port |
| JWT_SECRET | — | Token signing secret (set a long random value) |
| JWT_EXPIRES_IN | 7d | Token lifetime |
| SEED_DEFAULT_PASSWORD | adgrades123 | Initial password for seeded users |
| TZ | Asia/Kolkata | App timezone |
| DB_PATH | ./data/app.db | SQLite file |
| BACKUP_DIR | ./backups | Backup target |
| TELEGRAM_BOT_TOKEN | (blank) | Enables Telegram if set |
| REMINDER_CRON | 0 9 * * * | Daily digest schedule |
| BREAK_REMINDER_CRON | */90 * * * * | Break nudge cadence (admin) |
| WORK_HOURS_START | 10 | Break window start (hour) |
| WORK_HOURS_END | 19 | Break window end (hour) |
| COOKIE_SECURE | false | Set true only behind HTTPS |
| NODE_ENV | production | Mode |

### 24.4 Glossary
| Term | Meaning |
|------|---------|
| Company OS | Shared, role-based system: clients, projects, tasks, content. |
| Life OS | Founder-only personal system (admin-scoped). |
| Owner-scoping | Restricting rows to `owner_id = current admin`. |
| Approval task | Task with `needs_approval=1`; needs admin/manager approve to finish. |
| Recurring lineage | A chain of tasks linked by `parent_task_id`. |
| PWA | Installable web app usable like a native app on phones. |

---

*End of Complete Software PRD v2.0. Implementation order is fixed by Section 19 — do not advance past a phase until its acceptance criteria pass.*
