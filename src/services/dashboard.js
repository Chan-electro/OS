import db from '../db.js';

/**
 * Helper to get date string in YYYY-MM-DD in Asia/Kolkata timezone
 */
export function getKolkataDate(offsetDays = 0) {
  const date = new Date();
  if (offsetDays !== 0) {
    date.setDate(date.getDate() + offsetDays);
  }
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function getDashboardData(user) {
  const today = getKolkataDate(0);
  const sevenDaysFromNow = getKolkataDate(7);

  const scopeQuery = user.role === 'member' ? 'AND assignee_id = ?' : '';
  const scopeParams = user.role === 'member' ? [user.id] : [];

  const baseTaskSelect = `
    SELECT t.*, c.name as client_name, u.name as assignee_name
    FROM tasks t
    LEFT JOIN clients c ON t.client_id = c.id
    LEFT JOIN users u ON t.assignee_id = u.id
  `;

  // Sort order query fragment
  const sortOrder = `
    ORDER BY
      CASE priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END ASC,
      due_date ASC
  `;

  // 1. Overdue bucket: due_date < today AND status != 'done'
  const overdue = db.prepare(`
    ${baseTaskSelect}
    WHERE t.due_date < ? AND t.status != 'done' ${scopeQuery}
    ${sortOrder}
  `).all(today, ...scopeParams);

  // 2. Today bucket: due_date = today AND status != 'done'
  const dueToday = db.prepare(`
    ${baseTaskSelect}
    WHERE t.due_date = ? AND t.status != 'done' ${scopeQuery}
    ${sortOrder}
  `).all(today, ...scopeParams);

  // 3. Upcoming bucket: due_date > today AND due_date <= sevenDaysFromNow AND status != 'done'
  const upcoming = db.prepare(`
    ${baseTaskSelect}
    WHERE t.due_date > ? AND t.due_date <= ? AND t.status != 'done' ${scopeQuery}
    ${sortOrder}
  `).all(today, sevenDaysFromNow, ...scopeParams);

  // 4. Counts by status
  const countsQuery = user.role === 'member'
    ? 'SELECT status, COUNT(*) as count FROM tasks WHERE assignee_id = ? GROUP BY status'
    : 'SELECT status, COUNT(*) as count FROM tasks GROUP BY status';
  const countsParams = user.role === 'member' ? [user.id] : [];
  const countsRows = db.prepare(countsQuery).all(...countsParams);

  const counts = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
  for (const r of countsRows) {
    if (r.status in counts) {
      counts[r.status] = r.count;
    }
  }

  const result = {
    overdue: overdue.map(t => ({ ...t, needs_approval: !!t.needs_approval })),
    today: dueToday.map(t => ({ ...t, needs_approval: !!t.needs_approval })),
    upcoming: upcoming.map(t => ({ ...t, needs_approval: !!t.needs_approval })),
    counts
  };

  // Manager and Admin specific widgets
  if (user.role === 'admin' || user.role === 'manager') {
    // 5. Awaiting Approval: status = 'in_review'
    const awaitingApproval = db.prepare(`
      ${baseTaskSelect}
      WHERE t.status = 'in_review'
      ORDER BY t.updated_at ASC
    `).all();

    // 6. Renewals due: clients/projects with renewal_date between today and today + 14 days
    // The PRD says: "renewal_date within 14 days"
    const fourteenDaysFromNow = getKolkataDate(14);
    const renewals = db.prepare(`
      SELECT id, name, status, renewal_date, retainer_amount
      FROM clients
      WHERE renewal_date >= ? AND renewal_date <= ? AND status != 'churned'
      ORDER BY renewal_date ASC
    `).all(today, fourteenDaysFromNow);

    result.awaitingApproval = awaitingApproval.map(t => ({ ...t, needs_approval: !!t.needs_approval }));
    result.renewals = renewals;
  }

  // Admin specific widgets (Life OS Strip)
  if (user.role === 'admin') {
    // Phase 2 will implement full Life OS strip. For Phase 1 we return a placeholder.
    result.life = {
      habits: [], // Habits list check-in
      lastBreak: null,
      message: 'Life OS Strip Placeholder (Phase 2)'
    };
  }

  return result;
}
