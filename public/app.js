// --- AdGrades OS SPA Client Controller ---

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('PWA Service Worker registered:', reg.scope))
      .catch(err => console.error('PWA Service Worker registration failed:', err));
  });
}

// Global Application State
let currentUser = null;
let activeScreen = 'dashboard';

// Cache data for listings and selectors
let teamMembers = [];
let clientsList = [];
let projectsList = [];

// Pagination tracking
let tasksPage = 1;
const tasksPageSize = 10;
let projectsPage = 1;
const projectsPageSize = 10;
let clientsPage = 1;
const clientsPageSize = 10;
let contentPage = 1;
const contentPageSize = 10;

// Calendar state
let calYear = null;
let calMonth = null;
let calAllTasks = [];
let calSelectedDay = null;

// Clock state
let clockInterval = null;

// Timer state
let timerSeconds = 0;
let timerInterval = null;
let timerRunning = false;
let timerLogs = [];

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAuthentication();
  window.addEventListener('hashchange', handleHashRouting);
  document.getElementById('cal-prev').onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } loadCalendarWorkspace(); };
  document.getElementById('cal-next').onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } loadCalendarWorkspace(); };
  document.getElementById('timer-task-dropdown').onchange = function() {
    const opt = this.options[this.selectedIndex];
    document.getElementById('timer-task-name').textContent = opt.value ? opt.text.replace(/^\[.*?\]\s*/, '') : 'No task selected';
  };
});

// --- Authentication Check ---
async function checkAuthentication() {
  showLoading(true);
  try {
    const res = await fetch('/api/auth/me');
    if (res.status === 200) {
      const data = await res.json();
      currentUser = data.user;
      setupUIForRole();
      handleHashRouting();
    } else {
      showLoginView();
    }
  } catch (err) {
    console.error('Auth verification failed:', err);
    showLoginView();
  } finally {
    showLoading(false);
  }
}

// --- Navigation & Routing ---
function handleHashRouting() {
  if (!currentUser) {
    showLoginView();
    return;
  }

  const hash = window.location.hash || '#dashboard';
  activeScreen = hash.substring(1);

  // Enforce role-based access
  if (activeScreen === 'team' && currentUser.role !== 'admin') {
    window.location.hash = '#dashboard';
    return;
  }
  if (activeScreen === 'life' && currentUser.role !== 'admin') {
    window.location.hash = '#dashboard';
    return;
  }

  // Update navigation links state
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
  });
  const activeLink = document.getElementById(`nav-${activeScreen}`);
  if (activeLink) activeLink.classList.add('active');

  // Hide all screens, show current one
  document.querySelectorAll('.screen-content').forEach(screen => {
    screen.classList.add('hidden');
  });

  const targetScreen = document.getElementById(`${activeScreen}-screen`);
  if (targetScreen) {
    targetScreen.classList.remove('hidden');
    loadScreenData(activeScreen);
  }
}

function loadScreenData(screen) {
  // Stop clock tick when leaving clock screen
  if (screen !== 'clock' && clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }

  switch (screen) {
    case 'dashboard': loadDashboard();          break;
    case 'tasks':     loadTasksWorkspace();     break;
    case 'projects':  loadProjectsWorkspace();  break;
    case 'clients':   loadClientsWorkspace();   break;
    case 'content':   loadContentWorkspace();   break;
    case 'team':      loadTeamWorkspace();      break;
    case 'life':      loadLifeOSWorkspace();    break;
    case 'calendar':  loadCalendarWorkspace();  break;
    case 'clock':     loadClockWorkspace();     break;
    case 'timer':     loadTimerWorkspace();     break;
  }
}

// --- Setup UI based on Role ---
function setupUIForRole() {
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('content-view').classList.remove('hidden');
  document.getElementById('login-view').classList.add('hidden');

  document.getElementById('profile-name').textContent = currentUser.name;
  document.getElementById('profile-role').textContent = currentUser.role;
  document.getElementById('user-avatar-char').textContent = currentUser.name.charAt(0).toUpperCase();
  const welcomeNameEl = document.getElementById('welcome-name');
  if (welcomeNameEl) welcomeNameEl.textContent = currentUser.name;

  // Role visibility gating
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'manager';
  
  if (currentUser.role === 'admin') {
    document.getElementById('nav-team').classList.remove('hidden');
    document.getElementById('nav-life').classList.remove('hidden');
  } else {
    document.getElementById('nav-team').classList.add('hidden');
    document.getElementById('nav-life').classList.add('hidden');
  }

  if (isPrivileged) {
    document.getElementById('btn-create-task').classList.remove('hidden');
    document.getElementById('btn-create-project').classList.remove('hidden');
    document.getElementById('btn-create-client').classList.remove('hidden');
    document.getElementById('btn-create-content').classList.remove('hidden');
  } else {
    document.getElementById('btn-create-task').classList.add('hidden');
    document.getElementById('btn-create-project').classList.add('hidden');
    document.getElementById('btn-create-client').classList.add('hidden');
    document.getElementById('btn-create-content').classList.add('hidden');
  }

  loadReferenceLists();
}

async function loadReferenceLists() {
  if (!currentUser) return;
  try {
    // 1. Fetch team members for assignments
    if (currentUser.role === 'admin' || currentUser.role === 'manager') {
      const usersRes = await fetch('/api/users');
      if (usersRes.ok) {
        teamMembers = await usersRes.json();
        populateUsersDropdowns();
      }
    }
    
    // 2. Fetch clients
    const clientsRes = await fetch('/api/clients?pageSize=100');
    if (clientsRes.ok) {
      const result = await clientsRes.json();
      clientsList = result.data;
      populateClientsDropdowns();
    }

    // 3. Fetch projects
    const projectsRes = await fetch('/api/projects?pageSize=100');
    if (projectsRes.ok) {
      const result = await projectsRes.json();
      projectsList = result.data;
      populateProjectsDropdowns();
    }
  } catch (err) {
    console.error('Error loading reference lists:', err);
  }
}

function populateUsersDropdowns() {
  const dropdowns = ['task-assignee', 'content-assignee', 'filter-task-assignee'];
  dropdowns.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isFilter = id.startsWith('filter');
    el.innerHTML = (isFilter ? '<option value="">All</option>' : '<option value="">Unassigned</option>') +
      teamMembers.map(u => `<option value="${u.id}">${escapeHTML(u.name)}</option>`).join('');
  });
}

function populateClientsDropdowns() {
  const dropdowns = ['task-client', 'project-client', 'content-client', 'filter-task-client', 'filter-project-client', 'filter-content-client'];
  dropdowns.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isFilter = id.startsWith('filter');
    const defaultVal = isFilter ? 'All' : (id.includes('project') || id.includes('content') ? 'Select Client' : 'No Client (Internal)');
    const defaultOption = `<option value="">${defaultVal}</option>`;
    
    el.innerHTML = defaultOption + clientsList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  });
}

function populateProjectsDropdowns() {
  const taskProject = document.getElementById('task-project');
  if (taskProject) {
    taskProject.innerHTML = '<option value="">No Project</option>' +
      projectsList.map(p => `<option value="${p.id}">${escapeHTML(p.name)} (${escapeHTML(p.client_name)})</option>`).join('');
  }
}

// --- Dashboard Logic ---
async function loadDashboard() {
  try {
    const [dashRes, tasksRes] = await Promise.all([
      fetch('/api/dashboard'),
      fetch('/api/tasks?pageSize=100')
    ]);

    if (!dashRes.ok) throw new Error('Dashboard loading failed');
    const data = await dashRes.json();

    document.getElementById('stat-todo').textContent = data.counts.todo || 0;
    document.getElementById('stat-progress').textContent = data.counts.in_progress || 0;
    document.getElementById('stat-review').textContent = data.counts.in_review || 0;
    document.getElementById('stat-done').textContent = data.counts.done || 0;

    renderCompactTaskList('list-overdue', data.overdue, true);
    renderCompactTaskList('list-today', data.today);
    renderCompactTaskList('list-upcoming', data.upcoming);

    const overdueSection = document.getElementById('section-overdue');
    if (data.overdue && data.overdue.length > 0) {
      overdueSection.classList.remove('hidden');
    } else {
      overdueSection.classList.add('hidden');
    }

    if (currentUser.role === 'admin' || currentUser.role === 'manager') {
      document.getElementById('widget-approval').classList.remove('hidden');
      document.getElementById('widget-renewals').classList.remove('hidden');
      renderApprovalList(data.awaitingApproval);
      renderRenewalsList(data.renewals);
    } else {
      document.getElementById('widget-approval').classList.add('hidden');
      document.getElementById('widget-renewals').classList.add('hidden');
    }

    if (currentUser.role === 'admin') {
      document.getElementById('widget-life-strip').classList.remove('hidden');
      loadLifeOSStrip();
    } else {
      document.getElementById('widget-life-strip').classList.add('hidden');
    }

    // Render analytics charts
    renderStatusChart('chart-status-distribution', data.counts);
    if (tasksRes.ok) {
      const tasksData = await tasksRes.json();
      renderPriorityChart('chart-priority-breakdown', tasksData.data);
    }
  } catch (err) {
    console.error(err);
  }
}

function renderCompactTaskList(elementId, tasks, isOverdue = false) {
  const container = document.getElementById(elementId);
  if (!container) return;

  if (!tasks || tasks.length === 0) {
    container.innerHTML = `<div class="empty-message">No tasks found.</div>`;
    return;
  }

  container.innerHTML = tasks.map(task => {
    const clientBadge = task.client_name ? `<span class="task-c-client">• ${escapeHTML(task.client_name)}</span>` : '';
    const dateLabel = isOverdue ? `Was due: ${task.due_date}` : `Due: ${task.due_date || 'No Date'}`;
    const approvalIndicator = task.needs_approval ? `<span class="badge badge-review">Requires Approval</span>` : '';
    
    return `
      <div class="task-compact-item" onclick="openEditTaskModal(${task.id})">
        <div class="task-c-left">
          <span class="task-c-title">${escapeHTML(task.title)}</span>
          <div class="task-c-meta">
            <span class="badge badge-${task.priority}">${task.priority}</span>
            ${clientBadge}
            <span>${dateLabel}</span>
            ${approvalIndicator}
          </div>
        </div>
        <div class="task-c-right">
          <span class="badge badge-${task.status.replace('_', '')}">${task.status.replace('_', ' ')}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderApprovalList(tasks) {
  const container = document.getElementById('list-approval');
  if (!container) return;

  if (!tasks || tasks.length === 0) {
    container.innerHTML = `<div class="empty-message">No items awaiting approval.</div>`;
    return;
  }

  container.innerHTML = tasks.map(task => `
    <div class="approval-item">
      <div class="flex-between">
        <span class="text-title-small">${escapeHTML(task.title)}</span>
        <button class="btn-approve-small" onclick="approveTaskAction(event, ${task.id})">Approve</button>
      </div>
      <div class="flex-between">
        <span class="text-meta-small">Assignee: ${escapeHTML(task.assignee_name || 'Unassigned')}</span>
        <span class="text-meta-small">Client: ${escapeHTML(task.client_name || 'Internal')}</span>
      </div>
    </div>
  `).join('');
}

async function approveTaskAction(event, id) {
  event.stopPropagation();
  if (!confirm('Approve this task?')) return;
  try {
    const res = await fetch(`/api/tasks/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      loadDashboard();
      if (activeScreen === 'tasks') loadTasksWorkspace();
    } else {
      const err = await res.json();
      alert(`Approval failed: ${err.error.message}`);
    }
  } catch (err) {
    console.error(err);
  }
}

function renderRenewalsList(clients) {
  const container = document.getElementById('list-renewals');
  if (!container) return;

  if (!clients || clients.length === 0) {
    container.innerHTML = `<div class="empty-message">No renewals due.</div>`;
    return;
  }

  container.innerHTML = clients.map(client => `
    <div class="renewal-item">
      <div class="flex-between">
        <span class="text-title-small">${escapeHTML(client.name)}</span>
        <span class="badge badge-urgent">${client.renewal_date}</span>
      </div>
      <div class="flex-between text-meta-small">
        <span>Amount: INR ${client.retainer_amount ? client.retainer_amount.toLocaleString() : 'N/A'}</span>
      </div>
    </div>
  `).join('');
}

async function loadLifeOSStrip() {
  const container = document.getElementById('life-dashboard-strip-habits');
  if (!container) return;

  try {
    const res = await fetch('/api/life/habits');
    if (!res.ok) return;
    const habits = await res.json();

    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-message">No active habits.</div>';
      return;
    }

    container.innerHTML = habits.map(h => {
      const btnClass = h.completed_today ? 'habit-log-check done' : 'habit-log-check';
      const label = h.completed_today ? 'Done' : 'Mark';
      return `
        <div class="flex-between" style="font-size:12px; border-bottom:1px solid var(--border-color); padding-bottom:4px;">
          <span>${escapeHTML(h.name)} (Streak: <b>${h.streak}</b>)</span>
          <button class="${btnClass}" onclick="toggleHabitLogStrip(event, ${h.id}, '${h.completed_today}')">${label}</button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

async function toggleHabitLogStrip(event, habitId, currentlyDone) {
  event.stopPropagation();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const nextDoneState = currentlyDone !== 'true';

  try {
    const res = await fetch(`/api/life/habits/${habitId}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_date: today, done: nextDoneState })
    });
    if (res.ok) {
      loadLifeOSStrip();
    }
  } catch (err) {
    console.error(err);
  }
}

// --- Tasks Workspace ---
async function loadTasksWorkspace() {
  const status = document.getElementById('filter-task-status').value;
  const priority = document.getElementById('filter-task-priority').value;
  const client_id = document.getElementById('filter-task-client').value;
  const assignee_id = document.getElementById('filter-task-assignee') ? document.getElementById('filter-task-assignee').value : '';

  let query = `/api/tasks?page=${tasksPage}&pageSize=${tasksPageSize}`;
  if (status) query += `&status=${status}`;
  if (priority) query += `&priority=${priority}`;
  if (client_id) query += `&client_id=${client_id}`;
  if (assignee_id) query += `&assignee_id=${assignee_id}`;

  try {
    const res = await fetch(query);
    if (!res.ok) throw new Error('Tasks fetch failed');
    const result = await res.json();
    renderTasksTable(result.data);
    renderPagination('tasks-pagination', result.total, tasksPage, tasksPageSize, (newPage) => {
      tasksPage = newPage;
      loadTasksWorkspace();
    });
  } catch (err) {
    console.error(err);
  }
}

function renderTasksTable(tasks) {
  const tbody = document.getElementById('tasks-table-body');
  if (!tbody) return;

  if (tasks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-message">No tasks found.</td></tr>`;
    return;
  }

  tbody.innerHTML = tasks.map(task => {
    const isAssignee = task.assignee_id === currentUser.id;
    const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'manager';

    let statusSelect = `<span class="badge badge-${task.status.replace('_', '')}">${task.status.replace('_', ' ')}</span>`;
    if (isPrivileged || isAssignee) {
      statusSelect = `
        <select class="select-status-small" onchange="updateTaskStatusAction(${task.id}, this.value)">
          <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
          <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="in_review" ${task.status === 'in_review' ? 'selected' : ''}>In Review</option>
          <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
      `;
    }

    let actions = '';
    if (isPrivileged) {
      actions += `
        <button class="btn-icon" onclick="openEditTaskModal(${task.id})" title="Edit">✏️</button>
        <button class="btn-icon delete" onclick="deleteTaskAction(${task.id})" title="Delete">🗑️</button>
      `;
      if (task.status === 'in_review') {
        actions = `<button class="btn-approve-small" onclick="approveTaskAction(event, ${task.id})">Approve</button>` + actions;
      }
    }

    return `
      <tr>
        <td>
          <span class="data-table-title">${escapeHTML(task.title)}</span>
          ${task.recurrence ? `<span class="badge badge-life" style="font-size: 8px;">🔁 ${task.recurrence}</span>` : ''}
          ${task.description ? `<div class="data-table-desc">${escapeHTML(task.description)}</div>` : ''}
        </td>
        <td>${escapeHTML(task.client_name || 'Internal')}</td>
        <td><span class="badge badge-${task.priority}">${task.priority}</span></td>
        <td>${task.due_date || 'No Date'}</td>
        <td>${escapeHTML(task.assignee_name || 'Unassigned')}</td>
        <td>${statusSelect}</td>
        <td><div class="action-buttons">${actions}</div></td>
      </tr>
    `;
  }).join('');
}

// --- Projects Workspace ---
async function loadProjectsWorkspace() {
  const client_id = document.getElementById('filter-project-client').value;
  const status = document.getElementById('filter-project-status').value;

  let query = `/api/projects?page=${projectsPage}&pageSize=${projectsPageSize}`;
  if (client_id) query += `&client_id=${client_id}`;
  if (status) query += `&status=${status}`;

  try {
    const res = await fetch(query);
    if (!res.ok) throw new Error('Projects fetch failed');
    const result = await res.json();
    renderProjectsTable(result.data);
    renderPagination('projects-pagination', result.total, projectsPage, projectsPageSize, (newPage) => {
      projectsPage = newPage;
      loadProjectsWorkspace();
    });
  } catch (err) {
    console.error(err);
  }
}

function renderProjectsTable(projects) {
  const tbody = document.getElementById('projects-table-body');
  if (!tbody) return;

  if (projects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-message">No projects found.</td></tr>`;
    return;
  }

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'manager';

  tbody.innerHTML = projects.map(p => {
    const editBtn = isPrivileged ? `<button class="btn-icon" onclick="openEditProjectModal(${p.id})">✏️</button>` : '';
    return `
      <tr>
        <td class="data-table-title">${escapeHTML(p.name)}</td>
        <td>${escapeHTML(p.client_name)}</td>
        <td><span class="badge">${p.type}</span></td>
        <td><span class="badge">${p.status}</span></td>
        <td>${p.start_date || 'N/A'}</td>
        <td>${p.renewal_date || 'N/A'}</td>
        <td>${editBtn}</td>
      </tr>
    `;
  }).join('');
}

// --- Clients Workspace ---
async function loadClientsWorkspace() {
  const status = document.getElementById('filter-client-status').value;
  const search = document.getElementById('filter-client-search').value;

  let query = `/api/clients?page=${clientsPage}&pageSize=${clientsPageSize}`;
  if (status) query += `&status=${status}`;
  if (search) query += `&search=${encodeURIComponent(search)}`;

  try {
    const res = await fetch(query);
    if (!res.ok) throw new Error('Clients load failed');
    const result = await res.json();
    renderClientsGrid(result.data);
    renderPagination('clients-pagination', result.total, clientsPage, clientsPageSize, (newPage) => {
      clientsPage = newPage;
      loadClientsWorkspace();
    });
  } catch (err) {
    console.error(err);
  }
}

function renderClientsGrid(clients) {
  const container = document.getElementById('clients-grid-container');
  if (!container) return;

  if (clients.length === 0) {
    container.innerHTML = '<div class="empty-message" style="grid-column:1/-1;">No clients found.</div>';
    return;
  }

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'manager';

  const statusBadgeClass = { active: 'badge-done', lead: 'badge-medium', paused: 'badge-review', churned: 'badge-todo' };

  container.innerHTML = clients.map(client => {
    const retainer = client.retainer_amount ? `INR ${client.retainer_amount.toLocaleString()}` : 'N/A';
    const renewal = client.renewal_date || 'No Date';

    let renewalBadgeClass = 'badge-low';
    let renewalDays = null;
    if (client.renewal_date && client.status !== 'churned') {
      renewalDays = Math.ceil((Date.parse(client.renewal_date) - Date.now()) / (1000 * 60 * 60 * 24));
      if (renewalDays <= 7)  renewalBadgeClass = 'badge-urgent';
      else if (renewalDays <= 14) renewalBadgeClass = 'badge-high';
    }

    const editBtn = isPrivileged
      ? `<button class="btn-primary" style="font-size:10px;padding:5px 10px;" onclick="event.stopPropagation();openEditClientModal(${client.id})">Edit</button>`
      : '';

    return `
      <div class="client-card glassmorphic" onclick="openClientCRMPanel(${client.id})">
        <div class="client-c-header">
          <div>
            <h4 class="client-c-title">${escapeHTML(client.name)}</h4>
            <span class="client-c-industry">${escapeHTML(client.industry || 'General')}</span>
          </div>
          <span class="badge ${statusBadgeClass[client.status] || ''}">${client.status}</span>
        </div>
        <div class="client-c-details">
          <div class="client-detail-row"><span>Contact:</span> <span>${escapeHTML(client.contact_name || 'N/A')}</span></div>
          <div class="client-detail-row"><span>Retainer:</span> <span style="font-weight:700;">${retainer}</span></div>
          <div class="client-detail-row">
            <span>Renewal:</span>
            <span class="badge ${renewalBadgeClass}">
              ${renewal}${renewalDays !== null ? ` (${renewalDays}d)` : ''}
            </span>
          </div>
        </div>
        <div class="client-c-footer" style="justify-content:space-between;align-items:center;">
          <span style="font-size:10px;color:var(--color-blue);font-weight:600;">Click to view CRM</span>
          ${editBtn}
        </div>
      </div>
    `;
  }).join('');
}

// --- Content Workspace ---
async function loadContentWorkspace() {
  const client_id = document.getElementById('filter-content-client').value;
  const status = document.getElementById('filter-content-status').value;

  let query = `/api/content?page=${contentPage}&pageSize=${contentPageSize}`;
  if (client_id) query += `&client_id=${client_id}`;
  if (status) query += `&status=${status}`;

  try {
    const res = await fetch(query);
    if (!res.ok) throw new Error('Content loading failed');
    const result = await res.json();
    renderContentTable(result.data);
    renderPagination('content-pagination', result.total, contentPage, contentPageSize, (newPage) => {
      contentPage = newPage;
      loadContentWorkspace();
    });
  } catch (err) {
    console.error(err);
  }
}

function renderContentTable(items) {
  const tbody = document.getElementById('content-table-body');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-message">No content scheduled.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => {
    const isAssignee = item.assignee_id === currentUser.id;
    const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'manager';

    let statusSelect = `<span class="badge">${item.status}</span>`;
    if (isPrivileged || isAssignee) {
      statusSelect = `
        <select class="select-status-small" onchange="updateContentStatusAction(${item.id}, this.value)">
          <option value="idea" ${item.status === 'idea' ? 'selected' : ''}>Idea</option>
          <option value="draft" ${item.status === 'draft' ? 'selected' : ''}>Draft</option>
          <option value="in_review" ${item.status === 'in_review' ? 'selected' : ''}>In Review</option>
          <option value="approved" ${item.status === 'approved' ? 'selected' : ''}>Approved</option>
          <option value="scheduled" ${item.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
          <option value="published" ${item.status === 'published' ? 'selected' : ''}>Published</option>
        </select>
      `;
    }

    const editBtn = isPrivileged ? `<button class="btn-icon" onclick="openEditContentModal(${item.id})">✏️</button>` : '';

    return `
      <tr>
        <td>${item.scheduled_date || 'TBD'}</td>
        <td class="data-table-title">${escapeHTML(item.client_name)}</td>
        <td>
          <span class="data-table-title">${escapeHTML(item.title)}</span>
          ${item.notes ? `<div class="data-table-desc">${escapeHTML(item.notes)}</div>` : ''}
        </td>
        <td><span class="badge">${escapeHTML(item.platform || 'N/A')}</span></td>
        <td><span class="badge">${escapeHTML(item.content_type || 'N/A')}</span></td>
        <td>${escapeHTML(item.assignee_name || 'Unassigned')}</td>
        <td>${statusSelect}</td>
        <td>${editBtn}</td>
      </tr>
    `;
  }).join('');
}

async function updateContentStatusAction(id, newStatus) {
  try {
    const res = await fetch(`/api/content/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) {
      const err = await res.json();
      alert(`Update failed: ${err.error.message}`);
    }
    loadContentWorkspace();
  } catch (err) {
    console.error(err);
  }
}

// --- Team Setup Workspace (Admin only) ---
async function loadTeamWorkspace() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) return;
    const users = await res.json();
    
    const tbody = document.getElementById('team-table-body');
    if (!tbody) return;

    tbody.innerHTML = users.map(u => `
      <tr>
        <td class="data-table-title">${escapeHTML(u.name)}</td>
        <td>${escapeHTML(u.username)}</td>
        <td><span class="badge">${u.role}</span></td>
        <td>${escapeHTML(u.telegram_chat_id || 'Not Set')}</td>
        <td>${u.active ? 'Active' : 'Deactivated'}</td>
        <td><button class="btn-icon" onclick="openEditUserModal(${u.id})">✏️</button></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

// --- Life OS Workspace (Admin only) ---
async function loadLifeOSWorkspace() {
  loadLifeOSHabits();
  loadLifeOSHealth();
  loadLifeOSFinance();
  loadLifeOSLearning();
  loadLifeOSJournal();
  loadLifeOSIdeas();
  loadLifeOSEvents();
}

// 1. Life OS Habits
async function loadLifeOSHabits() {
  const container = document.getElementById('life-habits-list');
  if (!container) return;
  try {
    const res = await fetch('/api/life/habits');
    if (!res.ok) return;
    const habits = await res.json();

    if (habits.length === 0) {
      container.innerHTML = '<div class="empty-message">No habits configured.</div>';
      return;
    }

    container.innerHTML = habits.map(h => {
      const checked = h.completed_today ? 'done' : '';
      const text = h.completed_today ? 'Done' : 'Mark Complete';
      return `
        <div class="habit-row-item">
          <div>
            <span class="text-title-small">${escapeHTML(h.name)}</span>
            <div class="text-meta-small">Cadence: ${h.cadence} | Current streak: <b>${h.streak}</b></div>
          </div>
          <button class="habit-log-check ${checked}" onclick="toggleHabitLogLife(${h.id}, '${h.completed_today}')">${text}</button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

async function toggleHabitLogLife(habitId, currentlyDone) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const nextDoneState = currentlyDone !== 'true';

  try {
    const res = await fetch(`/api/life/habits/${habitId}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_date: today, done: nextDoneState })
    });
    if (res.ok) {
      loadLifeOSHabits();
    }
  } catch (err) {
    console.error(err);
  }
}

// 2. Life OS Health
async function loadLifeOSHealth() {
  const tbody = document.getElementById('health-logs-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/life/health');
    if (!res.ok) return;
    const logs = await res.json();

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-message">No logs recorded.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.slice(0, 10).map(l => {
      const time = new Date(l.logged_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return `
        <tr>
          <td>${time}</td>
          <td><span class="badge">${l.type}</span></td>
          <td><b>${escapeHTML(l.value)}</b></td>
          <td>${escapeHTML(l.note || '')}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

// 3. Life OS Finance Ledger
async function loadLifeOSFinance() {
  const monthInput = document.getElementById('finance-summary-month');
  if (!monthInput) return;

  if (!monthInput.value) {
    const today = new Date();
    const YYYY = today.getFullYear();
    const MM = String(today.getMonth() + 1).padStart(2, '0');
    monthInput.value = `${YYYY}-${MM}`;
  }

  const selectedMonth = monthInput.value;
  try {
    // Fetch summary
    const sumRes = await fetch(`/api/life/finance/summary?month=${selectedMonth}`);
    if (sumRes.ok) {
      const summary = await sumRes.json();
      document.getElementById('summary-income').textContent = `INR ${summary.income.toLocaleString()}`;
      document.getElementById('summary-expense').textContent = `INR ${summary.expense.toLocaleString()}`;
      
      const netEl = document.getElementById('summary-net');
      netEl.textContent = `INR ${summary.net.toLocaleString()}`;
      netEl.style.color = summary.net >= 0 ? 'var(--text-primary)' : '#cc0000';

      const breakdown = document.getElementById('finance-breakdown');
      if (summary.categories.length === 0) {
        breakdown.innerHTML = '<div>No expenses logged.</div>';
      } else {
        breakdown.innerHTML = summary.categories.map(c => `
          <div style="display:flex; justify-content:space-between;">
            <span>${escapeHTML(c.category || 'other')}:</span>
            <span>INR ${c.total.toLocaleString()}</span>
          </div>
        `).join('');
      }
    }

    // Fetch ledger list
    const start = `${selectedMonth}-01`;
    const end = `${selectedMonth}-31`;
    const listRes = await fetch(`/api/life/finance?from=${start}&to=${end}`);
    if (listRes.ok) {
      const items = await listRes.json();
      const tbody = document.getElementById('finance-ledger-body');
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-message">No history.</td></tr>';
        return;
      }
      tbody.innerHTML = items.slice(0, 10).map(item => `
        <tr>
          <td>${item.entry_date}</td>
          <td>${item.kind}</td>
          <td>${escapeHTML(item.category || '')}</td>
          <td>INR ${item.amount.toLocaleString()}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

// 4. Life OS Learning
async function loadLifeOSLearning() {
  const tbody = document.getElementById('learning-tracker-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/life/learning');
    if (!res.ok) return;
    const items = await res.json();

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Track details empty.</td></tr>';
      return;
    }

    tbody.innerHTML = items.map(item => {
      const selectStatus = `
        <select style="padding: 2px; font-size:11px;" onchange="updateLearningItemAction(${item.id}, this.value)">
          <option value="to_learn" ${item.status === 'to_learn' ? 'selected' : ''}>To Learn</option>
          <option value="in_progress" ${item.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="done" ${item.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
      `;

      return `
        <tr>
          <td>
            <div class="data-table-title">${escapeHTML(item.title)}</div>
            ${item.notes ? `<div class="data-table-desc">${escapeHTML(item.notes)}</div>` : ''}
          </td>
          <td>${escapeHTML(item.source || 'N/A')}</td>
          <td><b>${item.hours} hrs</b></td>
          <td>${selectStatus}</td>
          <td>
            <button class="btn-primary" style="padding: 2px 6px; font-size: 11px;" onclick="addLearningHours(${item.id}, ${item.hours})">+1hr</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

async function updateLearningItemAction(id, status) {
  try {
    await fetch(`/api/life/learning/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    loadLifeOSLearning();
  } catch (err) {
    console.error(err);
  }
}

async function addLearningHours(id, currentHours) {
  try {
    await fetch(`/api/life/learning/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours: currentHours + 1 })
    });
    loadLifeOSLearning();
  } catch (err) {
    console.error(err);
  }
}

// 5. Life OS Journal
async function loadLifeOSJournal() {
  const container = document.getElementById('journal-entries-list');
  if (!container) return;

  try {
    const res = await fetch('/api/life/journal');
    if (!res.ok) return;
    const entries = await res.json();

    if (entries.length === 0) {
      container.innerHTML = '<div class="empty-message">No journal entries saved.</div>';
      return;
    }

    container.innerHTML = entries.slice(0, 5).map(e => `
      <div style="border:1px solid var(--border-color); padding:10px; background-color: var(--bg-surface);">
        <div class="flex-between" style="font-size:11px; margin-bottom: 4px; color: var(--text-muted);">
          <span>Date: <b>${e.entry_date}</b></span>
          <span>Mood: ${escapeHTML(e.mood || 'neutral')}</span>
        </div>
        <div style="font-size:13px; line-height:1.4;">${escapeHTML(e.body)}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

// 6. Life OS Ideas
async function loadLifeOSIdeas() {
  const container = document.getElementById('content-ideas-list');
  if (!container) return;

  try {
    const res = await fetch('/api/life/content-ideas');
    if (!res.ok) return;
    const ideas = await res.json();

    if (ideas.length === 0) {
      container.innerHTML = '<div class="empty-message">No ideas logged.</div>';
      return;
    }

    container.innerHTML = ideas.map(idea => {
      const scheduleLabel = idea.scheduled_date ? `Due: ${idea.scheduled_date}` : 'No date';
      const selectStatus = `
        <select style="padding:2px; font-size:10px;" onchange="updateIdeaStatusAction(${idea.id}, this.value)">
          <option value="idea" ${idea.status === 'idea' ? 'selected' : ''}>Idea</option>
          <option value="drafting" ${idea.status === 'drafting' ? 'selected' : ''}>Drafting</option>
          <option value="scheduled" ${idea.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
          <option value="posted" ${idea.status === 'posted' ? 'selected' : ''}>Posted</option>
        </select>
      `;

      return `
        <div class="approval-item">
          <div class="flex-between">
            <span class="text-title-small">${escapeHTML(idea.idea)}</span>
            ${selectStatus}
          </div>
          <div class="flex-between text-meta-small">
            <span>Hook: ${escapeHTML(idea.hook || 'None')}</span>
            <span>Platform: ${escapeHTML(idea.platform || 'N/A')} | ${scheduleLabel}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

async function updateIdeaStatusAction(id, status) {
  try {
    await fetch(`/api/life/content-ideas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    loadLifeOSIdeas();
  } catch (err) {
    console.error(err);
  }
}

// 7. Life OS Events
async function loadLifeOSEvents() {
  const tbody = document.getElementById('calendar-events-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/life/events');
    if (!res.ok) return;
    const events = await res.json();

    if (events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-message">No upcoming events.</td></tr>';
      return;
    }

    tbody.innerHTML = events.slice(0, 10).map(e => {
      const timeStr = e.all_day ? 'All day' : new Date(e.start_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <tr>
          <td>${timeStr}</td>
          <td>
            <span class="data-table-title">${escapeHTML(e.title)}</span>
            ${e.note ? `<div class="data-table-desc">${escapeHTML(e.note)}</div>` : ''}
          </td>
          <td><span class="badge">${escapeHTML(e.type || 'general')}</span></td>
          <td>
            <button class="btn-icon delete" onclick="deleteCalendarEventAction(${e.id})">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

async function deleteCalendarEventAction(id) {
  if (!confirm('Delete this event?')) return;
  try {
    await fetch(`/api/life/events/${id}`, { method: 'DELETE' });
    loadLifeOSEvents();
  } catch (err) {
    console.error(err);
  }
}

// --- Client CRM Panel ---
async function openClientCRMPanel(clientId) {
  try {
    const [clientRes, tasksRes, projectsRes] = await Promise.all([
      fetch(`/api/clients/${clientId}`),
      fetch(`/api/tasks?client_id=${clientId}&pageSize=50`),
      fetch(`/api/projects?client_id=${clientId}&pageSize=20`)
    ]);

    if (!clientRes.ok) return;
    const client = await clientRes.json();
    const tasks = tasksRes.ok ? (await tasksRes.json()).data : [];
    const projects = projectsRes.ok ? (await projectsRes.json()).data : [];

    // Header
    document.getElementById('crm-client-name').textContent = client.name;
    const statusColors = { active: 'badge-done', lead: 'badge-medium', paused: 'badge-review', churned: 'badge-todo' };
    document.getElementById('crm-client-meta').innerHTML = `
      <span class="badge ${statusColors[client.status] || ''}">${client.status}</span>
      ${client.industry ? `<span class="badge">${escapeHTML(client.industry)}</span>` : ''}
      ${client.retainer_amount ? `<span class="badge badge-medium">INR ${client.retainer_amount.toLocaleString()} / mo</span>` : ''}
    `;

    // Contact bar
    document.getElementById('crm-contact-bar').innerHTML = [
      { label: 'Contact', val: client.contact_name || 'N/A' },
      { label: 'Email',   val: client.contact_email || 'N/A' },
      { label: 'Phone',   val: client.contact_phone || 'N/A' },
      { label: 'Renewal', val: client.renewal_date || 'N/A' },
      { label: 'Notes',   val: client.notes ? client.notes.substring(0, 60) + (client.notes.length > 60 ? '…' : '') : 'None' }
    ].map(i => `
      <div class="crm-contact-item">
        <span class="crm-contact-label">${i.label}</span>
        <span class="crm-contact-val">${escapeHTML(String(i.val))}</span>
      </div>`).join('');

    // Metrics
    const today = new Date(); today.setHours(0,0,0,0);
    const openTasks      = tasks.filter(t => t.status !== 'done').length;
    const overdueTasks   = tasks.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date) < today).length;
    const needsApproval  = tasks.filter(t => t.status === 'in_review').length;
    const doneTasks      = tasks.filter(t => t.status === 'done').length;
    const renewalDays    = client.renewal_date
      ? Math.ceil((Date.parse(client.renewal_date) - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    document.getElementById('crm-metrics').innerHTML = `
      <div class="crm-metric-card">
        <div class="crm-metric-val" style="color:${openTasks > 0 ? 'var(--color-blue)' : 'var(--color-green)'};">${openTasks}</div>
        <div class="crm-metric-label">Open Tasks</div>
      </div>
      <div class="crm-metric-card">
        <div class="crm-metric-val" style="color:${overdueTasks > 0 ? 'var(--color-red)' : 'var(--color-green)'};">${overdueTasks}</div>
        <div class="crm-metric-label">Overdue</div>
      </div>
      <div class="crm-metric-card">
        <div class="crm-metric-val" style="color:${needsApproval > 0 ? 'var(--color-yellow)' : 'var(--color-green)'};">${needsApproval}</div>
        <div class="crm-metric-label">In Review</div>
      </div>
      <div class="crm-metric-card">
        <div class="crm-metric-val" style="color:${renewalDays !== null && renewalDays <= 14 ? 'var(--color-red)' : 'var(--color-blue)'};">
          ${renewalDays !== null ? renewalDays + 'd' : 'N/A'}
        </div>
        <div class="crm-metric-label">Renewal In</div>
      </div>
    `;

    // Pending task list
    const pending = tasks.filter(t => t.status !== 'done')
      .sort((a, b) => {
        const po = { urgent: 0, high: 1, medium: 2, low: 3 };
        return (po[a.priority] ?? 4) - (po[b.priority] ?? 4);
      });

    const tasksList = document.getElementById('crm-tasks-list');
    if (pending.length === 0) {
      tasksList.innerHTML = '<div class="empty-message" style="color:var(--color-green);border-color:var(--color-green);">All tasks done!</div>';
    } else {
      tasksList.innerHTML = pending.map(t => {
        const isOverdue = t.due_date && new Date(t.due_date) < today;
        const statusKey = t.status.replace('_', '');
        return `
          <div class="crm-task-item">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
              <span class="crm-task-title">${escapeHTML(t.title)}</span>
              <div class="crm-task-badges">
                <span class="badge badge-${t.priority}">${t.priority}</span>
                <span class="badge badge-${statusKey}">${t.status.replace('_',' ')}</span>
              </div>
            </div>
            <div class="crm-task-meta">
              <span>Assignee: <b>${escapeHTML(t.assignee_name || 'Unassigned')}</b></span>
              <span style="color:${isOverdue ? 'var(--color-red)' : 'inherit'};font-weight:${isOverdue ? '700' : '400'};">
                ${t.due_date ? (isOverdue ? 'OVERDUE: ' : 'Due: ') + t.due_date : 'No due date'}
              </span>
            </div>
          </div>`;
      }).join('');
    }

    // Task status mini chart
    const counts = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
    tasks.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });
    renderStatusChart('crm-task-chart', counts);

    // Projects
    const projectsList = document.getElementById('crm-projects-list');
    if (projects.length === 0) {
      projectsList.innerHTML = '<div class="empty-message">No projects yet.</div>';
    } else {
      const projStatusClass = { active: 'badge-done', paused: 'badge-review', completed: 'badge-todo' };
      projectsList.innerHTML = projects.map(p => `
        <div class="crm-project-item">
          <div>
            <div style="font-size:13px;font-weight:600;">${escapeHTML(p.name)}</div>
            <div style="font-size:10px;color:var(--text-muted);">${p.type}${p.renewal_date ? ' · Renews ' + p.renewal_date : ''}</div>
          </div>
          <span class="badge ${projStatusClass[p.status] || ''}">${p.status}</span>
        </div>`).join('');
    }

    // Edit button wires up to existing modal
    const editBtn = document.getElementById('crm-edit-btn');
    if (editBtn && (currentUser.role === 'admin' || currentUser.role === 'manager')) {
      editBtn.classList.remove('hidden');
      editBtn.onclick = () => { closeModal('modal-crm'); openEditClientModal(clientId); };
    } else if (editBtn) {
      editBtn.classList.add('hidden');
    }

    openModal('modal-crm');
  } catch (err) {
    console.error('CRM panel error:', err);
  }
}

// --- Pagination helper ---
function renderPagination(elementId, totalItems, currentPage, pageSize, onPageChange) {
  const container = document.getElementById(elementId);
  if (!container) return;

  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  container.innerHTML = `
    <span class="pagination-text">Showing ${startItem}–${endItem} of ${totalItems} entries</span>
    <div class="pagination-buttons">
      <button class="btn-pagination" id="${elementId}-prev" ${currentPage === 1 ? 'disabled' : ''}>Prev</button>
      <button class="btn-pagination" id="${elementId}-next" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
    </div>
  `;

  document.getElementById(`${elementId}-prev`).onclick = () => onPageChange(currentPage - 1);
  document.getElementById(`${elementId}-next`).onclick = () => onPageChange(currentPage + 1);
}

// --- Modals Setup & Dynamic Open ---
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

// Projects triggers
document.getElementById('btn-create-project').onclick = () => {
  document.getElementById('project-modal-title').textContent = 'Create Project';
  document.getElementById('project-form-id').value = '';
  document.getElementById('project-form').reset();
  document.getElementById('project-form-error').classList.add('hidden');
  openModal('modal-project');
};

async function openEditProjectModal(id) {
  try {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) return;
    const p = await res.json();
    document.getElementById('project-modal-title').textContent = 'Edit Project';
    document.getElementById('project-form-id').value = p.id;
    document.getElementById('project-name').value = p.name;
    document.getElementById('project-client').value = p.client_id;
    document.getElementById('project-type').value = p.type || 'retainer';
    document.getElementById('project-status').value = p.status || 'active';
    document.getElementById('project-start-date').value = p.start_date || '';
    document.getElementById('project-renewal').value = p.renewal_date || '';
    document.getElementById('project-notes').value = p.notes || '';
    
    document.getElementById('project-form-error').classList.add('hidden');
    openModal('modal-project');
  } catch (err) {
    console.error(err);
  }
}

// Content schedules triggers
document.getElementById('btn-create-content').onclick = () => {
  document.getElementById('content-modal-title').textContent = 'Schedule Post';
  document.getElementById('content-form-id').value = '';
  document.getElementById('content-form').reset();
  document.getElementById('content-form-error').classList.add('hidden');
  openModal('modal-content-item');
};

async function openEditContentModal(id) {
  try {
    const res = await fetch(`/api/content/${id}`);
    if (!res.ok) return;
    const item = await res.json();
    document.getElementById('content-modal-title').textContent = 'Edit Post';
    document.getElementById('content-form-id').value = item.id;
    document.getElementById('content-title').value = item.title;
    document.getElementById('content-client').value = item.client_id;
    document.getElementById('content-assignee').value = item.assignee_id || '';
    document.getElementById('content-platform').value = item.platform || '';
    document.getElementById('content-type-field').value = item.content_type || '';
    document.getElementById('content-status').value = item.status || 'idea';
    document.getElementById('content-scheduled-date').value = item.scheduled_date || '';
    document.getElementById('content-notes').value = item.notes || '';
    
    document.getElementById('content-form-error').classList.add('hidden');
    openModal('modal-content-item');
  } catch (err) {
    console.error(err);
  }
}

// Life OS Triggers
document.getElementById('btn-create-habit').onclick = () => {
  document.getElementById('habit-form').reset();
  document.getElementById('habit-form-error').classList.add('hidden');
  openModal('modal-habit');
};

document.getElementById('btn-create-finance').onclick = () => {
  document.getElementById('finance-form').reset();
  document.getElementById('fin-date').value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  document.getElementById('finance-form-error').classList.add('hidden');
  openModal('modal-finance');
};

document.getElementById('btn-create-learning').onclick = () => {
  document.getElementById('learning-modal-title').textContent = 'Log Course';
  document.getElementById('learning-form-id').value = '';
  document.getElementById('learning-form').reset();
  document.getElementById('learning-form-error').classList.add('hidden');
  openModal('modal-learning');
};

document.getElementById('btn-create-idea').onclick = () => {
  document.getElementById('idea-modal-title').textContent = 'Log Content Idea';
  document.getElementById('idea-form-id').value = '';
  document.getElementById('idea-form').reset();
  document.getElementById('idea-form-error').classList.add('hidden');
  openModal('modal-idea');
};

document.getElementById('btn-create-event').onclick = () => {
  document.getElementById('event-modal-title').textContent = 'Create Calendar Event';
  document.getElementById('event-form-id').value = '';
  document.getElementById('event-form').reset();
  document.getElementById('event-form-error').classList.add('hidden');
  openModal('modal-event');
};

// Base triggers
document.getElementById('btn-create-task').onclick = () => {
  document.getElementById('task-modal-title').textContent = 'Create Task';
  document.getElementById('task-form-id').value = '';
  document.getElementById('task-form').reset();
  document.getElementById('task-form-error').classList.add('hidden');
  openModal('modal-task');
};

async function openEditTaskModal(id) {
  if (currentUser.role !== 'admin' && currentUser.role !== 'manager') return;
  try {
    const res = await fetch(`/api/tasks/${id}`);
    if (!res.ok) return;
    const t = await res.json();
    document.getElementById('task-modal-title').textContent = 'Edit Task';
    document.getElementById('task-form-id').value = t.id;
    document.getElementById('task-title').value = t.title;
    document.getElementById('task-description').value = t.description || '';
    document.getElementById('task-client').value = t.client_id || '';
    document.getElementById('task-project').value = t.project_id || '';
    document.getElementById('task-assignee').value = t.assignee_id || '';
    document.getElementById('task-priority').value = t.priority;
    document.getElementById('task-due-date').value = t.due_date || '';
    document.getElementById('task-needs-approval').checked = !!t.needs_approval;
    document.getElementById('task-recurrence').value = t.recurrence || '';
    document.getElementById('task-recurrence-interval').value = t.recurrence_interval || 1;
    document.getElementById('task-recurrence-until').value = t.recurrence_until || '';
    
    document.getElementById('task-form-error').classList.add('hidden');
    openModal('modal-task');
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('btn-create-client').onclick = () => {
  document.getElementById('client-modal-title').textContent = 'Create Client';
  document.getElementById('client-form-id').value = '';
  document.getElementById('client-form').reset();
  document.getElementById('client-form-error').classList.add('hidden');
  openModal('modal-client');
};

async function openEditClientModal(id) {
  try {
    const res = await fetch(`/api/clients/${id}`);
    if (!res.ok) return;
    const c = await res.json();
    document.getElementById('client-modal-title').textContent = 'Edit Client';
    document.getElementById('client-form-id').value = c.id;
    document.getElementById('client-name').value = c.name;
    document.getElementById('client-industry').value = c.industry || '';
    document.getElementById('client-status').value = c.status;
    document.getElementById('client-contact-name').value = c.contact_name || '';
    document.getElementById('client-contact-email').value = c.contact_email || '';
    document.getElementById('client-contact-phone').value = c.contact_phone || '';
    document.getElementById('client-retainer').value = c.retainer_amount || '';
    document.getElementById('client-renewal').value = c.renewal_date || '';
    document.getElementById('client-notes').value = c.notes || '';
    
    document.getElementById('client-form-error').classList.add('hidden');
    openModal('modal-client');
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('btn-create-user').onclick = () => {
  document.getElementById('user-modal-title').textContent = 'Create User Account';
  document.getElementById('user-form-id').value = '';
  document.getElementById('user-form').reset();
  document.getElementById('lbl-user-password').textContent = 'Password *';
  document.getElementById('user-password').required = true;
  document.getElementById('hint-password-reset').classList.add('hidden');
  document.getElementById('user-active-container').classList.add('hidden');
  document.getElementById('user-form-error').classList.add('hidden');
  openModal('modal-user');
};

async function openEditUserModal(id) {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) return;
    const u = await res.json();
    document.getElementById('user-modal-title').textContent = 'Edit User Account';
    document.getElementById('user-form-id').value = u.id;
    document.getElementById('user-name').value = u.name;
    document.getElementById('user-username').value = u.username;
    document.getElementById('user-role').value = u.role;
    document.getElementById('user-telegram').value = u.telegram_chat_id || '';
    document.getElementById('lbl-user-password').textContent = 'Password';
    document.getElementById('user-password').required = false;
    document.getElementById('user-password').value = '';
    document.getElementById('hint-password-reset').classList.remove('hidden');
    document.getElementById('user-active-container').classList.remove('hidden');
    document.getElementById('user-active').checked = !!u.active;
    document.getElementById('user-form-error').classList.add('hidden');
    openModal('modal-user');
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('user-profile-badge').onclick = () => {
  document.getElementById('password-form').reset();
  document.getElementById('password-form-error').classList.add('hidden');
  openModal('modal-password');
};

// --- Setup Event Listeners ---
function setupEventListeners() {
  // Login Submit
  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;
    const errorContainer = document.getElementById('login-error');
    errorContainer.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        setupUIForRole();
        window.location.hash = '#dashboard';
      } else {
        const err = await res.json();
        errorContainer.textContent = err.error?.message || 'Login failed.';
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      errorContainer.textContent = 'Connection failed.';
      errorContainer.classList.remove('hidden');
    }
  };

  // Logout Trigger
  document.getElementById('btn-logout').onclick = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (err) {}
    currentUser = null;
    window.location.hash = '';
    showLoginView();
  };

  // Close modals bindings
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const modal = btn.closest('.modal');
      if (modal) modal.classList.add('hidden');
    };
  });

  // Task Form Submit
  document.getElementById('task-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('task-form-id').value;
    const payload = {
      title: e.target.title.value,
      description: e.target.description.value,
      client_id: e.target.client_id.value ? parseInt(e.target.client_id.value, 10) : null,
      project_id: e.target.project_id.value ? parseInt(e.target.project_id.value, 10) : null,
      assignee_id: e.target.assignee_id.value ? parseInt(e.target.assignee_id.value, 10) : null,
      priority: e.target.priority.value,
      due_date: e.target.due_date.value || null,
      needs_approval: e.target.needs_approval.checked ? 1 : 0,
      recurrence: e.target.recurrence.value || null,
      recurrence_interval: e.target.recurrence_interval.value ? parseInt(e.target.recurrence_interval.value, 10) : 1,
      recurrence_until: e.target.recurrence_until.value || null
    };

    const errorContainer = document.getElementById('task-form-error');
    errorContainer.classList.add('hidden');

    const method = id ? 'PATCH' : 'POST';
    const url = id ? `/api/tasks/${id}` : '/api/tasks';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-task');
        if (activeScreen === 'dashboard') loadDashboard();
        else loadTasksWorkspace();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Project Form Submit
  document.getElementById('project-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('project-form-id').value;
    const payload = {
      name: e.target.name.value,
      client_id: parseInt(e.target.client_id.value, 10),
      type: e.target.type.value,
      status: e.target.status.value,
      start_date: e.target.start_date.value || null,
      renewal_date: e.target.renewal_date.value || null,
      notes: e.target.notes.value
    };

    const errorContainer = document.getElementById('project-form-error');
    errorContainer.classList.add('hidden');

    const method = id ? 'PATCH' : 'POST';
    const url = id ? `/api/projects/${id}` : '/api/projects';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-project');
        loadReferenceLists(); // updates cache options
        loadProjectsWorkspace();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Client Form Submit
  document.getElementById('client-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('client-form-id').value;
    const payload = {
      name: e.target.name.value,
      industry: e.target.industry.value,
      status: e.target.status.value,
      contact_name: e.target.contact_name.value,
      contact_email: e.target.contact_email.value || null,
      contact_phone: e.target.contact_phone.value || null,
      retainer_amount: e.target.retainer_amount.value ? parseFloat(e.target.retainer_amount.value) : null,
      renewal_date: e.target.renewal_date.value || null,
      notes: e.target.notes.value
    };

    const errorContainer = document.getElementById('client-form-error');
    errorContainer.classList.add('hidden');

    const method = id ? 'PATCH' : 'POST';
    const url = id ? `/api/clients/${id}` : '/api/clients';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-client');
        loadReferenceLists();
        loadClientsWorkspace();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Content Form Submit
  document.getElementById('content-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('content-form-id').value;
    const payload = {
      title: e.target.title.value,
      client_id: parseInt(e.target.client_id.value, 10),
      assignee_id: e.target.assignee_id.value ? parseInt(e.target.assignee_id.value, 10) : null,
      platform: e.target.platform.value || null,
      content_type: e.target.content_type.value || null,
      status: e.target.status.value,
      scheduled_date: e.target.scheduled_date.value || null,
      notes: e.target.notes.value
    };

    const errorContainer = document.getElementById('content-form-error');
    errorContainer.classList.add('hidden');

    const method = id ? 'PATCH' : 'POST';
    const url = id ? `/api/content/${id}` : '/api/content';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-content-item');
        loadContentWorkspace();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // User Form Submit
  document.getElementById('user-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('user-form-id').value;
    const payload = {
      name: e.target.name.value,
      username: e.target.username.value,
      role: e.target.role.value,
      telegram_chat_id: e.target.telegram_chat_id.value || null
    };

    if (e.target.password.value) payload.password = e.target.password.value;
    if (id) payload.active = document.getElementById('user-active').checked;

    const errorContainer = document.getElementById('user-form-error');
    errorContainer.classList.add('hidden');

    const method = id ? 'PATCH' : 'POST';
    const url = id ? `/api/users/${id}` : '/api/users';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-user');
        loadTeamWorkspace();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Password Update Submit
  document.getElementById('password-form').onsubmit = async (e) => {
    e.preventDefault();
    const currentPassword = e.target.currentPassword.value;
    const newPassword = e.target.newPassword.value;
    const errorContainer = document.getElementById('password-form-error');
    errorContainer.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (res.ok) {
        alert('Password updated!');
        closeModal('modal-password');
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --- Life OS Forms Actions ---
  
  // Habit creation
  document.getElementById('habit-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: e.target.name.value,
      cadence: e.target.cadence.value,
      target_per_period: parseInt(e.target.target_per_period.value, 10)
    };
    const errorContainer = document.getElementById('habit-form-error');
    errorContainer.classList.add('hidden');

    try {
      const res = await fetch('/api/life/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-habit');
        loadLifeOSHabits();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Health Logging
  document.getElementById('life-health-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      type: document.getElementById('health-type').value,
      value: document.getElementById('health-value').value,
      note: document.getElementById('health-note').value
    };

    try {
      const res = await fetch('/api/life/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        document.getElementById('life-health-form').reset();
        loadLifeOSHealth();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Finance filter dropdown
  document.getElementById('finance-summary-month').onchange = () => {
    loadLifeOSFinance();
  };

  // Finance modal log transaction
  document.getElementById('finance-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      kind: e.target.kind.value,
      entry_date: e.target.entry_date.value,
      amount: parseFloat(e.target.amount.value),
      category: e.target.category.value || null,
      note: e.target.note.value || null
    };
    const errorContainer = document.getElementById('finance-form-error');
    errorContainer.classList.add('hidden');

    try {
      const res = await fetch('/api/life/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-finance');
        loadLifeOSFinance();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Learning Course submit
  document.getElementById('learning-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      title: e.target.title.value,
      source: e.target.source.value || null,
      status: e.target.status.value,
      hours: parseFloat(e.target.hours.value || 0),
      notes: e.target.notes.value || null
    };
    const errorContainer = document.getElementById('learning-form-error');
    errorContainer.classList.add('hidden');

    try {
      const res = await fetch('/api/life/learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-learning');
        loadLifeOSLearning();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Journal log entry submit
  document.getElementById('life-journal-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      entry_date: document.getElementById('journal-date').value,
      mood: document.getElementById('journal-mood').value || null,
      body: document.getElementById('journal-body').value
    };

    try {
      const res = await fetch('/api/life/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        document.getElementById('life-journal-form').reset();
        document.getElementById('journal-date').value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        loadLifeOSJournal();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Content Idea submit
  document.getElementById('idea-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      idea: e.target.idea.value,
      hook: e.target.hook.value || null,
      platform: e.target.platform.value || null,
      status: e.target.status.value,
      scheduled_date: e.target.scheduled_date.value || null
    };
    const errorContainer = document.getElementById('idea-form-error');
    errorContainer.classList.add('hidden');

    try {
      const res = await fetch('/api/life/content-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-idea');
        loadLifeOSIdeas();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Calendar Event submit
  document.getElementById('event-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      title: e.target.title.value,
      start_at: e.target.start_at.value,
      end_at: e.target.end_at.value || null,
      all_day: e.target.all_day.checked ? 1 : 0,
      type: e.target.type.value || null,
      note: e.target.note.value || null
    };
    const errorContainer = document.getElementById('event-form-error');
    errorContainer.classList.add('hidden');

    try {
      const res = await fetch('/api/life/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        closeModal('modal-event');
        loadLifeOSEvents();
      } else {
        const err = await res.json();
        errorContainer.textContent = formatErrorDetails(err.error);
        errorContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Filter triggers
  document.getElementById('filter-task-status').onchange = () => { tasksPage = 1; loadTasksWorkspace(); };
  document.getElementById('filter-task-priority').onchange = () => { tasksPage = 1; loadTasksWorkspace(); };
  document.getElementById('filter-task-client').onchange = () => { tasksPage = 1; loadTasksWorkspace(); };
  const filterAssignee = document.getElementById('filter-task-assignee');
  if (filterAssignee) {
    filterAssignee.onchange = () => { tasksPage = 1; loadTasksWorkspace(); };
  }

  document.getElementById('filter-project-client').onchange = () => { projectsPage = 1; loadProjectsWorkspace(); };
  document.getElementById('filter-project-status').onchange = () => { projectsPage = 1; loadProjectsWorkspace(); };

  let searchDebounce;
  document.getElementById('filter-client-search').oninput = () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      clientsPage = 1;
      loadClientsWorkspace();
    }, 450);
  };
  document.getElementById('filter-client-status').onchange = () => { clientsPage = 1; loadClientsWorkspace(); };

  document.getElementById('filter-content-client').onchange = () => { contentPage = 1; loadContentWorkspace(); };
  document.getElementById('filter-content-status').onchange = () => { contentPage = 1; loadContentWorkspace(); };
}

// --- Analytics Chart Renderers ---
const STATUS_COLORS = {
  todo:        { fill: '#9ca3af', bg: '#f3f4f6', label: 'To Do' },
  in_progress: { fill: '#3b82f6', bg: '#eff6ff', label: 'In Progress' },
  in_review:   { fill: '#f59e0b', bg: '#fffbeb', label: 'In Review' },
  done:        { fill: '#22c55e', bg: '#f0fdf4', label: 'Done' }
};

const PRIORITY_COLORS = {
  urgent: { fill: '#ef4444', label: 'Urgent' },
  high:   { fill: '#f97316', label: 'High' },
  medium: { fill: '#3b82f6', label: 'Medium' },
  low:    { fill: '#22c55e', label: 'Low' }
};

function renderStatusChart(elementId, counts) {
  const container = document.getElementById(elementId);
  if (!container) return;

  const data = Object.entries(STATUS_COLORS).map(([key, meta]) => ({
    label: meta.label,
    value: counts[key] || 0,
    fill: meta.fill
  }));
  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    container.innerHTML = '<div class="empty-message">No tasks to display.</div>';
    return;
  }

  const segments = data
    .filter(d => d.value > 0)
    .map(d => {
      const pct = (d.value / total * 100).toFixed(2);
      return `<div class="chart-stacked-segment" style="width:${pct}%;background:${d.fill};" title="${d.label}: ${d.value}"></div>`;
    }).join('');

  const legend = data.map(d => `
    <div class="chart-legend-item">
      <div class="chart-legend-dot" style="background:${d.fill};border-color:${d.fill};"></div>
      <span>${d.label}: <b>${d.value}</b></span>
    </div>`).join('');

  const completionPct = total > 0 ? ((counts.done || 0) / total * 100).toFixed(0) : 0;

  container.innerHTML = `
    <div class="chart-stacked-bar">${segments}</div>
    <div class="chart-legend">${legend}</div>
    <div class="chart-completion-row">
      <span class="text-meta-small">Total: <b>${total}</b></span>
      <span class="text-meta-small" style="color:${Number(completionPct) >= 50 ? '#22c55e' : '#f59e0b'};font-weight:700;">
        ${completionPct}% complete
      </span>
    </div>`;
}

function renderPriorityChart(elementId, tasks) {
  const container = document.getElementById(elementId);
  if (!container) return;

  const counts = { urgent: 0, high: 0, medium: 0, low: 0 };
  (tasks || []).forEach(t => {
    if (counts[t.priority] !== undefined) counts[t.priority]++;
  });

  const data = Object.entries(PRIORITY_COLORS).map(([key, meta]) => ({
    label: meta.label,
    value: counts[key],
    fill: meta.fill
  }));
  const max = Math.max(...data.map(d => d.value), 1);

  const bars = data.map(d => `
    <div class="chart-bar-row">
      <div class="chart-bar-label">${d.label}</div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width:${(d.value / max * 100).toFixed(1)}%;background:${d.fill};"></div>
      </div>
      <div class="chart-bar-value" style="color:${d.fill};">${d.value}</div>
    </div>`).join('');

  container.innerHTML = `<div class="chart-bar-container">${bars}</div>`;
}

// --- Common UI Helpers ---
function showLoading(show) {
  const loading = document.getElementById('loading-view');
  if (show) loading.classList.remove('hidden');
  else loading.classList.add('hidden');
}

function showLoginView() {
  document.getElementById('sidebar').classList.add('hidden');
  document.getElementById('content-view').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('login-form').reset();
  document.getElementById('login-error').classList.add('hidden');
  currentUser = null;
}

async function updateTaskStatusAction(id, newStatus) {
  try {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) {
      const err = await res.json();
      alert(`Status update failed: ${err.error.message}`);
    }
    loadTasksWorkspace();
  } catch (err) {
    console.error(err);
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatErrorDetails(err) {
  if (!err) return 'An error occurred.';
  if (err.code === 'VALIDATION_ERROR' && err.details) {
    return Object.entries(err.details)
      .map(([field, msg]) => `${field}: ${msg}`)
      .join('\n');
  }
  return err.message || 'An error occurred.';
}

// ============================================================
// CALENDAR
// ============================================================
async function loadCalendarWorkspace() {
  const now = new Date();
  if (calYear === null) calYear = now.getFullYear();
  if (calMonth === null) calMonth = now.getMonth();

  // Month label
  document.getElementById('cal-month-label').textContent =
    new Date(calYear, calMonth, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  // Fetch all tasks for a window around this month
  const from = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-01`;
  const toDate = new Date(calYear, calMonth + 1, 0);
  const to = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(toDate.getDate()).padStart(2,'0')}`;

  try {
    const res = await fetch(`/api/tasks?pageSize=200&due_after=${from}&due_before=${to}`);
    calAllTasks = res.ok ? (await res.json()).data || [] : [];
  } catch (_) { calAllTasks = []; }

  renderCalendarGrid();
}

function renderCalendarGrid() {
  const grid = document.getElementById('cal-days-grid');
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Group tasks by date
  const byDate = {};
  calAllTasks.forEach(t => {
    const d = t.due_date ? t.due_date.split('T')[0] : null;
    if (d) { if (!byDate[d]) byDate[d] = []; byDate[d].push(t); }
  });

  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayObj = new Date(); todayObj.setHours(0,0,0,0);

  let cells = '';

  // Leading blanks
  for (let i = 0; i < firstDow; i++) cells += `<div class="cal-day-cell other-month"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const ds = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = ds === todayStr;
    const isSel   = ds === calSelectedDay;
    const tasks   = byDate[ds] || [];
    const open    = tasks.filter(t => t.status !== 'done');
    const done    = tasks.filter(t => t.status === 'done');
    const overdue = open.filter(t => new Date(ds) < todayObj);

    let pills = '';
    if (overdue.length) pills += `<span class="cal-task-pill" style="color:var(--color-red);border-color:var(--color-red);background:var(--color-red-bg);">${overdue.length} overdue</span><br>`;
    const remaining = open.length - overdue.length;
    if (remaining > 0) pills += `<span class="cal-task-pill" style="color:var(--color-blue);border-color:var(--color-blue);background:var(--color-blue-bg);">${remaining} pending</span><br>`;
    if (done.length)   pills += `<span class="cal-task-pill" style="color:var(--color-green);border-color:var(--color-green);background:var(--color-green-bg);">${done.length} done</span>`;

    cells += `
      <div class="cal-day-cell ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''} ${open.length + done.length === 0 ? '' : ''}"
           onclick="${tasks.length > 0 || true ? `selectCalDay('${ds}')` : ''}">
        <div class="cal-day-num">${day}</div>
        ${pills}
      </div>`;
  }

  // Trailing blanks
  const trail = (7 - ((firstDow + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trail; i++) cells += `<div class="cal-day-cell other-month"></div>`;

  grid.innerHTML = cells;

  if (calSelectedDay) showCalDayPanel(calSelectedDay);
}

function selectCalDay(ds) {
  calSelectedDay = calSelectedDay === ds ? null : ds;
  renderCalendarGrid();
  if (!calSelectedDay) document.getElementById('cal-day-panel').classList.add('hidden');
}

function showCalDayPanel(ds) {
  const panel = document.getElementById('cal-day-panel');
  panel.classList.remove('hidden');

  const label = new Date(ds + 'T00:00:00').toLocaleDateString('en-IN',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const tasks = calAllTasks.filter(t => t.due_date && t.due_date.split('T')[0] === ds);
  const todayObj = new Date(); todayObj.setHours(0,0,0,0);

  document.getElementById('cal-day-title').innerHTML = `
    <div class="cal-day-panel-header">
      <h3 style="font-size:16px;font-weight:700;">${label}</h3>
      <span class="badge badge-medium">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
    </div>`;

  if (tasks.length === 0) {
    document.getElementById('cal-day-tasks').innerHTML =
      '<div class="empty-message">No tasks due on this date.</div>';
    return;
  }

  const sorted = [...tasks].sort((a,b) => {
    const po = { urgent:0, high:1, medium:2, low:3 };
    return (po[a.priority]??4) - (po[b.priority]??4);
  });

  document.getElementById('cal-day-tasks').innerHTML = sorted.map(t => {
    const isOverdue = t.status !== 'done' && new Date(ds) < todayObj;
    const sk = t.status.replace('_','');
    return `
      <div class="crm-task-item">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <span style="font-size:13px;font-weight:600;flex:1;">${escapeHTML(t.title)}</span>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <span class="badge badge-${t.priority}">${t.priority}</span>
            <span class="badge badge-${sk}">${t.status.replace('_',' ')}</span>
          </div>
        </div>
        <div class="crm-task-meta">
          <span>Client: <b>${escapeHTML(t.client_name || 'Internal')}</b></span>
          <span>Assignee: ${escapeHTML(t.assignee_name || 'Unassigned')}</span>
          ${isOverdue ? '<span style="color:var(--color-red);font-weight:700;">OVERDUE</span>' : ''}
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// IST CLOCK
// ============================================================
function loadClockWorkspace() {
  if (clockInterval) clearInterval(clockInterval);
  tickClock();
  clockInterval = setInterval(tickClock, 1000);
}

function tickClock() {
  const now = new Date();
  const ist = { timeZone: 'Asia/Kolkata' };

  const timeStr = now.toLocaleTimeString('en-IN', { ...ist, hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const dateStr = now.toLocaleDateString('en-IN', { ...ist, weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const hour = parseInt(now.toLocaleString('en-IN', { ...ist, hour:'numeric', hour12: false }), 10);

  let greeting = 'Good Night';
  if (hour >= 5  && hour < 12) greeting = 'Good Morning';
  else if (hour >= 12 && hour < 17) greeting = 'Good Afternoon';
  else if (hour >= 17 && hour < 21) greeting = 'Good Evening';

  const el = id => document.getElementById(id);
  if (el('clock-display'))  el('clock-display').textContent  = timeStr;
  if (el('clock-date'))     el('clock-date').textContent     = dateStr;
  if (el('clock-greeting')) el('clock-greeting').textContent = greeting;

  // Render stats once per second (cheap)
  renderClockStats(now);
}

function renderClockStats(now) {
  const statsRow = document.getElementById('clock-stats-row');
  if (!statsRow) return;

  const ist = { timeZone: 'Asia/Kolkata' };
  const parts = now.toLocaleString('en-IN', { ...ist, hour:'numeric', minute:'numeric', hour12:true }).split(' ');
  const dayOfYear = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 86400000);
  const weekNum   = Math.ceil(dayOfYear / 7);
  const daysLeft  = 365 - dayOfYear;

  statsRow.innerHTML = [
    { label: 'Day of Year',   val: dayOfYear,   color: 'var(--color-blue)' },
    { label: 'Week No.',      val: `W${weekNum}`, color: 'var(--color-green)' },
    { label: 'Days Left (yr)', val: daysLeft,    color: 'var(--color-yellow)' },
    { label: 'Time Zone',     val: 'UTC+5:30',   color: 'var(--color-red)' }
  ].map(s => `
    <div class="clock-stat-card">
      <div class="clock-stat-val" style="color:${s.color};">${s.val}</div>
      <div class="clock-stat-label">${s.label}</div>
    </div>`).join('');
}

// ============================================================
// TASK TIMER
// ============================================================
async function loadTimerWorkspace() {
  renderTimerDisplay();
  renderTimerLog();

  try {
    const [todoRes, ipRes] = await Promise.all([
      fetch('/api/tasks?status=todo&pageSize=50'),
      fetch('/api/tasks?status=in_progress&pageSize=50')
    ]);
    const todoData = todoRes.ok ? (await todoRes.json()).data : [];
    const ipData   = ipRes.ok  ? (await ipRes.json()).data   : [];
    const tasks = [...todoData, ...ipData];

    const dd = document.getElementById('timer-task-dropdown');
    dd.innerHTML = '<option value="">-- Select a Task --</option>' +
      tasks.map(t =>
        `<option value="${t.id}">[${t.priority.toUpperCase()}] ${escapeHTML(t.title)}${t.client_name ? ' · ' + escapeHTML(t.client_name) : ''}</option>`
      ).join('');
  } catch (_) {}
}

function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  document.getElementById('timer-display').className = 'timer-display running';
  timerInterval = setInterval(() => { timerSeconds++; renderTimerDisplay(); }, 1000);
}

function pauseTimer() {
  if (!timerRunning) return;
  timerRunning = false;
  clearInterval(timerInterval);
  document.getElementById('timer-display').className = 'timer-display paused';
}

function resetTimer() {
  if (timerSeconds > 0) {
    const dd  = document.getElementById('timer-task-dropdown');
    const opt = dd.options[dd.selectedIndex];
    timerLogs.unshift({
      taskName: opt?.value ? opt.text.replace(/^\[.*?\]\s*/, '') : 'No task linked',
      priority: opt?.value ? opt.text.match(/\[(\w+)\]/)?.[1] || '' : '',
      seconds:  timerSeconds,
      endedAt:  new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })
    });
    renderTimerLog();
  }
  timerRunning = false;
  timerSeconds = 0;
  clearInterval(timerInterval);
  document.getElementById('timer-display').className = 'timer-display';
  renderTimerDisplay();
}

function renderTimerDisplay() {
  const h = Math.floor(timerSeconds / 3600);
  const m = Math.floor((timerSeconds % 3600) / 60);
  const s = timerSeconds % 60;
  document.getElementById('timer-display').textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function renderTimerLog() {
  const container = document.getElementById('timer-log-list');
  if (!container) return;
  if (timerLogs.length === 0) {
    container.innerHTML = '<div class="empty-message">No sessions logged yet.</div>';
    return;
  }
  container.innerHTML = timerLogs.slice(0, 15).map((log, i) => {
    const h = Math.floor(log.seconds / 3600);
    const m = Math.floor((log.seconds % 3600) / 60);
    const s = log.seconds % 60;
    const dur = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
    const prioColor = { URGENT:'var(--color-red)', HIGH:'var(--color-orange)', MEDIUM:'var(--color-blue)', LOW:'var(--color-green)' };
    return `
      <div class="timer-log-item">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="timer-log-duration">${dur}</span>
          ${log.priority ? `<span class="badge badge-${log.priority.toLowerCase()}">${log.priority}</span>` : ''}
        </div>
        <div class="timer-log-task">${escapeHTML(log.taskName)}</div>
        <div class="timer-log-meta">Session #${timerLogs.length - i} &nbsp;·&nbsp; Ended ${log.endedAt}</div>
      </div>`;
  }).join('');
}
