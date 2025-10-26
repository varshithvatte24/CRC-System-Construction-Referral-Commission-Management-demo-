/* data.js
   Storage & sync layer for CRC system
   - Exposes CRCData object for CRUD and session operations
   - Uses localStorage for persistence and BroadcastChannel for realtime sync
*/

const KEYS = {
  users: 'crc_users_v3',
  projects: 'crc_projects_v3',
  leads: 'crc_leads_v3',
  defaults: 'crc_defaults_v3',
  session: 'crc_session_v3'
};

const BC_NAME = 'crc_channel_v3';
const BC = new BroadcastChannel(BC_NAME);

const CRCData = (function(){
  function read(k, fallback = []) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fallback)); } catch(e){ return fallback; } }
  function write(k, v) { localStorage.setItem(k, JSON.stringify(v)); BC.postMessage({ type:'sync', key:k, ts: new Date().toISOString() }); }
  function readObj(k, fallback = {}) { return read(k, fallback); }
  function uid(prefix='') { return `${prefix}${Math.random().toString(36).slice(2,9)}`; }
  function now() { return new Date().toISOString(); }

  // Session helpers
  function setSession(user) { sessionStorage.setItem(KEYS.session, JSON.stringify(user)); BC.postMessage({ type:'auth', userId: user?.id ?? null }); }
  function getSession() { return JSON.parse(sessionStorage.getItem(KEYS.session) || 'null'); }
  function clearSession() { sessionStorage.removeItem(KEYS.session); BC.postMessage({ type:'auth-logout' }); }

  // Init defaults
  if (!localStorage.getItem(KEYS.defaults)) write(KEYS.defaults, { defaultCommission: 6 });

  // CRUD operations
  function registerUser({ email, name, role }) {
    const users = read(KEYS.users, []);
    if (!email || !name) return { error: 'Name and email required' };
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) return { error: 'Email already registered' };
    const u = { id: uid('u_'), email: email.toLowerCase(), name, role, createdAt: now() };
    users.push(u);
    write(KEYS.users, users);
    return { ok: true, user: u };
  }

  function loginUser(email) {
    const users = read(KEYS.users, []);
    const u = users.find(x => x.email.toLowerCase() === (email || '').toLowerCase());
    if (!u) return { error: 'User not found. Register first.' };
    setSession(u);
    return { ok: true, user: u };
  }

  function registerOrGetUserByEmail(email, name = 'Unknown', role = 'customer') {
    const users = read(KEYS.users, []);
    let u = users.find(x => x.email.toLowerCase() === (email || '').toLowerCase());
    if (!u) {
      u = { id: uid('u_'), email: (email||'').toLowerCase(), name, role, createdAt: now() };
      users.push(u);
      write(KEYS.users, users);
    }
    return u;
  }

  function addLead(referrerId, email, notes) {
    const leads = read(KEYS.leads, []);
    const lead = { id: uid('l_'), referrerId, email: (email || '').toLowerCase(), notes, status: 'new', createdAt: now(), convertedProjectId: null };
    leads.unshift(lead);
    write(KEYS.leads, leads);
    return lead;
  }

  function addProject(customerId, payload) {
    const projects = read(KEYS.projects, []);
    const defaults = readObj(KEYS.defaults, { defaultCommission: 6 });
    const p = {
      id: uid('p_'),
      customerId,
      createdAt: now(),
      location: payload.location || '—',
      plot: payload.plot || 0,
      budget: payload.budget || 0,
      materials: payload.materials || 'Standard',
      timeline: payload.timeline || 12,
      status: 'pending',
      verified: false,
      assignedContractor: null,
      referrerId: payload.referrerId || null,
      commissionPercent: Number(payload.commissionPercent ?? defaults.defaultCommission),
      stages: [
        { key: 'foundation', label: 'Foundation', done: false },
        { key: 'framing', label: 'Framing', done: false },
        { key: 'roof', label: 'Roof', done: false },
        { key: 'finishing', label: 'Finishing', done: false }
      ]
    };
    projects.unshift(p);
    write(KEYS.projects, projects);
    return p;
  }

  function updateProject(projectId, changes = {}) {
    const projects = read(KEYS.projects, []);
    const p = projects.find(x => x.id === projectId);
    if (!p) return null;
    Object.assign(p, changes);
    if (p.stages && p.stages.every(s => s.done)) p.status = 'completed';
    write(KEYS.projects, projects);
    return p;
  }

  function toggleStage(projectId, stageKey) {
    const projects = read(KEYS.projects, []);
    const p = projects.find(x => x.id === projectId);
    if (!p) return null;
    const s = p.stages.find(st => st.key === stageKey);
    if (s) s.done = !s.done;
    if (p.stages.every(st => st.done)) p.status = 'completed';
    write(KEYS.projects, projects);
    return p;
  }

  function convertLeadToProject(leadId, customerName, budget) {
    const leads = read(KEYS.leads, []);
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return { error: 'Lead not found' };
    // ensure customer user
    const cust = registerOrGetUserByEmail(lead.email, customerName, 'customer');
    const project = addProject(cust.id, { location: '(from lead)', budget, materials: 'TBD', timeline: 12, referrerId: lead.referrerId });
    lead.status = 'converted';
    lead.convertedProjectId = project.id;
    write(KEYS.leads, leads);
    return { ok: true, project };
  }

  function writeDefaults(obj) { write(KEYS.defaults, obj); }
  function setSessionExtern(u) { setSession(u); }
  function getSessionExtern() { return getSession(); }
  function clearAll() { localStorage.removeItem(KEYS.users); localStorage.removeItem(KEYS.projects); localStorage.removeItem(KEYS.leads); localStorage.removeItem(KEYS.defaults); sessionStorage.removeItem(KEYS.session); BC.postMessage({ type: 'cleared' }); }

  // Demo seed
  function seedDemo() {
    if (read(KEYS.users, []).length) return;
    const u1 = { id: uid('u_'), email: 'alice@ref.com', name: 'Alice Referrer', role: 'referrer', createdAt: now() };
    const u2 = { id: uid('u_'), email: 'bob@admin.com', name: 'Bob Admin', role: 'admin', createdAt: now() };
    const u3 = { id: uid('u_'), email: 'carl@cust.com', name: 'Carl Customer', role: 'customer', createdAt: now() };
    write(KEYS.users, [u1, u2, u3]);
    write(KEYS.leads, [{ id: uid('l_'), referrerId: u1.id, email: 'lead1@example.com', notes: 'Interested in 3BHK', status: 'new', createdAt: now(), convertedProjectId: null }]);
    write(KEYS.projects, [{
      id: uid('p_'),
      customerId: u3.id,
      createdAt: now(),
      location: 'Greenhill Estate',
      plot: 120,
      budget: 42000,
      materials: 'Premium',
      timeline: 16,
      status: 'pending',
      verified: false,
      assignedContractor: null,
      referrerId: u1.id,
      commissionPercent: 7,
      stages: [{ key:'foundation',label:'Foundation',done:true }, { key:'framing',label:'Framing',done:false }, { key:'roof',label:'Roof',done:false }, { key:'finishing',label:'Finishing',done:false }]
    }]);
  }

  // Expose read-only helpers too
  return {
    read, write, readObj, uid, now, registerUser, loginUser, addLead, addProject, updateProject,
    toggleStage, convertLeadToProject, writeDefaults, setSession: setSessionExtern, getSession: getSessionExtern,
    clearSession, clearAll, seedDemo, registerOrGetUserByEmail, KEYS
  };
})();

// keep BC messages consumable by app.js
BC.onmessage = (ev) => {
  // listeners in app.js will subscribe to BroadcastChannel too
};
