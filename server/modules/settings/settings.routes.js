const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const logActivity = require('../../shared/logActivity');
const { STAGES, DEFAULT_SLA, loadSlaOverrides } = require('../../shared/workflow');
const { ok, fail, h } = require('../../shared/scope');
const { runAll } = require('../alerts/engine');

const router = express.Router();
router.use(authenticate);

const view = rows => Object.entries(DEFAULT_SLA).filter(([, d]) => d != null).map(([stage, def]) => {
  const o = rows.find(r => r.stage === stage);
  return { stage, label: STAGES[stage].label, owner: STAGES[stage].owner, default_days: def, days: STAGES[stage].sla_days, updated_by: o?.updated_by || null, updated_at: o?.updated_at || null };
});

router.get('/sla', h(async (req, res) => ok(res, view(await loadSlaOverrides(prisma)))));

// Body: { SCRUTINY: 20, EVC: 30, ... }. A value equal to the default removes the override.
router.put('/sla', requireRole(['Admin']), h(async (req, res) => {
  const changes = [];
  for (const [stage, raw] of Object.entries(req.body || {})) {
    if (DEFAULT_SLA[stage] == null) return fail(res, 400, `${stage} has no SLA`);
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 365) return fail(res, 400, `${STAGES[stage].label}: SLA must be a whole number of days between 1 and 365`);
    if (days === DEFAULT_SLA[stage]) await prisma.stageSla.deleteMany({ where: { stage } });
    else await prisma.stageSla.upsert({ where: { stage }, create: { stage, days, updated_by: req.user.name }, update: { days, updated_by: req.user.name } });
    if (days !== STAGES[stage].sla_days) changes.push(`${STAGES[stage].label} ${STAGES[stage].sla_days}→${days}d`);
  }
  await loadSlaOverrides(prisma);
  if (changes.length) await logActivity({ actorUserId: req.user.id, action: `Changed stage SLAs: ${changes.join(', ')}`, entityType: 'Settings' });
  // Pendency and SLA-breach alerts follow the new limits straight away.
  const run = await runAll();
  ok(res, { stages: view(await prisma.stageSla.findMany()), changed: changes, alerts_raised: run.results?.reduce((t, r) => t + r.created, 0) || 0, alerts_resolved: run.results?.reduce((t, r) => t + r.auto_resolved, 0) || 0 });
}));

// ---------- APH processing routes per category (Table-2.3) ----------
const { routes, loadRoutes, validateStages, CATEGORY_ROUTE } = require('../../shared/routes');

router.get('/routes', h(async (req, res) => {
  await loadRoutes(prisma);
  ok(res, { routes: Object.values(routes()), categories: CATEGORY_ROUTE });
}));

// A changed route applies to new applications only; cases in flight keep the version they were submitted under.
router.put('/routes/:code', requireRole(['Admin']), h(async (req, res) => {
  const current = routes()[req.params.code];
  if (!current) return fail(res, 404, 'Unknown route');
  const err = validateStages(req.body.stages);
  if (err) return fail(res, 400, err);
  if (!req.body.reason) return fail(res, 400, 'Record the reason for changing the route (e.g. the APH amendment)');
  const row = await prisma.routeTemplate.upsert({
    where: { code: current.code },
    create: { code: current.code, name: req.body.name || current.name, stages: JSON.stringify(req.body.stages), clause: req.body.clause || current.clause, version: current.version + 1, updated_by: req.user.name },
    update: { name: req.body.name || current.name, stages: JSON.stringify(req.body.stages), clause: req.body.clause || current.clause, version: current.version + 1, updated_by: req.user.name },
  });
  await loadRoutes(prisma);
  await logActivity({ actorUserId: req.user.id, action: `Changed route ${row.code} to ${req.body.stages.join(' → ')} (v${row.version}): ${req.body.reason}`, entityType: 'Settings' });
  ok(res, routes()[row.code]);
}));

module.exports = router;
