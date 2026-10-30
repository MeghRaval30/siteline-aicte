const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const logActivity = require('../../shared/logActivity');
const { TRACK_LABEL } = require('../../shared/escalation');
const { ok, fail, h } = require('../../shared/scope');

const router = express.Router();
router.use(authenticate, requireRole(['Admin', 'Officer']));

// Officers see their Regional Office's escalations; the Bureau sees all.
const scope = user => (user.role === 'Officer' && user.region_id ? { region_id: user.region_id } : {});

router.get('/', h(async (req, res) => {
  const where = { AND: [scope(req.user)] };
  if (req.query.open !== '0') where.AND.push({ closed_at: null });
  if (req.query.track) where.AND.push({ track: req.query.track });
  if (req.query.level) where.AND.push({ level: Number(req.query.level) });
  if (req.query.mine === '1') where.AND.push({ target_role: req.user.role });
  const rows = await prisma.escalation.findMany({ where, orderBy: [{ level: 'desc' }, { days_overdue: 'desc' }], take: 500 });
  const summary = { open: rows.filter(r => !r.closed_at).length, unacknowledged: rows.filter(r => !r.closed_at && !r.ack_at).length, by_level: {} };
  for (const r of rows) if (!r.closed_at) summary.by_level[r.level] = (summary.by_level[r.level] || 0) + 1;
  ok(res, rows.map(r => ({ ...r, track_label: TRACK_LABEL[r.track] || r.track })), { meta: summary });
}));

router.get('/policies', h(async (req, res) => {
  ok(res, await prisma.escalationPolicy.findMany({ orderBy: [{ track: 'asc' }, { level: 'asc' }] }));
}));

// The Bureau tunes the ladder: days before each level and the acknowledgement window.
router.put('/policies/:id', requireRole(['Admin']), h(async (req, res) => {
  const { after_days, ack_hours, target_label, active } = req.body;
  const data = {};
  if (after_days != null) { if (!Number.isInteger(Number(after_days)) || after_days < 0 || after_days > 365) return fail(res, 400, 'Days must be between 0 and 365'); data.after_days = Number(after_days); }
  if (ack_hours != null) { if (!(ack_hours >= 1 && ack_hours <= 720)) return fail(res, 400, 'Acknowledgement window must be 1 to 720 hours'); data.ack_hours = Number(ack_hours); }
  if (target_label) data.target_label = String(target_label).slice(0, 80);
  if (active != null) data.active = !!active;
  const p = await prisma.escalationPolicy.update({ where: { id: Number(req.params.id) }, data });
  await logActivity({ actorUserId: req.user.id, action: `Changed escalation ladder ${p.track} L${p.level}`, entityType: 'EscalationPolicy', entityId: p.id, metadata: data });
  ok(res, p);
}));

// Acknowledge: the authority records what is being done and by when (CPGRAMS-style interim reply).
router.patch('/:id/ack', h(async (req, res) => {
  const e = await prisma.escalation.findFirst({ where: { AND: [{ id: Number(req.params.id) }, scope(req.user)] } });
  if (!e) return fail(res, 404, 'Escalation not found');
  if (e.closed_at) return fail(res, 400, 'This escalation is already closed');
  if (e.ack_at) return fail(res, 400, 'Already acknowledged');
  if (req.user.role !== e.target_role) return fail(res, 403, `This escalation is for the ${e.target_label}`);
  const { note, promised_date } = req.body;
  if (!note || String(note).trim().length < 5) return fail(res, 400, 'Say what action is being taken');
  if (!promised_date || isNaN(new Date(promised_date)) || new Date(promised_date) < new Date(new Date().toDateString())) return fail(res, 400, 'Give a promised date (today or later)');
  const upd = await prisma.escalation.update({ where: { id: e.id }, data: { ack_at: new Date(), ack_by: req.user.name, ack_note: String(note).slice(0, 500), promised_date: new Date(promised_date) } });
  await logActivity({ actorUserId: req.user.id, action: `Acknowledged escalation L${e.level} (${e.title}): ${note}`, entityType: 'Escalation', entityId: e.id, metadata: { promised_date } });
  ok(res, upd);
}));

module.exports = router;
