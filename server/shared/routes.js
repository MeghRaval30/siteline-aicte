// Processing routes per application category, after APH 2024-27 Table-2.3
// (clause 2.23.4) and Chapter I for new institutions. A route lists the forward
// stages an application of that category passes through; loops (deficiency ⇄
// re-scrutiny), the SHC compliance hearing and the SAC appeal sit outside the
// route and are always available where the APH allows them.
//
// Routes are data: the Approval Bureau can edit them (RouteTemplate table), and
// each application pins the route version it was submitted under.

const DEFAULT_ROUTES = [
  { code: 'SELF_DISCLOSURE', name: 'Self-disclosure (no Scrutiny, no EVC)', stages: ['SUBMITTED', 'EC_REVIEW'], clause: 'APH Table-2.3: EoA by self-disclosure, NRI seats' },
  { code: 'SCRUTINY_ONLY', name: 'Scrutiny only', stages: ['SUBMITTED', 'SCRUTINY', 'EC_REVIEW'], clause: 'APH Table-2.3: change of name, closure, intake reduction, FN/OCI seats' },
  { code: 'SCRUTINY_EVC', name: 'Scrutiny + EVC', stages: ['SUBMITTED', 'SCRUTINY', 'EVC', 'EC_REVIEW'], clause: 'APH Table-2.3: new programme, intake increase, change of site, merger, conversion' },
  { code: 'NEW_INSTITUTION', name: 'New institution: Scrutiny + EVC', stages: ['SUBMITTED', 'SCRUTINY', 'EVC', 'EC_REVIEW'], clause: 'APH 1.8 to 1.11: new institutions' },
];

// Application category → route (APH Table-2.3)
const CATEGORY_ROUTE = {
  'New Institution': 'NEW_INSTITUTION',
  'Extension of Approval': 'SELF_DISCLOSURE',
  'NRI Seats': 'SELF_DISCLOSURE',
  'Increase in Intake': 'SCRUTINY_EVC',
  'New Course': 'SCRUTINY_EVC',
  'Change of Site': 'SCRUTINY_EVC',
  'Merger of Institutions': 'SCRUTINY_EVC',
  'Conversion Diploma/Degree': 'SCRUTINY_EVC',
  'Restoration after Break': 'SCRUTINY_EVC',
  'Change of Name': 'SCRUTINY_ONLY',
  'Closure': 'SCRUTINY_ONLY',
  'Intake Reduction': 'SCRUTINY_ONLY',
  'FN/OCI Seats': 'SCRUTINY_ONLY',
};

// Order of forward stages; loops and side tracks sit between them.
const FORWARD_ORDER = { SUBMITTED: 1, SCRUTINY: 2, DEFICIENCY: 2, RESCRUTINY: 2, EVC: 3, SHC: 4, EC_REVIEW: 5 };

let cache = null; // code -> { code, name, stages, clause, version }

async function loadRoutes(prisma) {
  const rows = await prisma.routeTemplate.findMany();
  const map = Object.fromEntries(DEFAULT_ROUTES.map(r => [r.code, { ...r, version: 1 }]));
  for (const r of rows) map[r.code] = { code: r.code, name: r.name, clause: r.clause, version: r.version, stages: JSON.parse(r.stages) };
  cache = map;
  return map;
}

function routes() { return cache || Object.fromEntries(DEFAULT_ROUTES.map(r => [r.code, { ...r, version: 1 }])); }

function routeFor(app) {
  const all = routes();
  return all[app.route_code] || all[CATEGORY_ROUTE[app.type]] || all.SCRUTINY_EVC;
}

// The next forward stage on the application's route after `stage`.
function nextStage(app, stage = app.stage) {
  const here = FORWARD_ORDER[stage] ?? 0;
  return routeFor(app).stages.find(s => (FORWARD_ORDER[s] ?? 99) > here) || null;
}

function validateStages(stages) {
  if (!Array.isArray(stages) || stages[0] !== 'SUBMITTED' || stages[stages.length - 1] !== 'EC_REVIEW') return 'A route must start at Submitted and end at the Executive Committee';
  const allowed = ['SUBMITTED', 'SCRUTINY', 'EVC', 'SHC', 'EC_REVIEW'];
  if (stages.some(s => !allowed.includes(s))) return `Stages must be among ${allowed.join(', ')}`;
  if (new Set(stages).size !== stages.length) return 'A stage can appear only once';
  for (let i = 1; i < stages.length; i++) if (FORWARD_ORDER[stages[i]] <= FORWARD_ORDER[stages[i - 1]]) return 'Stages must follow the APH order';
  return null;
}

module.exports = { DEFAULT_ROUTES, CATEGORY_ROUTE, FORWARD_ORDER, loadRoutes, routes, routeFor, nextStage, validateStages };
