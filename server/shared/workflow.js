// The AICTE approval pipeline as a state machine, modelled on the Approval
// Process Handbook: scrutiny -> (deficiency -> re-scrutiny) -> EVC -> EC ->
// decision, with SAC (appeal) and SHC (hearing) as side tracks.
// Each stage has an SLA; time spent beyond it is "pendency".

const STAGES = {
  SUBMITTED:    { label: 'Submitted',              short: 'Submitted',  sla_days: 3,  owner: 'Officer',     order: 1, color: '#0a66c2' },
  SCRUTINY:     { label: 'Scrutiny',               short: 'Scrutiny',   sla_days: 15, owner: 'Officer',     order: 2, color: '#5b4fd6' },
  DEFICIENCY:   { label: 'Deficiency Response',    short: 'Deficiency', sla_days: 15, owner: 'Institution', order: 3, color: '#a85d00' },
  RESCRUTINY:   { label: 'Re-Scrutiny',            short: 'Re-Scrut.',  sla_days: 10, owner: 'Officer',     order: 4, color: '#7c3aed' },
  EVC:          { label: 'Expert Visit Committee', short: 'EVC',        sla_days: 21, owner: 'Expert',      order: 5, color: '#b8327f' },
  EC_REVIEW:    { label: 'Executive Committee',    short: 'EC',         sla_days: 10, owner: 'Admin',       order: 6, color: '#c96442' },
  SAC:          { label: 'Standing Appellate Committee', short: 'SAC',  sla_days: 30, owner: 'Admin',       order: 7, color: '#c2410c' },
  SHC:          { label: 'Standing Hearing Committee',   short: 'SHC',  sla_days: 30, owner: 'Admin',       order: 8, color: '#c4141b' },
  APPROVED:     { label: 'Approved (LoA)',         short: 'Approved',   sla_days: null, owner: null, order: 9,  color: '#057642', terminal: true },
  CONDITIONAL:  { label: 'Conditionally Approved', short: 'Conditional',sla_days: null, owner: null, order: 9,  color: '#0f766e', terminal: true },
  REJECTED:     { label: 'Rejected (LoR)',         short: 'Rejected',   sla_days: null, owner: null, order: 9,  color: '#c4141b', terminal: true },
  WITHDRAWN:    { label: 'Withdrawn',              short: 'Withdrawn',  sla_days: null, owner: null, order: 9,  color: '#6b6a65', terminal: true },
};

// The main line shown in the stage tracker
const MAIN_TRACK = ['SUBMITTED', 'SCRUTINY', 'EVC', 'EC_REVIEW', 'APPROVED'];

const OFFICE = ['Admin', 'Officer'];

// from -> allowed moves. `roles` gates who may press the button.
const TRANSITIONS = {
  SUBMITTED:  [
    { to: 'SCRUTINY',   label: 'Start Scrutiny',          roles: OFFICE },
    { to: 'WITHDRAWN',  label: 'Withdraw',                roles: ['Institution', 'Admin'] },
  ],
  SCRUTINY: [
    { to: 'EVC',        label: 'Clear Scrutiny → EVC',     roles: OFFICE },
    { to: 'DEFICIENCY', label: 'Raise Deficiency',         roles: OFFICE },
    { to: 'EC_REVIEW',  label: 'Skip EVC → EC (EoA)',      roles: OFFICE, hint: 'Extension of Approval without site change', when: app => app.type === 'Extension of Approval' },
    { to: 'REJECTED',   label: 'Reject at Scrutiny',       roles: ['Admin'] },
  ],
  DEFICIENCY: [
    { to: 'RESCRUTINY', label: 'Submit Response for Re-Scrutiny', roles: ['Institution', ...OFFICE] },
    { to: 'REJECTED',   label: 'Reject (No Response)',     roles: ['Admin'] },
  ],
  RESCRUTINY: [
    { to: 'EVC',        label: 'Clear Re-Scrutiny → EVC',  roles: OFFICE },
    { to: 'DEFICIENCY', label: 'Deficiency Persists',      roles: OFFICE },
    { to: 'REJECTED',   label: 'Reject',                   roles: ['Admin'] },
  ],
  EVC: [
    { to: 'EC_REVIEW',  label: 'EVC Report Accepted → EC', roles: [...OFFICE, 'Expert'] },
    { to: 'DEFICIENCY', label: 'EVC Found Deficiencies',   roles: [...OFFICE, 'Expert'] },
  ],
  EC_REVIEW: [
    { to: 'APPROVED',   label: 'Grant LoA',                roles: ['Admin'] },
    { to: 'CONDITIONAL',label: 'Approve with Undertakings',roles: ['Admin'] },
    { to: 'REJECTED',   label: 'Issue LoR (Reject)',       roles: ['Admin'] },
  ],
  REJECTED: [
    // One appeal, within 30 days of the LoR (as the letter itself says).
    { to: 'SAC',        label: 'File Appeal to SAC',       roles: ['Institution', 'Admin'],
      when: app => !(app.transitions || []).some(t => t.to_stage === 'SAC') && daysBetween(app.stage_entered_at) <= 30 },
  ],
  SAC: [
    { to: 'EVC',        label: 'SAC: Order Re-Visit',      roles: ['Admin'] },
    { to: 'SHC',        label: 'Refer to SHC Hearing',     roles: ['Admin'] },
    { to: 'APPROVED',   label: 'SAC: Approve',             roles: ['Admin'] },
    { to: 'CONDITIONAL',label: 'SAC: Approve with Undertakings', roles: ['Admin'] },
    { to: 'REJECTED',   label: 'SAC: Uphold Rejection',    roles: ['Admin'] },
  ],
  SHC: [
    { to: 'CONDITIONAL',label: 'SHC: Allow with Undertakings', roles: ['Admin'] },
    { to: 'REJECTED',   label: 'SHC: Reject',              roles: ['Admin'] },
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

function allowedTransitions(app, user) {
  const moves = TRANSITIONS[app.stage] || [];
  return moves.filter(m => m.roles.includes(user.role) && (!m.when || m.when(app)));
}

function isTerminal(stage) {
  return !!(STAGES[stage] && STAGES[stage].terminal);
}

const ACTIVE_STAGES = Object.keys(STAGES).filter(s => !STAGES[s].terminal);

module.exports = { STAGES, TRANSITIONS, MAIN_TRACK, STATUS_FOR_STAGE, ACTIVE_STAGES, slaInfo, allowedTransitions, isTerminal, daysBetween, DAY };
