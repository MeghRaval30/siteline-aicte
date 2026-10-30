// The AICTE approval pipeline as a state machine, modelled on the Approval
// Process Handbook 2024-27. Which forward stages an application passes through
// depends on its category (Table-2.3; see shared/routes.js). Around that route:
// deficiency ⇄ re-scrutiny, the SHC compliance hearing before the Executive
// Committee (2.23.3), and one SAC appeal within 7 days of the decision (1.11(a), 2.24(a)).
// Each stage has an SLA; time spent beyond it is "pendency".

const { routeFor, nextStage } = require('./routes');

const STAGES = {
  SUBMITTED:    { label: 'Submitted',              short: 'Submitted',  sla_days: 3,  owner: 'Officer',     order: 1, color: '#0a66c2' },
  SCRUTINY:     { label: 'Scrutiny',               short: 'Scrutiny',   sla_days: 15, owner: 'Officer',     order: 2, color: '#5b4fd6' },
  DEFICIENCY:   { label: 'Deficiency Response',    short: 'Deficiency', sla_days: 15, owner: 'Institution', order: 3, color: '#a85d00' },
  RESCRUTINY:   { label: 'Re-Scrutiny',            short: 'Re-Scrut.',  sla_days: 10, owner: 'Officer',     order: 4, color: '#7c3aed' },
  EVC:          { label: 'Expert Visit Committee', short: 'EVC',        sla_days: 21, owner: 'Expert',      order: 5, color: '#b8327f' },
  SHC:          { label: 'Standing Hearing Committee', short: 'SHC',    sla_days: 15, owner: 'Admin',       order: 6, color: '#9f1239' },
  EC_REVIEW:    { label: 'Executive Committee',    short: 'EC',         sla_days: 10, owner: 'Admin',       order: 7, color: '#c96442' },
  SAC:          { label: 'Standing Appellate Committee', short: 'SAC',  sla_days: 30, owner: 'Admin',       order: 8, color: '#c2410c' },
  APPROVED:     { label: 'Approved (LoA)',         short: 'Approved',   sla_days: null, owner: null, order: 9,  color: '#057642', terminal: true },
  CONDITIONAL:  { label: 'Conditionally Approved', short: 'Conditional',sla_days: null, owner: null, order: 9,  color: '#0f766e', terminal: true },
  REJECTED:     { label: 'Rejected (LoR)',         short: 'Rejected',   sla_days: null, owner: null, order: 9,  color: '#c4141b', terminal: true },
  WITHDRAWN:    { label: 'Withdrawn',              short: 'Withdrawn',  sla_days: null, owner: null, order: 9,  color: '#6b6a65', terminal: true },
};

// The main line shown in the stage tracker (the per-case tracker uses the case's own route)
const MAIN_TRACK = ['SUBMITTED', 'SCRUTINY', 'EVC', 'EC_REVIEW', 'APPROVED'];

const OFFICE = ['Admin', 'Officer'];
const APPEAL_DAYS = 7; // APH 1.11(a), 2.24(a)

const forwardLabel = to => ({ SCRUTINY: 'Start Scrutiny', EVC: 'Clear Scrutiny → EVC', SHC: 'Refer to SHC hearing', EC_REVIEW: 'Send to Executive Committee' }[to] || `Move to ${STAGES[to].label}`);

// from -> allowed moves. `to: 'NEXT'` resolves to the next stage on the application's route.
// `roles` gates who may press the button; `when` adds APH conditions; `clause` cites the rule.
const TRANSITIONS = {
  SUBMITTED: [
    { to: 'NEXT',       roles: OFFICE, clause: 'APH Table-2.3' },
    { to: 'WITHDRAWN',  label: 'Withdraw', roles: ['Institution', 'Admin'] },
  ],
  SCRUTINY: [
    { to: 'NEXT',       roles: OFFICE, clause: 'APH 1.8, Table-2.3' },
    { to: 'DEFICIENCY', label: 'Raise Deficiency', roles: OFFICE, clause: 'APH 1.8' },
    { to: 'SHC',        label: 'Refer to SHC hearing', roles: OFFICE, clause: 'APH 2.23.3' },
    { to: 'REJECTED',   label: 'Reject at Scrutiny', roles: ['Admin'] },
  ],
  DEFICIENCY: [
    { to: 'RESCRUTINY', label: 'Submit Response for Re-Scrutiny', roles: ['Institution', ...OFFICE], clause: 'APH 1.8' },
    { to: 'REJECTED',   label: 'Reject (No Response)', roles: ['Admin'] },
  ],
  RESCRUTINY: [
    { to: 'NEXT',       roles: OFFICE, clause: 'APH 1.8 (re-scrutiny checks only the flagged deficiencies)' },
    { to: 'DEFICIENCY', label: 'Deficiency Persists', roles: OFFICE },
    { to: 'SHC',        label: 'Refer to SHC hearing', roles: OFFICE, clause: 'APH 2.23.3' },
    { to: 'REJECTED',   label: 'Reject', roles: ['Admin'] },
  ],
  EVC: [
    { to: 'NEXT',       roles: [...OFFICE, 'Expert'], clause: 'APH 1.9' },
    { to: 'DEFICIENCY', label: 'EVC Found Deficiencies', roles: [...OFFICE, 'Expert'], clause: 'APH 1.9' },
    { to: 'SHC',        label: 'Refer to SHC hearing', roles: OFFICE, clause: 'APH 2.23.3' },
  ],
  SHC: [
    { to: 'EC_REVIEW',  label: 'SHC recommendation → EC', roles: ['Admin'], clause: 'APH 2.23.3' },
    { to: 'DEFICIENCY', label: 'SHC: compliance still short', roles: ['Admin'], clause: 'APH 2.23.3' },
  ],
  EC_REVIEW: [
    { to: 'APPROVED',   label: 'Grant LoA', roles: ['Admin'] },
    { to: 'CONDITIONAL',label: 'Approve with Undertakings', roles: ['Admin'] },
    { to: 'REJECTED',   label: 'Issue LoR (Reject)', roles: ['Admin'] },
  ],
  REJECTED: [
    // One appeal, within 7 days of the decision being uploaded.
    { to: 'SAC',        label: 'File Appeal to SAC', roles: ['Institution', 'Admin'], clause: 'APH 1.11(a), 2.24(a)',
      when: app => !(app.transitions || []).some(t => t.to_stage === 'SAC') && daysBetween(app.stage_entered_at) <= APPEAL_DAYS },
  ],
  SAC: [
    { to: 'SCRUTINY',   label: 'SAC: Remand to Scrutiny', roles: ['Admin'], clause: 'APH 2.24' },
    { to: 'EVC',        label: 'SAC: Remand to EVC', roles: ['Admin'], clause: 'APH 2.24', when: app => routeFor(app).stages.includes('EVC') },
    { to: 'APPROVED',   label: 'SAC: Approve', roles: ['Admin'] },
    { to: 'CONDITIONAL',label: 'SAC: Approve with Undertakings', roles: ['Admin'] },
    { to: 'REJECTED',   label: 'SAC: Uphold Rejection', roles: ['Admin'] },
  ],
  APPROVED: [], CONDITIONAL: [], WITHDRAWN: [],
};

const STATUS_FOR_STAGE = {
  APPROVED: 'Approved', CONDITIONAL: 'Conditionally Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn',
};

const DAY = 24 * 60 * 60 * 1000;

function daysBetween(a, b = new Date()) {
  return Math.max(0, Math.floor((new Date(b) - new Date(a)) / DAY));
}

// SLA view of an application's current stage
function slaInfo(app, now = new Date()) {
  const stage = STAGES[app.stage] || {};
  const days = daysBetween(app.stage_entered_at, now);
  if (!stage.sla_days) return { days, sla_days: null, remaining: null, breached: false, pct: 0 };
  return {
    days,
    sla_days: stage.sla_days,
    remaining: stage.sla_days - days,
    breached: days > stage.sla_days,
    pct: Math.min(100, Math.round((days / stage.sla_days) * 100)),
  };
}

// Concrete moves for this application: 'NEXT' becomes the next stage on its route.
function resolveMoves(app) {
  const out = [];
  for (const m of TRANSITIONS[app.stage] || []) {
    if (m.to !== 'NEXT') { out.push(m); continue; }
    const to = nextStage(app);
    if (to) out.push({ ...m, to, label: forwardLabel(to), route: routeFor(app).code });
  }
  return out;
}

function allowedTransitions(app, user) {
  return resolveMoves(app).filter(m => m.roles.includes(user.role) && (!m.when || m.when(app)));
}

function isTerminal(stage) {
  return !!(STAGES[stage] && STAGES[stage].terminal);
}

const ACTIVE_STAGES = Object.keys(STAGES).filter(s => !STAGES[s].terminal);

// Admin-set SLAs live in the StageSla table. They are applied onto STAGES in
// place, so every reader (dashboards, alerts, AI tools) sees the same numbers.
const DEFAULT_SLA = Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [k, v.sla_days]));
async function loadSlaOverrides(prisma) {
  const rows = await prisma.stageSla.findMany();
  for (const [stage, days] of Object.entries(DEFAULT_SLA)) STAGES[stage].sla_days = days;
  for (const r of rows) if (STAGES[r.stage] && DEFAULT_SLA[r.stage] != null) STAGES[r.stage].sla_days = r.days;
  return rows;
}

module.exports = { STAGES, TRANSITIONS, APPEAL_DAYS, resolveMoves, MAIN_TRACK, STATUS_FOR_STAGE, ACTIVE_STAGES, DEFAULT_SLA, loadSlaOverrides, slaInfo, allowedTransitions, isTerminal, daysBetween, DAY };
