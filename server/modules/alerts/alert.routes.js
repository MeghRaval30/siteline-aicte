const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const logActivity = require('../../shared/logActivity');
const { instScope, ok, fail, h } = require('../../shared/scope');
const { TRIGGERS, runAll, matches } = require('./engine');
const { compile } = require('./compiler');

const router = express.Router();
router.use(authenticate);

router.get('/triggers', h(async (req, res) => ok(res, TRIGGERS)));

router.get('/', h(async (req, res) => {
  const { status, severity, rule_id, institution_id } = req.query;
  const where = { AND: [] };
  if (req.user.role !== 'Admin') where.AND.push({ institution: instScope(req.user) });
  if (status) where.AND.push({ status: { in: status.split(',') } });
  if (severity) where.AND.push({ severity: { in: severity.split(',') } });
  if (rule_id) where.AND.push({ rule_id: Number(rule_id) });
  if (institution_id) where.AND.push({ institution_id: Number(institution_id) });
  const alerts = await prisma.alert.findMany({
    where, include: { rule: { select: { id: true, name: true, trigger: true } }, institution: { select: { id: true, name: true, aicte_id: true } } },
    orderBy: [{ fired_at: 'desc' }], take: Number(req.query.limit) || 300,
  });
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  alerts.sort((a, b) => (a.status === 'Open' ? 0 : 1) - (b.status === 'Open' ? 0 : 1) || order[a.severity] - order[b.severity]);
  ok(res, alerts);
}));

router.patch('/:id/acknowledge', h(async (req, res) => {
  const a = await prisma.alert.update({ where: { id: Number(req.params.id) }, data: { status: 'Acknowledged', acknowledged_by: req.user.name, acknowledged_at: new Date() } });
  await logActivity({ actorUserId: req.user.id, action: `Acknowledged alert: ${a.title}`, entityType: 'Alert', entityId: a.id });
  ok(res, a);
}));

router.patch('/:id/resolve', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const a = await prisma.alert.update({ where: { id: Number(req.params.id) }, data: { status: 'Resolved', resolved_at: new Date(), acknowledged_by: req.user.name } });
  ok(res, a);
}));

// ---------- rules ----------
router.get('/rules', h(async (req, res) => {
  const rules = await prisma.alertRule.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { alerts: { where: { status: { not: 'Resolved' } } } } } } });
  ok(res, rules.map(r => ({ ...r, params: JSON.parse(r.params), criteria: JSON.parse(r.criteria), open_alerts: r._count.alerts, trigger_label: TRIGGERS[r.trigger]?.label })));
}));

router.post('/rules/compile', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  if (!req.body.text) return fail(res, 400, 'Describe the rule in a sentence');
  const out = await compile(req.body.text);
  if (out.ok) {
    // Show the live count before anyone saves it.
    const preview = await matches({ trigger: out.proposal.trigger, params: JSON.stringify(out.proposal.params), criteria: JSON.stringify(out.proposal.criteria) });
    out.would_match = preview.length;
    out.sample = preview.slice(0, 5).map(p => p.title);
  }
  ok(res, out);
}));

router.post('/rules', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const { name, trigger, params = {}, criteria = {}, severity = 'Medium', notify_roles = 'Admin,Officer', notify_institution = true, nl_prompt } = req.body;
  if (!TRIGGERS[trigger]) return fail(res, 400, 'Unknown trigger');
  const rule = await prisma.alertRule.create({ data: { name: name || TRIGGERS[trigger].label, trigger, params: JSON.stringify(params), criteria: JSON.stringify(criteria), severity, notify_roles, notify_institution, nl_prompt: nl_prompt || null } });
  await logActivity({ actorUserId: req.user.id, action: `Created alert rule "${rule.name}"`, entityType: 'AlertRule', entityId: rule.id });
  const run = await runAll({ ruleId: rule.id });
  ok(res, { rule, run });
}));

router.patch('/rules/:id', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const data = {};
  for (const k of ['name', 'severity', 'active', 'notify_roles', 'notify_institution']) if (req.body[k] !== undefined) data[k] = req.body[k];
  if (req.body.params) data.params = JSON.stringify(req.body.params);
  if (req.body.criteria) data.criteria = JSON.stringify(req.body.criteria);
  const rule = await prisma.alertRule.update({ where: { id: Number(req.params.id) }, data });
  ok(res, rule);
}));

router.delete('/rules/:id', requireRole(['Admin']), h(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.alert.deleteMany({ where: { rule_id: id } });
  await prisma.alertRule.delete({ where: { id } });
  ok(res, { deleted: id });
}));

router.post('/run', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const out = await runAll({ ruleId: req.body.rule_id ? Number(req.body.rule_id) : undefined });
  await logActivity({ actorUserId: req.user.id, action: 'Ran alert rules manually', entityType: 'AlertRule' });
  ok(res, out);
}));

module.exports = router;
