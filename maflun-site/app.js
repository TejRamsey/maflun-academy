/* ============================================================
   Maflun Academy — shared app script, loaded on every page.
   Marketing-page bits below are guarded so they do nothing (and
   don't error) on pages that lack those elements.
   ============================================================ */

const yearEl = document.getElementById('year');
if(yearEl) yearEl.textContent = new Date().getFullYear();

const menuBtn = document.getElementById('menuBtn');
const mobileMenu = document.getElementById('mobileMenu');
if(menuBtn && mobileMenu){
  menuBtn.addEventListener('click', () => mobileMenu.classList.toggle('open'));
  mobileMenu.querySelectorAll('a,button').forEach(a => a.addEventListener('click', () => mobileMenu.classList.remove('open')));
}

const headerEl = document.querySelector('.site-header');
if(headerEl){
  window.addEventListener('scroll', () => {
    headerEl.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive:true });
}

if('IntersectionObserver' in window){
  const revealTargets = document.querySelectorAll('.reveal-onscroll');
  if(revealTargets.length){
    const revealObserver = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting){
          entry.target.classList.add('in-view');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold:0.15 });
    revealTargets.forEach(el=>revealObserver.observe(el));
  }
}else{
  document.querySelectorAll('.reveal-onscroll').forEach(el=>el.classList.add('in-view'));
}
function scrollToId(e, id){
  e.preventDefault();
  const el = document.getElementById(id);
  if(el) el.scrollIntoView({behavior:'smooth'});
  return false;
}

/* ================= Supabase backend config =================
   1. Create a free project at https://supabase.com
   2. Run setup.sql in the Supabase SQL Editor — it creates the
      students / results / fees / payments / staff tables and the
      access rules (Row Level Security) that protect them.
   3. In Supabase: Authentication -> Providers -> Email -> turn OFF
      "Confirm email". This lets a new student login work right away
      instead of waiting on a confirmation email that has nowhere
      real to go.
   4. Create at least one staff account: Authentication -> Add user
      (a real email + password), then run the insert shown at the
      bottom of setup.sql to mark that account as staff.
   5. Project Settings -> API gives you the Project URL and the
      "anon public" key used below. The anon key is meant to be
      public — Postgres Row Level Security (from setup.sql) is what
      actually keeps everyone's data separated, not this key.
================================================================= */
const SUPABASE_URL = "https://sazlwzwbewxdnuutixbd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhemx3endiZXd4ZG51dXRpeGJkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5ODU5ODgsImV4cCI6MjEwNDU2MTk4OH0.CranV-gRK8u8nhttit-hn26XgHAh2OYOARAd6Bwf_7w";

/* ================= Paystack config =================
   1. Create a Paystack account at https://paystack.com and get your
      keys from Settings -> API Keys & Webhooks. Start with the TEST
      public key (starts with pk_test_) until you're ready to accept
      real money, then switch to the LIVE key (pk_live_).
   2. Paste the public key below — it's safe to expose, same as the
      Supabase anon key above.
   3. The SECRET key (sk_test_.../sk_live_...) must never go in this
      file. It's set as a Supabase Edge Function secret instead — see
      paystack-verify-payment.ts and its deployment notes.
================================================================= */
const PAYSTACK_PUBLIC_KEY = "PASTE_YOUR_PAYSTACK_PUBLIC_KEY_HERE";
const VERIFY_PAYMENT_URL = SUPABASE_URL + "/functions/v1/verify-payment";

// Main client. Session is kept in sessionStorage (not localStorage): it
// survives moving between pages of the site in this tab, so a real
// multi-page site works normally, but it's gone the moment the tab or
// browser closes — same "don't stay logged in forever" guarantee as
// before, just compatible with real page navigation.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'sb-maflun-main', storage: window.sessionStorage, persistSession: true, autoRefreshToken: true }
});
// Auxiliary client, used only for the instant when a new student
// account is created, so that doesn't disturb the staff member's
// own logged-in session in the main client above.
const supabaseAux = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'sb-maflun-aux', storage: window.sessionStorage, persistSession: false, autoRefreshToken: false }
});

/* Student portal logins are real Supabase accounts under the hood,
   addressed by a synthetic email built from the Student ID, so
   parents never need to see or type an email address. */
function studentEmail(id){
  return id.trim().toLowerCase() + '@portal.maflunacademy.local';
}

/* ============== Small helpers ============== */
function nextStudentId(existingIds){
  let max = 0;
  existingIds.forEach(id=>{
    const m = /MAF-(\d+)/.exec(id);
    if(m) max = Math.max(max, parseInt(m[1],10));
  });
  return 'MAF-' + String(max+1).padStart(4,'0');
}
function gradeFor(score){
  score = Number(score);
  if(isNaN(score)) return '-';
  if(score>=70) return 'A';
  if(score>=60) return 'B';
  if(score>=50) return 'C';
  if(score>=45) return 'D';
  return 'F';
}
function gradeBadgeClass(g){
  return (g==='A'||g==='B') ? 'badge-good' : (g==='C'||g==='D') ? 'badge-warn' : 'badge-bad';
}
function gradeBadge(g){
  return '<span class="badge '+gradeBadgeClass(g)+'">'+g+'</span>';
}
function money(n){
  n = Number(n)||0;
  return '₦' + n.toLocaleString('en-NG');
}
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function friendlyError(error){
  if(!error) return 'Something went wrong. Please try again.';
  const msg = error.message || String(error);
  if(/Invalid login credentials/i.test(msg)) return 'That ID/email and password don\u2019t match our records.';
  if(/Email not confirmed/i.test(msg)) return 'This account isn\u2019t active yet. Contact the school office.';
  return msg;
}

/* ============== App shell (appbar + sidebar), shared by every
   protected page. Sidebar links are real hrefs to real pages now —
   no more single-page tab switching. ============== */
const PORTAL_NAV = [
  {key:'dashboard', label:'Dashboard', href:'student-dashboard.html'},
  {key:'results',   label:'Results',   href:'student-results.html'},
  {key:'fees',      label:'Fees',      href:'student-fees.html'},
  {key:'profile',   label:'Profile',   href:'student-profile.html'}
];
const ADMIN_NAV = [
  {key:'dashboard', label:'Dashboard', href:'admin-dashboard.html'},
  {key:'students',  label:'Students',  href:'admin-students.html'},
  {key:'results',   label:'Results',   href:'admin-results.html'},
  {key:'fees',      label:'Fees',      href:'admin-fees.html'}
];
function renderShell(role, activeKey, userName, userSub){
  const nav = role === 'admin' ? ADMIN_NAV : PORTAL_NAV;
  const logoutCall = role === 'admin' ? 'adminLogout()' : 'portalLogout()';

  const appbarEl = document.getElementById('appbar');
  if(appbarEl){
    appbarEl.innerHTML =
      '<button class="sidebar-toggle" id="sidebarToggle" onclick="toggleSidebar()" aria-label="Open menu">☰</button>' +
      '<div class="appbrand"><img src="logo.png" alt="Maflun Academy crest"><span>Maflun Academy Portal</span></div>' +
      '<div class="userbox">' +
        '<div><b>'+esc(userName)+'</b><small>'+esc(userSub)+'</small></div>' +
        '<div class="avatar">'+esc((userName||'M').trim().charAt(0).toUpperCase())+'</div>' +
        '<button class="btn btn-light" onclick="'+logoutCall+'">Logout</button>' +
      '</div>';
  }

  const sidebarEl = document.getElementById('appSidebar');
  if(sidebarEl){
    const links = nav.map(item =>
      '<a class="side-btn'+(item.key===activeKey?' active':'')+'" href="'+item.href+'">'+item.label+'</a>'
    ).join('');
    sidebarEl.innerHTML =
      '<div class="side-label">Main menu</div>' + links +
      '<div class="side-label" style="margin-top:20px">Account</div>' +
      '<button class="side-btn" onclick="'+logoutCall+'">↪ Sign out</button>';
  }
}
function toggleSidebar(){
  const sb = document.getElementById('appSidebar');
  if(!sb) return;
  const isOpen = sb.classList.toggle('open');
  const bd = document.getElementById('sidebarBackdrop');
  if(bd) bd.classList.toggle('show', isOpen);
}
function closeSidebar(){
  const sb = document.getElementById('appSidebar');
  if(sb) sb.classList.remove('open');
  const bd = document.getElementById('sidebarBackdrop');
  if(bd) bd.classList.remove('show');
}

/* ============== Toast ============== */
let toastTimer = null;
function toast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ============== Auth guards ==============
   Every protected page calls one of these before rendering anything.
   Each one re-checks the session and the role against the database —
   nothing is trusted from a previous page. */
let portalState = { loggedIn:false, student:null };
let adminState = { loggedIn:false };

async function requireStudentAuth(activeKey){
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if(!sessionData || !sessionData.session){
    window.location.href = 'login.html?role=student';
    return null;
  }
  const { data: srow, error } = await supabaseClient
    .from('students').select('*').eq('auth_user_id', sessionData.session.user.id).maybeSingle();
  if(error || !srow){
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html?role=student';
    return null;
  }
  portalState = { loggedIn:true, student:srow };
  renderShell('portal', activeKey, srow.name, srow.student_id + ' · ' + srow.class_name);
  resetIdleTimer();
  return srow;
}
async function requireStaffAuth(activeKey){
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if(!sessionData || !sessionData.session){
    window.location.href = 'login.html?role=staff';
    return null;
  }
  const { data: staffRow } = await supabaseClient
    .from('staff').select('user_id').eq('user_id', sessionData.session.user.id).maybeSingle();
  if(!staffRow){
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html?role=staff';
    return null;
  }
  adminState.loggedIn = true;
  renderShell('admin', activeKey, 'School Administrator', 'Staff');
  resetIdleTimer();
  return staffRow;
}

/* ============== Login (used on login.html) ============== */
function setLoginRole(role){
  const isStudent = role === 'student';
  document.getElementById('loginRoleStudent').classList.toggle('active', isStudent);
  document.getElementById('loginRoleStaff').classList.toggle('active', !isStudent);
  document.getElementById('studentLoginForm').classList.toggle('hidden', !isStudent);
  document.getElementById('staffLoginForm').classList.toggle('hidden', isStudent);
}
async function portalLogin(){
  const id = document.getElementById('portalId').value.trim();
  const pin = document.getElementById('portalPin').value.trim();
  const alertBox = document.getElementById('portalLoginAlert');
  alertBox.innerHTML = '';
  if(!id || !pin){
    alertBox.innerHTML = '<div class="alert alert-error">Enter both Student ID and PIN.</div>';
    return;
  }
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: studentEmail(id), password: pin
  });
  if(error || !data.user){
    alertBox.innerHTML = '<div class="alert alert-error">We could not match that Student ID and PIN. Check with the school office.</div>';
    return;
  }
  const { data: srow, error: serr } = await supabaseClient
    .from('students').select('*').eq('auth_user_id', data.user.id).maybeSingle();
  if(serr || !srow){
    alertBox.innerHTML = '<div class="alert alert-error">Login worked, but no student record is linked to it. Contact the school office.</div>';
    await supabaseClient.auth.signOut();
    return;
  }
  window.location.href = 'student-dashboard.html';
}
async function adminLogin(){
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  const alertBox = document.getElementById('adminLoginAlert');
  alertBox.innerHTML = '';
  if(!email || !password){
    alertBox.innerHTML = '<div class="alert alert-error">Enter your email and password.</div>';
    return;
  }
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if(error || !data.user){
    alertBox.innerHTML = '<div class="alert alert-error">'+esc(friendlyError(error))+'</div>';
    return;
  }
  const { data: staffRow } = await supabaseClient
    .from('staff').select('user_id').eq('user_id', data.user.id).maybeSingle();
  if(!staffRow){
    alertBox.innerHTML = '<div class="alert alert-error">This account is not registered as staff. Contact your school\u2019s site administrator.</div>';
    await supabaseClient.auth.signOut();
    return;
  }
  window.location.href = 'admin-dashboard.html';
}

/* ============== Logout ==============
   Each page is now a real, separate document, so logging out just
   needs to end the session and send the browser to the login page —
   there's no shared in-page state left over to clean up. */
async function portalLogout(showReason){
  await supabaseClient.auth.signOut();
  clearIdleTimers();
  if(showReason) sessionStorage.setItem('maflunLogoutReason', 'idle');
  window.location.href = 'login.html?role=student';
}
async function adminLogout(showReason){
  await supabaseClient.auth.signOut();
  clearIdleTimers();
  if(showReason) sessionStorage.setItem('maflunLogoutReason', 'idle');
  window.location.href = 'login.html?role=staff';
}

function sessionOptions(){
  const now = new Date().getFullYear();
  const opts = [];
  for(let y=now-1; y<=now+1; y++) opts.push(y+'/'+(y+1));
  return opts;
}
async function refreshPortalSelectors(){
  const opts = sessionOptions();
  ['resSession','feeSession'].forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    const cur = sel.value;
    sel.innerHTML = opts.map(o=>'<option'+(o===cur?' selected':'')+'>'+o+'</option>').join('');
  });
}
async function renderPortalResults(){
  if(!portalState.loggedIn) return;
  const session = document.getElementById('resSession').value;
  const term = document.getElementById('resTerm').value;
  const body = document.getElementById('resultsBody');
  const { data: rec, error } = await supabaseClient
    .from('results').select('*')
    .eq('student_id', portalState.student.student_id)
    .eq('session', session).eq('term', term).maybeSingle();
  if(error){
    body.innerHTML = '<div class="empty-state">Could not load results right now.</div>';
    return;
  }
  if(!rec || !rec.subjects || !rec.subjects.length){
    body.innerHTML = '<div class="empty-state">No results have been uploaded for this term yet.</div>';
    return;
  }
  let rows = rec.subjects.map(s=>
    '<tr><td>'+esc(s.name)+'</td><td>'+esc(s.score)+'</td><td>'+gradeBadge(s.grade||gradeFor(s.score))+'</td></tr>'
  ).join('');
  body.innerHTML =
    '<div class="table-wrap"><table class="data"><thead><tr><th>Subject</th><th>Score</th><th>Grade</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    (rec.remarks ? '<div class="note-box"><strong>Teacher\'s remarks:</strong> '+esc(rec.remarks)+'</div>' : '');
}
async function renderPortalFees(){
  if(!portalState.loggedIn) return;
  const st = portalState.student;
  const session = document.getElementById('feeSession').value;
  const term = document.getElementById('feeTerm').value;

  const { data: feeRow } = await supabaseClient
    .from('fees').select('amount').eq('class_name', st.class_name).maybeSingle();
  const due = feeRow ? Number(feeRow.amount) : 0;

  const { data: mine } = await supabaseClient
    .from('payments').select('*').eq('student_id', st.student_id).order('paid_on', {ascending:false});
  const payments = mine || [];
  const paidAllTime = payments.reduce((sum,p)=>sum+Number(p.amount||0),0);
  const paidThisTerm = payments
    .filter(p=>p.session===session && p.term===term)
    .reduce((sum,p)=>sum+Number(p.amount||0),0);
  const balance = Math.max(due - paidThisTerm, 0);

  const cards = document.getElementById('feeStatCards');
  cards.innerHTML =
    '<div class="stat-card"><div class="label">Fee per term (' + esc(st.class_name) + ')</div><div class="value">'+money(due)+'</div></div>' +
    '<div class="stat-card"><div class="label">Balance this term</div><div class="value">'+money(balance)+'</div></div>' +
    '<div class="stat-card"><div class="label">Total paid (all time)</div><div class="value">'+money(paidAllTime)+'</div></div>';
  const payAmountEl = document.getElementById('payAmount');
  if(payAmountEl && !payAmountEl.dataset.userEdited){
    payAmountEl.value = balance > 0 ? balance : '';
  }

  const hist = document.getElementById('paymentHistory');
  if(!payments.length){
    hist.innerHTML = '<div class="empty-state">No payments recorded yet.</div>';
  }else{
    const rows = payments.map(p=>
      '<tr><td>'+esc(p.paid_on)+'</td><td>'+esc(p.session)+'</td><td>'+esc(p.term)+'</td><td>'+money(p.amount)+'</td><td>'+esc(p.id)+'</td></tr>'
    ).join('');
    hist.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Session</th><th>Term</th><th>Amount</th><th>Reference</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
}

/* --- Portal: Dashboard & Profile --- */
async function renderPortalDashboard(){
  const st = portalState.student;
  document.getElementById('portalDashGreeting').textContent = 'Welcome back, ' + (st.name.split(' ')[0] || st.name);
  const session = sessionOptions()[0];
  const term = 'First Term';

  const { data: feeRow } = await supabaseClient.from('fees').select('amount').eq('class_name', st.class_name).maybeSingle();
  const due = feeRow ? Number(feeRow.amount) : 0;
  const { data: myPayments } = await supabaseClient.from('payments').select('*').eq('student_id', st.student_id);
  const payments = myPayments || [];
  const paidThisTerm = payments.filter(p=>p.session===session && p.term===term).reduce((s,p)=>s+Number(p.amount||0),0);
  const balance = Math.max(due - paidThisTerm, 0);
  const totalPaid = payments.reduce((s,p)=>s+Number(p.amount||0),0);

  const { data: latestResult } = await supabaseClient
    .from('results').select('*').eq('student_id', st.student_id)
    .order('updated_at', {ascending:false}).limit(1).maybeSingle();
  let avgText = '—';
  if(latestResult && latestResult.subjects && latestResult.subjects.length){
    const avg = latestResult.subjects.reduce((s,x)=>s+Number(x.score||0),0) / latestResult.subjects.length;
    avgText = avg.toFixed(1) + '%';
  }

  document.getElementById('portalDashCards').innerHTML =
    '<div class="stat-card"><div class="label">Class</div><div class="value" style="font-size:19px">'+esc(st.class_name)+'</div></div>' +
    '<div class="stat-card"><div class="label">Balance ('+esc(term)+')</div><div class="value">'+money(balance)+'</div></div>' +
    '<div class="stat-card"><div class="label">Total paid (all time)</div><div class="value">'+money(totalPaid)+'</div></div>' +
    '<div class="stat-card"><div class="label">Latest result average</div><div class="value">'+avgText+'</div></div>';
}
function renderPortalProfile(){
  const st = portalState.student;
  document.getElementById('profileBody').innerHTML =
    '<div class="profile"><div class="profile-avatar">'+esc((st.name||'?').charAt(0))+'</div>' +
    '<div><h3 style="margin:0">'+esc(st.name)+'</h3><span style="color:var(--ink-soft);font-size:12px">'+esc(st.student_id)+'</span></div></div>' +
    '<div class="kv">' +
    '<div><small>Class</small><b>'+esc(st.class_name)+'</b></div>' +
    '<div><small>Parent / guardian phone</small><b>'+esc(st.phone||'—')+'</b></div>' +
    '</div>';
}

/* --- Admin: Dashboard --- */
async function renderAdminDashboard(){
  const [studentsRes, resultsRes, paymentsRes] = await Promise.all([
    supabaseClient.from('students').select('*', {count:'exact', head:true}),
    supabaseClient.from('results').select('*', {count:'exact', head:true}),
    supabaseClient.from('payments').select('amount')
  ]);
  const totalCollected = (paymentsRes.data || []).reduce((s,p)=>s+Number(p.amount||0),0);
  document.getElementById('adminDashCards').innerHTML =
    '<div class="stat-card"><div class="label">Total students</div><div class="value">'+(studentsRes.count||0)+'</div></div>' +
    '<div class="stat-card"><div class="label">Results on file</div><div class="value">'+(resultsRes.count||0)+'</div></div>' +
    '<div class="stat-card"><div class="label">Fees collected</div><div class="value">'+money(totalCollected)+'</div></div>' +
    '<div class="stat-card"><div class="label">Payments recorded</div><div class="value">'+(paymentsRes.data||[]).length+'</div></div>';

  const { data: recent } = await supabaseClient
    .from('payments').select('*').order('paid_on', {ascending:false}).limit(5);
  const box = document.getElementById('adminRecentActivity');
  if(!recent || !recent.length){
    box.innerHTML = '<div class="empty-state">No payments recorded yet.</div>';
  }else{
    const rows = recent.map(p=>
      '<tr><td>'+esc(p.paid_on)+'</td><td>'+esc(p.student_id)+'</td><td>'+money(p.amount)+'</td></tr>'
    ).join('');
    box.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Student</th><th>Amount</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
}

/* --- Paying with Paystack --- */
function paystackRef(){
  return 'MAF' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,7).toUpperCase();
}
function payWithPaystack(){
  const alertBox = document.getElementById('payAlert');
  alertBox.innerHTML = '';
  const email = document.getElementById('payEmail').value.trim();
  const amount = Number(document.getElementById('payAmount').value);
  const session = document.getElementById('feeSession').value;
  const term = document.getElementById('feeTerm').value;
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    alertBox.innerHTML = '<div class="alert alert-error">Enter a valid email address for your receipt.</div>';
    return;
  }
  if(!amount || amount<=0){
    alertBox.innerHTML = '<div class="alert alert-error">Enter a valid amount.</div>';
    return;
  }
  if(!window.PaystackPop){
    alertBox.innerHTML = '<div class="alert alert-error">Payment could not start. Please refresh the page and try again.</div>';
    return;
  }
  if(PAYSTACK_PUBLIC_KEY.indexOf('PASTE_YOUR') === 0){
    alertBox.innerHTML = '<div class="alert alert-error">Online payment is not set up yet. Please pay at the school office in the meantime.</div>';
    return;
  }
  const reference = paystackRef();
  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: email,
    amount: Math.round(amount * 100), // Paystack expects kobo
    currency: 'NGN',
    ref: reference,
    metadata: {
      student_id: portalState.student.student_id,
      session: session,
      term: term,
      custom_fields: [
        { display_name: "Student ID", variable_name: "student_id", value: portalState.student.student_id },
        { display_name: "Student name", variable_name: "student_name", value: portalState.student.name }
      ]
    },
    callback: function(response){
      alertBox.innerHTML = '<div class="alert alert-good">Payment received — confirming…</div>';
      confirmPaystackPayment(response.reference, session, term);
    },
    onClose: function(){ /* user closed the popup without paying */ }
  });
  handler.openIframe();
}
async function confirmPaystackPayment(reference, session, term){
  const alertBox = document.getElementById('payAlert');
  try{
    const { data: sd } = await supabaseClient.auth.getSession();
    const token = sd && sd.session ? sd.session.access_token : SUPABASE_ANON_KEY;
    const res = await fetch(VERIFY_PAYMENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        reference, student_id: portalState.student.student_id, session, term
      })
    });
    const out = await res.json();
    if(!out.success){
      alertBox.innerHTML = '<div class="alert alert-error">We received a payment response but could not confirm it automatically ('+esc(out.error||'unknown error')+'). Please contact the school office with reference <strong>'+esc(reference)+'</strong>.</div>';
      return;
    }
    alertBox.innerHTML = '<div class="alert alert-good">Payment confirmed — thank you! Reference: '+esc(reference)+'.</div>';
    const payAmountEl = document.getElementById('payAmount');
    payAmountEl.value = '';
    delete payAmountEl.dataset.userEdited;
    renderPortalFees();
  }catch(e){
    alertBox.innerHTML = '<div class="alert alert-error">Payment may have gone through, but we could not confirm it automatically. Please contact the school office with reference <strong>'+esc(reference)+'</strong>.</div>';
  }
}

/* Standard class order ("sets"), used to group and sort students consistently. */
const CLASS_ORDER = ['Nursery 1','Nursery 2','Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6','JSS 1','JSS 2','JSS 3','SSS 1','SSS 2','SSS 3'];
function classRank(cls){
  const i = CLASS_ORDER.indexOf(cls);
  return i === -1 ? CLASS_ORDER.length : i;
}
function matchesSearch(s, q){
  if(!q) return true;
  q = q.trim().toLowerCase();
  return s.student_id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
}

/* --- Students --- */
async function registerStudent(){
  const alertBox = document.getElementById('studentAlert');
  alertBox.innerHTML = '';
  const name = document.getElementById('stuName').value.trim();
  const cls = document.getElementById('stuClass').value;
  const phone = document.getElementById('stuPhone').value.trim();
  const pin = document.getElementById('stuPin').value.trim();
  if(!name || !phone || !pin){
    alertBox.innerHTML = '<div class="alert alert-error">Fill in name, phone and PIN.</div>';
    return;
  }
  if(!/^\d{4,6}$/.test(pin)){
    alertBox.innerHTML = '<div class="alert alert-error">PIN must be 4–6 digits.</div>';
    return;
  }
  const { data: existing } = await supabaseClient.from('students').select('student_id');
  const id = nextStudentId((existing||[]).map(s=>s.student_id));
  const email = studentEmail(id);

  // Create the portal login on the auxiliary client so it never
  // touches the staff member's own session on the main client.
  const { data: signupData, error: signupError } = await supabaseAux.auth.signUp({
    email, password: pin
  });
  await supabaseAux.auth.signOut();
  if(signupError){
    alertBox.innerHTML = '<div class="alert alert-error">Could not create the portal login: '+esc(friendlyError(signupError))+'</div>';
    return;
  }
  const newUserId = signupData.user ? signupData.user.id : null;
  if(!newUserId){
    alertBox.innerHTML = '<div class="alert alert-error">Account creation did not complete. Please try again, or contact your site administrator if this continues.</div>';
    return;
  }

  const { error: insertError } = await supabaseClient.from('students').insert({
    student_id: id, auth_user_id: newUserId, name, class_name: cls, phone
  });
  if(insertError){
    alertBox.innerHTML = '<div class="alert alert-error">The login was created but the student record failed to save: '+esc(insertError.message)+'</div>';
    return;
  }

  document.getElementById('stuName').value='';
  document.getElementById('stuPhone').value='';
  document.getElementById('stuPin').value='';
  alertBox.innerHTML = '<div class="alert alert-good">Registered '+esc(name)+' as <strong>'+id+'</strong>. Share this ID and the PIN with the parent.</div>';
  renderStudentsList();
}
async function renderStudentsList(){
  const { data: students, error } = await supabaseClient.from('students').select('*').order('student_id');
  const box = document.getElementById('studentsList');
  if(error){
    box.innerHTML = '<div class="empty-state">Could not load students right now.</div>';
    return;
  }
  if(!students || !students.length){
    box.innerHTML = '<div class="empty-state">No students registered yet.</div>';
    return;
  }
  const q = (document.getElementById('studentSearch')||{}).value || '';
  const filtered = students.filter(s=>matchesSearch(s,q));
  if(!filtered.length){
    box.innerHTML = '<div class="empty-state">No students match that search.</div>';
    return;
  }
  const byClass = {};
  filtered.forEach(s=>{
    (byClass[s.class_name] = byClass[s.class_name] || []).push(s);
  });
  const classes = Object.keys(byClass).sort((a,b)=>classRank(a)-classRank(b));
  const html = classes.map(cls=>{
    const rows = byClass[cls].map(s=>
      '<tr><td>'+esc(s.student_id)+'</td><td>'+esc(s.name)+'</td><td>'+esc(s.phone)+'</td>'+
      '<td><div class="row-actions"><button onclick="deleteStudent(\''+s.student_id+'\')">Remove</button></div></td></tr>'
    ).join('');
    return '<h4 style="margin:24px 0 8px;font-size:15px;color:var(--brand-deep)">'+esc(cls)+' <span style="color:var(--ink-soft);font-weight:400">('+byClass[cls].length+')</span></h4>'+
      '<div class="table-wrap"><table class="data"><thead><tr><th>ID</th><th>Name</th><th>Parent phone</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }).join('');
  box.innerHTML = html;
}
async function deleteStudent(id){
  if(!confirm('Remove this student record? Their results and payment history stay on file. Their portal login is deactivated separately by your site administrator.')) return;
  const { error } = await supabaseClient.from('students').delete().eq('student_id', id);
  if(error){
    alert('Could not remove student: ' + error.message);
    return;
  }
  renderStudentsList();
  populateResultStudentSelect();
}

/* --- Results --- */
async function populateResultStudentSelect(){
  const { data: students } = await supabaseClient.from('students').select('*').order('student_id');
  const sel = document.getElementById('resStudent');
  const prevValue = sel.value;
  const q = (document.getElementById('resStudentSearch')||{}).value || '';
  const filtered = (students||[]).filter(s=>matchesSearch(s,q));

  if(!students || !students.length){
    sel.innerHTML = '';
    document.getElementById('subjectRows').innerHTML = '<div class="empty-state">Register a student first.</div>';
    document.getElementById('resultHistory').innerHTML = '';
    return;
  }
  if(!filtered.length){
    sel.innerHTML = '<option value="">No matches</option>';
    document.getElementById('subjectRows').innerHTML = '<div class="empty-state">No students match that search.</div>';
    document.getElementById('resultHistory').innerHTML = '';
    return;
  }
  const byClass = {};
  filtered.forEach(s=>{ (byClass[s.class_name] = byClass[s.class_name] || []).push(s); });
  const classes = Object.keys(byClass).sort((a,b)=>classRank(a)-classRank(b));
  sel.innerHTML = classes.map(cls=>
    '<optgroup label="'+esc(cls)+'">' +
    byClass[cls].map(s=>'<option value="'+s.student_id+'">'+esc(s.student_id)+' — '+esc(s.name)+'</option>').join('') +
    '</optgroup>'
  ).join('');
  // Keep the same student selected across a search refinement, if still in the list.
  if(filtered.some(s=>s.student_id===prevValue)) sel.value = prevValue;
  loadResultForm();
}
function subjectRowHtml(name, score){
  const g = gradeFor(score);
  return '<div class="subject-row">' +
    '<input type="text" placeholder="Subject" value="'+esc(name||'')+'" oninput="handleSubjectInput(this)">' +
    '<input type="number" min="0" max="100" placeholder="Score" value="'+(score!=null?esc(score):'')+'" oninput="handleSubjectInput(this)">' +
    '<span class="badge grade-chip '+gradeBadgeClass(g)+'">'+g+'</span>' +
    '<button class="remove-btn" onclick="this.closest(\'.subject-row\').remove()" title="Remove subject">×</button>' +
  '</div>';
}
function handleSubjectInput(el){
  const row = el.closest('.subject-row');
  const inputs = row.querySelectorAll('input');
  const score = inputs[1].value;
  const chip = row.querySelector('.grade-chip');
  const g = gradeFor(score);
  chip.textContent = g;
  chip.className = 'badge grade-chip ' + gradeBadgeClass(g);
}
function addSubjectRow(name, score){
  document.getElementById('subjectRows').insertAdjacentHTML('beforeend', subjectRowHtml(name, score));
}
async function loadResultForm(){
  const studentId = document.getElementById('resStudent').value;
  if(!studentId){
    document.getElementById('resultHistory').innerHTML = '';
    return;
  }
  const session = document.getElementById('resSessionInput').value.trim() || '2025/2026';
  const term = document.getElementById('resTermInput').value;
  const { data: rec } = await supabaseClient
    .from('results').select('*')
    .eq('student_id', studentId).eq('session', session).eq('term', term).maybeSingle();
  const container = document.getElementById('subjectRows');
  container.innerHTML = '';
  const defaultSubjects = ['Mathematics','English Language','Basic Science'];
  if(rec && rec.subjects && rec.subjects.length){
    rec.subjects.forEach(s=>addSubjectRow(s.name, s.score));
  }else{
    defaultSubjects.forEach(s=>addSubjectRow(s, ''));
  }
  document.getElementById('resRemarks').value = (rec && rec.remarks) ? rec.remarks : '';
  renderResultHistory(studentId);
}
async function renderResultHistory(studentId){
  const box = document.getElementById('resultHistory');
  const { data: history, error } = await supabaseClient
    .from('results').select('*').eq('student_id', studentId)
    .order('session', {ascending:false}).order('term', {ascending:false});
  if(error){
    box.innerHTML = '<div class="empty-state">Could not load result history right now.</div>';
    return;
  }
  if(!history || !history.length){
    box.innerHTML = '<div class="empty-state">No results saved yet for this student.</div>';
    return;
  }
  const rows = history.map(r=>{
    const when = r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-GB') : '—';
    return '<tr><td>'+esc(r.session)+'</td><td>'+esc(r.term)+'</td><td>'+(r.subjects?r.subjects.length:0)+' subjects</td><td>'+when+'</td>'+
      '<td><div class="row-actions"><button onclick="loadHistoryEntry(\''+esc(r.session)+'\',\''+esc(r.term)+'\')">Open</button></div></td></tr>';
  }).join('');
  box.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Session</th><th>Term</th><th>Subjects</th><th>Last updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function loadHistoryEntry(session, term){
  document.getElementById('resSessionInput').value = session;
  document.getElementById('resTermInput').value = term;
  loadResultForm();
}
async function saveResult(){
  const alertBox = document.getElementById('resultAlert');
  alertBox.innerHTML = '';
  const studentId = document.getElementById('resStudent').value;
  if(!studentId){
    alertBox.innerHTML = '<div class="alert alert-error">Register a student first.</div>';
    return;
  }
  const session = document.getElementById('resSessionInput').value.trim() || '2025/2026';
  const term = document.getElementById('resTermInput').value;
  const rows = document.querySelectorAll('#subjectRows .subject-row');
  const subjects = [];
  rows.forEach(r=>{
    const inputs = r.querySelectorAll('input');
    const name = inputs[0].value.trim();
    const score = inputs[1].value;
    if(name && score!==''){
      subjects.push({name, score:Number(score), grade:gradeFor(score)});
    }
  });
  if(!subjects.length){
    alertBox.innerHTML = '<div class="alert alert-error">Add at least one subject with a score.</div>';
    return;
  }
  const remarks = document.getElementById('resRemarks').value.trim();
  const { error } = await supabaseClient.from('results').upsert({
    student_id: studentId, session, term, subjects, remarks, updated_at: new Date().toISOString()
  });
  if(error){
    alertBox.innerHTML = '<div class="alert alert-error">Could not save: '+esc(error.message)+'</div>';
    return;
  }
  alertBox.innerHTML = '<div class="alert alert-good">Result saved for '+esc(studentId)+' — '+esc(session)+', '+esc(term)+'.</div>';
  renderResultHistory(studentId);
}

/* --- Fees --- */
async function saveFee(){
  const alertBox = document.getElementById('feesAlert');
  const cls = document.getElementById('feeClass').value;
  const amount = Number(document.getElementById('feeAmount').value);
  if(!amount || amount<0){
    alertBox.innerHTML = '<div class="alert alert-error">Enter a valid amount.</div>';
    return;
  }
  const { error } = await supabaseClient.from('fees').upsert({ class_name: cls, amount });
  if(error){
    alertBox.innerHTML = '<div class="alert alert-error">Could not save: '+esc(error.message)+'</div>';
    return;
  }
  document.getElementById('feeAmount').value = '';
  alertBox.innerHTML = '<div class="alert alert-good">Fee for '+esc(cls)+' set to '+money(amount)+' per term.</div>';
  renderFeesList();
}
async function renderFeesList(){
  const { data: fees, error } = await supabaseClient.from('fees').select('*').order('class_name');
  const box = document.getElementById('feesList');
  if(error){
    box.innerHTML = '<div class="empty-state">Could not load fees right now.</div>';
    return;
  }
  if(!fees || !fees.length){
    box.innerHTML = '<div class="empty-state">No fee amounts set yet.</div>';
    return;
  }
  const rows = fees.map(f=>'<tr><td>'+esc(f.class_name)+'</td><td>'+money(f.amount)+' / term</td></tr>').join('');
  box.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Class</th><th>Amount</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

/* --- Payments (recorded by staff after receiving fees) --- */
async function populatePayStudentSelect(){
  const { data: students } = await supabaseClient.from('students').select('*').order('student_id');
  const sel = document.getElementById('payStudent');
  const byClass = {};
  (students||[]).forEach(s=>{ (byClass[s.class_name] = byClass[s.class_name] || []).push(s); });
  const classes = Object.keys(byClass).sort((a,b)=>classRank(a)-classRank(b));
  sel.innerHTML = classes.map(cls=>
    '<optgroup label="'+esc(cls)+'">' +
    byClass[cls].map(s=>'<option value="'+s.student_id+'">'+esc(s.student_id)+' — '+esc(s.name)+'</option>').join('') +
    '</optgroup>'
  ).join('');
}
async function recordPayment(){
  const alertBox = document.getElementById('recordPayAlert');
  alertBox.innerHTML = '';
  const studentId = document.getElementById('payStudent').value;
  const session = document.getElementById('paySessionInput').value.trim() || '2025/2026';
  const term = document.getElementById('payTermInput').value;
  const amount = Number(document.getElementById('payAmountInput').value);
  if(!studentId){
    alertBox.innerHTML = '<div class="alert alert-error">Register a student first.</div>';
    return;
  }
  if(!amount || amount<=0){
    alertBox.innerHTML = '<div class="alert alert-error">Enter a valid amount.</div>';
    return;
  }
  const { data: userData } = await supabaseClient.auth.getUser();
  const ref = 'MAF' + Date.now().toString().slice(-8);
  const { error } = await supabaseClient.from('payments').insert({
    id: ref, student_id: studentId, session, term, amount,
    paid_on: new Date().toISOString().slice(0,10),
    recorded_by: userData && userData.user ? userData.user.id : null
  });
  if(error){
    alertBox.innerHTML = '<div class="alert alert-error">Could not save: '+esc(error.message)+'</div>';
    return;
  }
  document.getElementById('payAmountInput').value = '';
  alertBox.innerHTML = '<div class="alert alert-good">Payment of '+money(amount)+' recorded for '+esc(studentId)+'. Reference: '+ref+'.</div>';
  renderPaymentsLog();
}
async function renderPaymentsLog(){
  const { data: payments, error } = await supabaseClient
    .from('payments').select('*').order('paid_on', {ascending:false});
  const box = document.getElementById('paymentsLog');
  if(error){
    box.innerHTML = '<div class="empty-state">Could not load payments right now.</div>';
    return;
  }
  if(!payments || !payments.length){
    box.innerHTML = '<div class="empty-state">No payments recorded yet.</div>';
    return;
  }
  const { data: students } = await supabaseClient.from('students').select('student_id,name');
  const nameFor = id => ((students||[]).find(s=>s.student_id===id)||{}).name || '—';
  const rows = payments.map(p=>
    '<tr><td>'+esc(p.paid_on)+'</td><td>'+esc(p.student_id)+'</td><td>'+esc(nameFor(p.student_id))+'</td><td>'+esc(p.session)+'</td><td>'+esc(p.term)+'</td><td>'+money(p.amount)+'</td><td>'+esc(p.id)+'</td></tr>'
  ).join('');
  box.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Student ID</th><th>Name</th><th>Session</th><th>Term</th><th>Amount</th><th>Reference</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

/* ============== Auto sign-out ==============
   Logins don't persist across a closed browser (see persistSession
   above), and — on top of that — anyone left signed in gets signed
   out automatically after a period with no activity, so a shared or
   public computer doesn't stay logged into a student's or staff
   member's account after they walk away. */
const IDLE_LIMIT_MS = 15 * 60 * 1000;   // sign out after 15 minutes of no activity
const IDLE_WARN_MS  = 60 * 1000;        // warn 1 minute before that
let idleWarnTimer = null, idleLogoutTimer = null;

function clearIdleTimers(){
  clearTimeout(idleWarnTimer);
  clearTimeout(idleLogoutTimer);
  const b = document.getElementById('idleBanner');
  if(b) b.classList.remove('show');
}
function resetIdleTimer(){
  clearTimeout(idleWarnTimer);
  clearTimeout(idleLogoutTimer);
  const b = document.getElementById('idleBanner');
  if(b) b.classList.remove('show');
  if(!adminState.loggedIn && !portalState.loggedIn) return;
  idleWarnTimer = setTimeout(showIdleWarning, IDLE_LIMIT_MS - IDLE_WARN_MS);
  idleLogoutTimer = setTimeout(forceIdleLogout, IDLE_LIMIT_MS);
}
function showIdleWarning(){
  const t = document.getElementById('idleBannerText');
  if(t) t.textContent = 'You\u2019ll be logged out in a minute due to inactivity.';
  const b = document.getElementById('idleBanner');
  if(b) b.classList.add('show');
}
function stayLoggedIn(){
  resetIdleTimer();
}
async function forceIdleLogout(){
  const b = document.getElementById('idleBanner');
  if(b) b.classList.remove('show');
  if(adminState.loggedIn) await adminLogout(true);
  else if(portalState.loggedIn) await portalLogout(true);
}
['mousemove','keydown','mousedown','touchstart','scroll'].forEach(evt=>{
  window.addEventListener(evt, () => {
    // Only bother resetting while someone is actually logged in.
    if(adminState.loggedIn || portalState.loggedIn) resetIdleTimer();
  }, { passive:true });
});

