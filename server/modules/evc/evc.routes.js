const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const notify = require('../../shared/notify');
const logActivity = require('../../shared/logActivity');
const { DAY } = require('../../shared/workflow');
const { appScope, isOffice, ok, fail, h } = require('../../shared/scope');

const router = express.Router();
router.use(authenticate);

const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = d => ({ gte: dayStart(d), lt: new Date(dayStart(d).getTime() + DAY) });
const visitInclude = {
  application: { include: { institution: { include: { region: true } } } },
  members: { include: { user: { select: { id: true, name: true, state: true, specialization: true, designation: true } } } },
};

router.get('/', h(async (req, res) => {
  const { status, mine, from, to } = req.query;
  const where = { AND: [{ application: appScope(req.user) }] };
  if (status) where.AND.push({ status: { in: status.split(',') } });
  if (mine === '1' || req.user.role === 'Expert') where.AND.push({ members: { some: { user_id: req.user.id } } });
  if (from) where.AND.push({ visit_date: { gte: new Date(from) } });
  if (to) where.AND.push({ visit_date: { lte: new Date(to) } });
  const visits = await prisma.eVCVisit.findMany({ where, include: visitInclude, orderBy: { visit_date: 'asc' } });
  ok(res, visits);
}));

// Rank experts for a visit: no conflict of interest (home state), free on the
// date, lighter current load, and a specialisation that matches the institution.
router.get('/suggest', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const app = await prisma.application.findUnique({ where: { id: Number(req.query.application_id) }, include: { institution: true } });
  if (!app) return fail(res, 404, 'Application not found');
  const date = req.query.date ? new Date(req.query.date) : new Date(Date.now() + 10 * DAY);
  const experts = await prisma.user.findMany({
    where: { role: 'Expert', status: 'Active' },
    include: { evc_memberships: { include: { visit: true } } },
  });
  const ranked = experts.map(e => {
    const upcoming = e.evc_memberships.filter(m => m.visit.status === 'Scheduled' && m.visit.visit_date >= new Date());
    const busy = upcoming.some(m => dayStart(m.visit.visit_date).getTime() === dayStart(date).getTime());
    const conflict = e.state === app.institution.state;
    const specMatch = (e.specialization || '').toLowerCase().includes(app.institution.type.toLowerCase());
    const reasons = [];
    let score = 100 - upcoming.length * 12;
    if (specMatch) { score += 25; reasons.push(`${app.institution.type} specialist`); }
    if (conflict) { score -= 1000; reasons.push(`Conflict: home state ${e.state}`); }
    if (busy) { score -= 500; reasons.push('Already on a visit that day'); }
    reasons.push(`${upcoming.length} upcoming visit${upcoming.length === 1 ? '' : 's'}`);
    return { id: e.id, name: e.name, designation: e.designation, state: e.state, specialization: e.specialization, load: upcoming.length, eligible: !conflict && !busy, score, reasons };
  }).sort((a, b) => b.score - a.score);
  ok(res, { date, institution_state: app.institution.state, experts: ranked, recommended: ranked.filter(r => r.eligible).slice(0, 3).map(r => r.id) });
}));

async function conflicts({ application, date, memberIds, excludeVisitId }) {
  const problems = [];
  const members = await prisma.user.findMany({ where: { id: { in: memberIds } } });
  for (const m of members) {
    if (m.role !== 'Expert') problems.push(`${m.name} is not an EVC expert`);
    if (m.state && m.state === application.institution.state) problems.push(`${m.name} is from ${m.state}, the institution's home state (conflict of interest)`);
  }
  const clashes = await prisma.eVCVisit.findMany({
    where: { status: 'Scheduled', visit_date: sameDay(date), id: excludeVisitId ? { not: excludeVisitId } : undefined, members: { some: { user_id: { in: memberIds } } } },
    include: { members: { include: { user: true } }, application: { include: { institution: true } } },
  });
  for (const c of clashes) {
    const who = c.members.filter(m => memberIds.includes(m.user_id)).map(m => m.user.name).join(', ');
    problems.push(`${who} already visiting ${c.application.institution.name} that day`);
  }
  const instClash = await prisma.eVCVisit.findFirst({ where: { status: 'Scheduled', application: { institution_id: application.institution_id }, id: excludeVisitId ? { not: excludeVisitId } : undefined, visit_date: sameDay(date) } });
  if (instClash) problems.push('The institution already has a visit scheduled that day');
  return problems;
}

router.post('/', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const { application_id, visit_date, mode, member_ids = [], chair_id } = req.body;
  const app = await prisma.application.findUnique({ where: { id: Number(application_id) }, include: { institution: true } });
  if (!app) return fail(res, 404, 'Application not found');
  if (!visit_date) return fail(res, 400, 'Visit date required');
  if (member_ids.length < 2) return fail(res, 400, 'An EVC panel needs at least two experts');
  if (new Date(visit_date) < dayStart(new Date())) return fail(res, 400, 'Visit date cannot be in the past');
  const ids = member_ids.map(Number);
  const problems = await conflicts({ application: app, date: visit_date, memberIds: ids });
  if (problems.length) return fail(res, 409, problems.join('; '));

  const visit = await prisma.eVCVisit.create({
    data: {
      application_id: app.id, visit_date: new Date(visit_date), mode: mode || 'Physical',
      members: { create: ids.map(id => ({ user_id: id, is_chair: Number(chair_id || ids[0]) === id })) },
    },
    include: visitInclude,
  });
  const when = new Date(visit_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  for (const id of ids) await notify({ userId: id, type: 'EVC', message: `You are on the EVC panel for ${app.institution.name} on ${when}`, relatedEntityType: 'EVCVisit', relatedEntityId: visit.id });
  const instUsers = await prisma.user.findMany({ where: { institution_id: app.institution_id } });
  for (const u of instUsers) await notify({ userId: u.id, type: 'EVC', message: `Expert Visit Committee scheduled on ${when} (${mode || 'Physical'})`, relatedEntityType: 'EVCVisit', relatedEntityId: visit.id });
  await logActivity({ actorUserId: req.user.id, action: `Scheduled EVC for ${app.app_number} on ${when}`, entityType: 'EVCVisit', entityId: visit.id });
  ok(res, visit);
}));

router.patch('/:id/reschedule', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const visit = await prisma.eVCVisit.findUnique({ where: { id: Number(req.params.id) }, include: { members: true, application: { include: { institution: true } } } });
  if (!visit) return fail(res, 404, 'Visit not found');
  const problems = await conflicts({ application: visit.application, date: req.body.visit_date, memberIds: visit.members.map(m => m.user_id), excludeVisitId: visit.id });
  if (problems.length) return fail(res, 409, problems.join('; '));
  const upd = await prisma.eVCVisit.update({ where: { id: visit.id }, data: { visit_date: new Date(req.body.visit_date) } });
  await logActivity({ actorUserId: req.user.id, action: `Rescheduled EVC for ${visit.application.app_number}`, entityType: 'EVCVisit', entityId: visit.id });
  ok(res, upd);
}));

router.patch('/:id/cancel', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const upd = await prisma.eVCVisit.update({ where: { id: Number(req.params.id) }, data: { status: 'Cancelled' } });
  ok(res, upd);
}));

router.patch('/:id/report', h(async (req, res) => {
  const { recommendation, report, score } = req.body;
  const visit = await prisma.eVCVisit.findUnique({ where: { id: Number(req.params.id) }, include: { members: true, application: true } });
  if (!visit) return fail(res, 404, 'Visit not found');
  if (!isOffice(req.user) && !visit.members.some(m => m.user_id === req.user.id)) return fail(res, 403, 'Only panel members can file the report');
  if (!['Recommended', 'Not Recommended', 'Recommended with Conditions'].includes(recommendation)) return fail(res, 400, 'Choose a recommendation');
  if (!report) return fail(res, 400, 'Report text required');
  const upd = await prisma.eVCVisit.update({ where: { id: visit.id }, data: { recommendation, report, score: score != null ? Number(score) : null, status: 'Completed', completed_at: new Date() } });
  if (visit.application.assigned_officer_id) await notify({ userId: visit.application.assigned_officer_id, type: 'EVC', message: `EVC report filed for ${visit.application.app_number}: ${recommendation}`, relatedEntityType: 'Application', relatedEntityId: visit.application_id });
  await logActivity({ actorUserId: req.user.id, action: `Filed EVC report for ${visit.application.app_number}: ${recommendation}`, entityType: 'EVCVisit', entityId: visit.id });
  ok(res, upd);
}));

module.exports = router;
