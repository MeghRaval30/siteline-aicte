const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const notify = require('../../shared/notify');
const logActivity = require('../../shared/logActivity');
const { STAGES, slaInfo } = require('../../shared/workflow');
const { institutionScores } = require('../../shared/compliance');
const { instScope, ok, fail, h } = require('../../shared/scope');

const router = express.Router();
router.use(authenticate);

router.get('/regions', h(async (req, res) => {
  const regions = await prisma.region.findMany({ include: { _count: { select: { institutions: true } } }, orderBy: { name: 'asc' } });
  ok(res, regions);
}));

router.get('/', h(async (req, res) => {
  const { search, region, type, grade, status } = req.query;
  const where = { AND: [instScope(req.user)] };
  if (search) where.AND.push({ OR: [{ name: { contains: search } }, { aicte_id: { contains: search } }, { city: { contains: search } }] });
  if (region) where.AND.push({ region: { code: region } });
  if (type) where.AND.push({ type });
  if (status) where.AND.push({ status });
  let rows = await institutionScores(where);
  if (grade) rows = rows.filter(r => r.grade === grade);
  rows.sort((a, b) => a.score - b.score);
  ok(res, rows.map(({ inst, score, grade: g, risk, reasons }) => ({
    id: inst.id, aicte_id: inst.aicte_id, name: inst.name, type: inst.type, ownership: inst.ownership, city: inst.city, state: inst.state,
    region: inst.region, status: inst.status, approved_intake: inst.approved_intake,
    score, grade: g, risk, top_reasons: reasons.slice(0, 3),
    active_applications: inst.applications.filter(a => !STAGES[a.stage].terminal).length,
    open_alerts: inst.alerts.length,
  })));
}));

router.get('/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await institutionScores({ AND: [{ id }, instScope(req.user)] });
  if (!row) return fail(res, 404, 'Institution not found');
  const { inst } = row;
  const users = await prisma.user.findMany({ where: { institution_id: id }, select: { id: true, name: true, email: true, designation: true } });
  ok(res, {
    ...inst,
    applications: inst.applications.map(a => ({ ...a, sla: slaInfo(a), stage_label: STAGES[a.stage].label })),
    documents: inst.documents.filter(d => d.status !== 'Superseded').sort((a, b) => (a.valid_to || 0) - (b.valid_to || 0)),
    users,
    compliance: { score: row.score, grade: row.grade, risk: row.risk, reasons: row.reasons },
  });
}));

// Mass action (from odoo_2026): send each selected institution a digest of its open gaps.
router.post('/remind', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const ids = (req.body.ids || []).map(Number);
  const where = ids.length ? { id: { in: ids } } : req.body.grade ? {} : { id: -1 };
  let rows = await institutionScores({ AND: [where, instScope(req.user)] });
  if (req.body.grade) rows = rows.filter(r => r.grade === req.body.grade);
  let sent = 0;
  for (const r of rows) {
    if (!r.reasons.length) continue;
    const users = await prisma.user.findMany({ where: { institution_id: r.inst.id } });
    const msg = `Compliance reminder from AICTE (score ${r.score}/100, grade ${r.grade}): ${r.reasons.slice(0, 3).map(x => x.reason).join('; ')}`;
    for (const u of users) { await notify({ userId: u.id, type: 'REMINDER', message: msg, relatedEntityType: 'Institution', relatedEntityId: r.inst.id }); sent++; }
  }
  await logActivity({ actorUserId: req.user.id, action: `Sent compliance reminders to ${rows.length} institution(s)`, entityType: 'Institution' });
  ok(res, { institutions: rows.length, notifications: sent });
}));

module.exports = router;
