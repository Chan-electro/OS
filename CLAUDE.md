# CLAUDE.md — Build & Operation Guidelines

## Commands

- **Start application server**: `npm start`
- **Initialize & Seed database**: `npm run seed`
- **Run automated test suite**: `npm test`

---

## 1. Hard Rules (PRD Section 4.4)

| # | Rule |
|---|------|
| **R1** | Runtime = Node.js + SQLite only. No Postgres/MySQL/Mongo/Redis. |
| **R2** | DB via `better-sqlite3`, prepared statements, WAL mode. No heavy ORMs (no Prisma). |
| **R3** | Total app RAM < 700 MB; single Node process; paginate all lists. |
| **R4** | Auth = JWT in httpOnly, SameSite=Lax cookie; passwords hashed with `bcryptjs`. |
| **R5** | Permissions enforced server-side on every request — never via hidden UI. |
| **R6** | Life OS is admin-only; every Life query filters `owner_id = admin`; non-admin → 403. |
| **R7** | LAN-only; firewall-restricted; only outbound call allowed is Telegram. |
| **R8** | Frontend = mobile-friendly PWA; static build only; NO SSR server (no Next.js/Nuxt) on the box. |
| **R9** | Minimal dependencies; justify each. |
| **R10** | Timestamps ISO 8601; dates `YYYY-MM-DD`; timezone `Asia/Kolkata`. |
| **R11** | Seed/migrations idempotent. |
| **R12** | Foreign keys ON; CHECK constraints; validate all input server-side. |

---

## 2. Build Strategy & Phase Progression

Always build and test phase-by-phase. Do not proceed to a subsequent phase until the current phase's acceptance criteria are fully met and all test coverage is passing.

### Phase 1 — The Spine (Current: COMPLETED)
- Database schema migrations and idempotent seeding ([db.js](file:///Users/joyrajroy/Chandan/OS/src/db.js), [seed.js](file:///Users/joyrajroy/Chandan/OS/src/seed.js)).
- Secure Auth JWT Cookie tokenization, role-enforcement middlewares, and login Rate Limiters ([auth.js](file:///Users/joyrajroy/Chandan/OS/src/auth.js)).
- Users, Clients, Tasks CRUD services and REST route controllers.
- Multi-role Scoped Daily Dashboard compilations ([dashboard.js](file:///Users/joyrajroy/Chandan/OS/src/services/dashboard.js)).
- Premium responsive PWA SPA frontend ([index.html](file:///Users/joyrajroy/Chandan/OS/public/index.html), [styles.css](file:///Users/joyrajroy/Chandan/OS/public/styles.css), [app.js](file:///Users/joyrajroy/Chandan/OS/public/app.js)).

### Phase 1.5 — Projects, Recurrence & Gated Approvals (Next)
- Link projects under clients.
- Implement recurrence algorithm generating next tasks relative to interval units.
- Enforce approval checks blocking assignee from marking `needs_approval` tasks as `done` directly.
- Scoping client visibility to members having assigned tasks on them.

### Phase 2 — Life OS (Admin Restricted)
- REST APIs & tables for: Habits (cadence & streaks logs), Health metrics, ledger Entries, Learning tracks, Journals, and Content ideas.
- Scoping security to reject non-admin access with `403 FORBIDDEN`.

### Phase 3 — Telegram & Content Integrations
- Node-cron automated digest scripts at 9:00 AM daily.
- Event-driven Telegram Bot push notifications for assignees.
- Content calendar and workload visualization filters.
