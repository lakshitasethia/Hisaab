/* ============================================
   HISAAB — Application Logic (Multi-worker)
   ============================================ */

const SUPABASE_URL  = 'https://nhyadsaccwacfhhfxsdc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeWFkc2FjY3dhY2ZoaGZ4c2RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MjEyMTcsImV4cCI6MjA5ODQ5NzIxN30.17LzTKccy6GWirC4xWU8VyCFFumb4HelsgBX63exbLo';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── Register Service Worker ─────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW registration failed:', err));
}

// ─── State ───────────────────────────────────
let currentUser    = null;
let workers        = [];
let activeWorker   = null;   // the worker currently being viewed
let wAttendance    = [];     // current cal-month attendance for active worker
let wAllAttendance = [];     // all attendance for active worker
let wTransactions  = [];     // all transactions for active worker

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let dashYear  = new Date().getFullYear();
let dashMonth = new Date().getMonth();

// ─── DOM Helpers ─────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── Init ────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      currentUser = session.user;
      await enterApp();
    } else {
      showView('auth');
    }
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        currentUser = session.user;
        await enterApp();
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        showView('auth');
      }
    });
  } catch (err) {
    console.error('Init error:', err);
    showView('auth');
  }
  bindEvents();
}

// ─── View Management ─────────────────────────
function showView(name) {
  $('loadingScreen').classList.add('hidden');
  $('authScreen').classList.add('hidden');
  $('mainApp').classList.add('hidden');
  if (name === 'auth')    $('authScreen').classList.remove('hidden');
  if (name === 'main')    $('mainApp').classList.remove('hidden');
  if (name === 'loading') $('loadingScreen').classList.remove('hidden');
}

function showHome() {
  $('viewHome').classList.remove('hidden');
  $('viewWorker').classList.add('hidden');
  activeWorker = null;
  renderWorkersList();
}

function showWorkerDetail(worker) {
  activeWorker = worker;
  $('viewHome').classList.add('hidden');
  $('viewWorker').classList.remove('hidden');
  $('workerDetailName').textContent = worker.name;
  calYear  = new Date().getFullYear();
  calMonth = new Date().getMonth();
  switchWorkerTab('dashboard');
}

function switchWorkerTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
  document.querySelectorAll('.wtab').forEach(t => t.classList.remove('active'));
  $('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)).classList.remove('hidden');
  document.querySelector(`.wtab[data-tab="${tabName}"]`).classList.add('active');

  if (tabName === 'dashboard')    refreshDashboard();
  if (tabName === 'attendance')   renderCalendar();
  if (tabName === 'transactions') { $('txnDate').value = todayStr(); loadRecentTxns(); }
  if (tabName === 'ledger')       loadLedger();
}

// ─── Events ──────────────────────────────────
function bindEvents() {
  // Auth
  $('loginForm').addEventListener('submit', handleLogin);

  // Logout (both buttons)
  $('logoutBtn').addEventListener('click',  () => sb.auth.signOut());
  $('logoutBtn2').addEventListener('click', () => sb.auth.signOut());

  // Add worker
  $('showAddWorkerBtn').addEventListener('click', () => {
    $('addWorkerForm').classList.remove('hidden');
    $('showAddWorkerBtn').classList.add('hidden');
  });
  $('cancelAddWorker').addEventListener('click', () => {
    $('addWorkerForm').classList.add('hidden');
    $('showAddWorkerBtn').classList.remove('hidden');
    $('workerForm').reset();
  });
  $('workerForm').addEventListener('submit', handleAddWorker);

  // Back to home
  $('backToHome').addEventListener('click', () => { showHome(); });

  // Worker tabs
  document.querySelectorAll('.wtab').forEach(tab => {
    tab.addEventListener('click', () => switchWorkerTab(tab.dataset.tab));
  });

  // Dashboard quick actions
  $('dMarkToday').addEventListener('click', () => openStatusPicker(todayStr()));
  $('dAddTxn').addEventListener('click', () => switchWorkerTab('transactions'));

  // Dashboard month nav
  $('dashPrev').addEventListener('click', () => {
    dashMonth--;
    if (dashMonth < 0) { dashMonth = 11; dashYear--; }
    refreshDashboard();
  });
  $('dashNext').addEventListener('click', () => {
    dashMonth++;
    if (dashMonth > 11) { dashMonth = 0; dashYear++; }
    refreshDashboard();
  });

  // Calendar nav
  $('calPrev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  $('calNext').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  // Status modal
  document.querySelectorAll('.status-option').forEach(opt => {
    opt.addEventListener('click', () => handleStatusSelect(opt.dataset.status));
  });
  $('modalCancel').addEventListener('click', closeStatusPicker);
  $('statusModal').addEventListener('click', (e) => {
    if (e.target === $('statusModal')) closeStatusPicker();
  });

  // Transaction form
  $('txnForm').addEventListener('submit', handleTransaction);

  // Ledger search + filters
  $('ledgerSearch').addEventListener('input', filterLedger);
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filterLedger();
    });
  });
}

// ─── Auth ────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  $('authError').classList.add('hidden');

  const { error } = await sb.auth.signInWithPassword({
    email:    $('authEmail').value.trim(),
    password: $('authPassword').value,
  });

  if (error) {
    $('authError').textContent = error.message;
    $('authError').classList.remove('hidden');
  }
  btn.disabled = false;
  btn.textContent = 'Sign In';
}

// ─── Enter App ───────────────────────────────
async function enterApp() {
  showView('loading');
  await loadWorkers();
  showView('main');
  showHome();

  // If no workers, auto-show the add form
  if (workers.length === 0) {
    $('addWorkerForm').classList.remove('hidden');
    $('showAddWorkerBtn').classList.add('hidden');
  }
}

// ─── Workers ─────────────────────────────────
async function loadWorkers() {
  const { data, error } = await sb
    .from('workers')
    .select('*')
    .order('created_at');
  if (!error) workers = data || [];
}

async function handleAddWorker(e) {
  e.preventDefault();
  const btn = $('workerSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  $('workerError').classList.add('hidden');

  const payload = {
    name:                   $('wName').value.trim(),
    monthly_salary:         parseInt($('wSalary').value),
    shifts_per_day:         parseInt($('wShifts').value),
    join_date:              $('wJoinDate').value,
    phone_number:           $('wPhone').value.trim() || null,
    alternate_phone_number: $('wPhone2').value.trim() || null,
  };

  const { error } = await sb.from('workers').insert(payload);

  if (error) {
    $('workerError').textContent = error.message;
    $('workerError').classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Save Worker';
    return;
  }

  showToast('Worker added');
  $('workerForm').reset();
  $('addWorkerForm').classList.add('hidden');
  $('showAddWorkerBtn').classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = 'Save Worker';
  await loadWorkers();
  renderWorkersList();
}

// ─── Render Workers List ─────────────────────
async function renderWorkersList() {
  const container = $('workersList');
  if (workers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <p>No workers added yet</p>
      </div>`;
    return;
  }

  // Fetch current month attendance + transactions for all workers in bulk
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const startDate = monthStr + '-01';
  const endDate   = monthStr + '-' + daysInMonth(now.getFullYear(), now.getMonth());

  const [attRes, txnRes] = await Promise.all([
    sb.from('attendance').select('*').gte('date', startDate).lte('date', endDate),
    sb.from('transactions').select('*'),
  ]);

  const allAtt  = attRes.data  || [];
  const allTxns = txnRes.data  || [];

  let html = '';
  for (const w of workers) {
    const monthAtt  = allAtt.filter(a => a.worker_id === w.id);
    const workerTxns = allTxns.filter(t => t.worker_id === w.id);

    let present = 0, half = 0, paidLeave = 0;
    monthAtt.forEach(a => {
      if (a.status === 'present')    present++;
      if (a.status === 'half_day')   half++;
      if (a.status === 'leave_paid') paidLeave++;
    });

    const totalDays = daysInMonth(now.getFullYear(), now.getMonth());
    const effectiveDays = present + (half * 0.5) + paidLeave;
    const salaryEarned  = (effectiveDays / totalDays) * w.monthly_salary;

    const monthTxns = workerTxns.filter(t => t.date.startsWith(monthStr));
    let bonuses = 0, advances = 0, deductions = 0;
    monthTxns.forEach(t => {
      if (t.type === 'bonus')     bonuses    += t.amount;
      if (t.type === 'advance')   advances   += t.amount;
      if (t.type === 'deduction') deductions += t.amount;
    });

    const netDue = Math.round(salaryEarned + bonuses - advances - deductions);
    const totalAdvances = workerTxns.filter(t => t.type === 'advance').reduce((s, t) => s + t.amount, 0);

    html += `
      <div class="worker-card" data-worker-id="${w.id}">
        <div class="wc-top">
          <div class="wc-name">${esc(w.name)}</div>
          <div class="wc-shifts">${w.shifts_per_day === 2 ? '2× daily' : '1× daily'}</div>
        </div>
        <div class="wc-stats">
          <div class="wc-stat">
            <div class="wc-stat-value">${present}</div>
            <div class="wc-stat-label">Present</div>
          </div>
          <div class="wc-stat">
            <div class="wc-stat-value accent">₹${fmtNum(Math.max(0, netDue))}</div>
            <div class="wc-stat-label">Due</div>
          </div>
          <div class="wc-stat">
            <div class="wc-stat-value ${totalAdvances > 0 ? 'alert' : ''}">₹${fmtNum(totalAdvances)}</div>
            <div class="wc-stat-label">Advances</div>
          </div>
        </div>
      </div>`;
  }
  container.innerHTML = html;

  // Bind card clicks
  container.querySelectorAll('.worker-card').forEach(card => {
    card.addEventListener('click', () => {
      const w = workers.find(w => w.id === card.dataset.workerId);
      if (w) openWorker(w);
    });
  });
}

// ─── Open Worker Detail ──────────────────────
async function openWorker(w) {
  activeWorker = w;
  showView('main');
  $('viewHome').classList.add('hidden');
  $('viewWorker').classList.remove('hidden');
  $('workerDetailName').textContent = w.name;

  calYear  = new Date().getFullYear();
  calMonth = new Date().getMonth();
  dashYear  = new Date().getFullYear();
  dashMonth = new Date().getMonth();

  // Load all data for this worker
  await loadWorkerData();
  switchWorkerTab('dashboard');
}

async function loadWorkerData() {
  if (!activeWorker) return;
  await Promise.all([
    loadWorkerAttendance(),
    loadWorkerAllAttendance(),
    loadWorkerTransactions(),
  ]);
}

async function loadWorkerAttendance() {
  const start = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-01`;
  const end   = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${daysInMonth(calYear, calMonth)}`;
  const { data, error } = await sb
    .from('attendance')
    .select('*')
    .eq('worker_id', activeWorker.id)
    .gte('date', start)
    .lte('date', end)
    .order('date');
  if (error) console.error('loadWorkerAttendance error:', error);
  wAttendance = data || [];
}

async function loadWorkerAllAttendance() {
  const { data, error } = await sb
    .from('attendance')
    .select('*')
    .eq('worker_id', activeWorker.id)
    .order('date', { ascending: false });
  if (error) console.error('loadWorkerAllAttendance error:', error);
  wAllAttendance = data || [];
}

async function loadWorkerTransactions() {
  const { data, error } = await sb
    .from('transactions')
    .select('*')
    .eq('worker_id', activeWorker.id)
    .order('date', { ascending: false });
  if (error) console.error('loadWorkerTransactions error:', error);
  wTransactions = data || [];
}

// ─── Dashboard ───────────────────────────────
function refreshDashboard() {
  if (!activeWorker) return;
  $('dMonthlySalary').textContent = '₹' + fmtNum(activeWorker.monthly_salary);
  const year  = dashYear;
  const month = dashMonth;
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  const monthAtt = wAllAttendance.filter(a => a.date.startsWith(monthStr));
  let present = 0, half = 0, paidLeave = 0, unpaidLeave = 0;
  monthAtt.forEach(a => {
    if (a.status === 'present')      present++;
    if (a.status === 'half_day')     half++;
    if (a.status === 'leave_paid')   paidLeave++;
    if (a.status === 'leave_unpaid') unpaidLeave++;
  });

  $('dPresent').textContent     = present;
  $('dHalf').textContent        = half;
  $('dPaidLeave').textContent   = paidLeave;
  $('dUnpaidLeave').textContent = unpaidLeave;

  const totalDays = daysInMonth(year, month);
  const effectiveDays = present + (half * 0.5) + paidLeave;
  const salaryEarned  = (effectiveDays / totalDays) * activeWorker.monthly_salary;

  const monthTxns = wTransactions.filter(t => t.date.startsWith(monthStr));
  let bonuses = 0, advances = 0, deductions = 0;
  monthTxns.forEach(t => {
    if (t.type === 'bonus')     bonuses    += t.amount;
    if (t.type === 'advance')   advances   += t.amount;
    if (t.type === 'deduction') deductions += t.amount;
  });

  const netDue = Math.round(salaryEarned + bonuses - advances - deductions);
  $('dSalaryDue').textContent = '₹' + fmtNum(Math.max(0, netDue));

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('dSalaryMonth').textContent = monthNames[month] + ' ' + year;

  // Running advance balance (all time)
  const totalAdv = wTransactions.filter(t => t.type === 'advance').reduce((s, t) => s + t.amount, 0);
  $('dAdvance').textContent = '₹' + fmtNum(totalAdv);

  // Phone numbers
  if (activeWorker.phone_number) {
    $('dPhoneRow').classList.remove('hidden');
    $('dPhone').textContent = activeWorker.phone_number;
    $('dPhone').href = 'tel:' + activeWorker.phone_number;
  } else {
    $('dPhoneRow').classList.add('hidden');
  }
  if (activeWorker.alternate_phone_number) {
    $('dPhone2Row').classList.remove('hidden');
    $('dPhone2').textContent = activeWorker.alternate_phone_number;
    $('dPhone2').href = 'tel:' + activeWorker.alternate_phone_number;
  } else {
    $('dPhone2Row').classList.add('hidden');
  }

  // Today's status
  const todayRecord = wAllAttendance.find(a => a.date === todayStr());
  if (todayRecord) {
    const labels = { present: 'Present', half_day: 'Half Day', leave_paid: 'Paid Leave', leave_unpaid: 'Unpaid Leave' };
    $('dTodayStatus').textContent = 'Today: ' + labels[todayRecord.status];
  } else {
    $('dTodayStatus').textContent = 'Today not marked yet';
  }
}

// ─── Calendar ────────────────────────────────
async function renderCalendar() {
  await loadWorkerAttendance();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('calTitle').textContent = monthNames[calMonth] + ' ' + calYear;

  const grid = $('calGrid');
  grid.innerHTML = '';

  const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  dayLabels.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-day-label';
    el.textContent = d;
    grid.appendChild(el);
  });

  const totalDays = daysInMonth(calYear, calMonth);
  const firstDay  = new Date(calYear, calMonth, 1).getDay();
  const todayDate = todayStr();

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= totalDays; d++) {
    const el      = document.createElement('div');
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const record  = wAttendance.find(a => a.date === dateStr);

    el.className = 'cal-cell';
    el.textContent = d;
    if (dateStr === todayDate) el.classList.add('today');
    if (record) el.classList.add(record.status);

    el.addEventListener('click', () => openStatusPicker(dateStr));
    grid.appendChild(el);
  }
}

// ─── Status Picker ───────────────────────────
let selectedDate = null;

function openStatusPicker(dateStr) {
  selectedDate = dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  $('modalTitle').textContent = `${d.getDate()} ${mn[d.getMonth()]} ${d.getFullYear()}`;
  $('statusModal').classList.remove('hidden');
}

function closeStatusPicker() {
  $('statusModal').classList.add('hidden');
  selectedDate = null;
}

async function handleStatusSelect(status) {
  if (!selectedDate || !activeWorker) return;
  const dateToMark = selectedDate;
  closeStatusPicker();

  // Use upsert with the unique constraint on (worker_id, date)
  const { data, error } = await sb
    .from('attendance')
    .upsert(
      { worker_id: activeWorker.id, date: dateToMark, status },
      { onConflict: 'worker_id,date' }
    )
    .select()
    .single();

  if (error) {
    showToast('Error: ' + error.message);
    console.error('Attendance save error:', error);
    return;
  }

  showToast('Attendance saved');
  await Promise.all([loadWorkerAttendance(), loadWorkerAllAttendance()]);
  renderCalendar();
  refreshDashboard();
}

// ─── Transactions ────────────────────────────
async function handleTransaction(e) {
  e.preventDefault();
  if (!activeWorker) return;
  const btn = $('txnSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  $('txnError').classList.add('hidden');

  const note = $('txnNote').value.trim();
  if (!note) {
    $('txnError').textContent = 'Note is required';
    $('txnError').classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Save Transaction';
    return;
  }

  const { error } = await sb.from('transactions').insert({
    worker_id: activeWorker.id,
    type:      $('txnType').value,
    amount:    parseInt($('txnAmount').value),
    date:      $('txnDate').value,
    note,
  });

  if (error) {
    $('txnError').textContent = error.message;
    $('txnError').classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Save Transaction';
    return;
  }

  showToast('Transaction saved');
  $('txnForm').reset();
  $('txnDate').value = todayStr();
  btn.disabled = false;
  btn.textContent = 'Save Transaction';
  await loadWorkerTransactions();
  loadRecentTxns();
  refreshDashboard();
}

function loadRecentTxns() {
  const container = $('recentTxns');
  const recent    = wTransactions.slice(0, 10);
  if (recent.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No transactions yet</p></div>';
    return;
  }
  const tl = { advance: 'Advance', bonus: 'Bonus', deduction: 'Deduction' };
  container.innerHTML = `<ul class="txn-list">${recent.map(t => `
    <li class="txn-item">
      <div class="txn-dot ${t.type}"></div>
      <div class="txn-content">
        <div class="txn-line">${tl[t.type]} — ${esc(t.note)}</div>
        <div class="txn-date">${fmtDate(t.date)}</div>
      </div>
      <div class="txn-amount ${t.type === 'bonus' ? 'credit' : 'debit'}">
        ${t.type === 'bonus' ? '+' : '−'}₹${fmtNum(t.amount)}
      </div>
    </li>`).join('')}</ul>`;
}

// ─── Ledger ──────────────────────────────────
function loadLedger() { filterLedger(); }

function filterLedger() {
  const search = ($('ledgerSearch').value || '').toLowerCase();
  const filter = document.querySelector('.filter-chip.active')?.dataset.filter || 'all';

  let entries = [];

  if (filter === 'all' || filter === 'attendance') {
    const sl = { present: 'Present', half_day: 'Half Day', leave_paid: 'Paid Leave', leave_unpaid: 'Unpaid Leave' };
    wAllAttendance.forEach(a => {
      entries.push({ date: a.date, type: 'attendance', status: a.status, text: sl[a.status], note: sl[a.status] });
    });
  }

  if (filter === 'all' || filter === 'transaction') {
    const tl = { advance: 'Advance', bonus: 'Bonus', deduction: 'Deduction' };
    wTransactions.forEach(t => {
      entries.push({ date: t.date, type: 'transaction', txnType: t.type, amount: t.amount, text: `${tl[t.type]} ₹${fmtNum(t.amount)} (${t.note})`, note: t.note });
    });
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));

  if (search) {
    entries = entries.filter(e =>
      e.note.toLowerCase().includes(search) ||
      e.text.toLowerCase().includes(search) ||
      fmtDate(e.date).toLowerCase().includes(search)
    );
  }

  const container = $('ledgerList');
  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📖</div><p>No records found</p></div>';
    return;
  }

  container.innerHTML = `<ul class="txn-list">${entries.map(e => {
    if (e.type === 'attendance') {
      return `<li class="txn-item"><div class="txn-dot ${e.status}"></div><div class="txn-content"><div class="txn-line">${fmtDateShort(e.date)} — ${e.text}</div></div></li>`;
    } else {
      const cr = e.txnType === 'bonus';
      return `<li class="txn-item"><div class="txn-dot ${e.txnType}"></div><div class="txn-content"><div class="txn-line">${fmtDateShort(e.date)} — ${e.text}</div></div><div class="txn-amount ${cr ? 'credit' : 'debit'}">${cr ? '+' : '−'}₹${fmtNum(e.amount)}</div></li>`;
    }
  }).join('')}</ul>`;
}

// ─── Toast ───────────────────────────────────
function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ─── Helpers ─────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function fmtNum(n) { return n.toLocaleString('en-IN'); }
function fmtDate(ds) {
  const d = new Date(ds + 'T00:00:00');
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateShort(ds) {
  const d = new Date(ds + 'T00:00:00');
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${m[d.getMonth()]}`;
}
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
