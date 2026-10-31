const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const notify = require('../../shared/notify');
const logActivity = require('../../shared/logActivity');
const { DAY } = require('../../shared/workflow');
const { appScope, isOffice, canTouchInstitution, ok, fail, h } = require('../../shared/scope');

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
  const app = await prisma.application.findFirst({ where: { AND: [{ id: Number(req.query.application_id) }, appScope(req.user)] }, include: { institution: true } });
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
  const app = await prisma.application.findFirst({ where: { AND: [{ id: Number(application_id) }, appScope(req.user)] }, include: { institution: true } });
  if (!app) return fail(res, 404, 'Application not found');
  if (!visit_date) return fail(res, 400, 'Visit date required');
  if (!['EVC', 'SCRUTINY', 'RESCRUTINY', 'SAC'].includes(app.stage)) return fail(res, 400, 'An EVC can only be scheduled while the application is in scrutiny, EVC or SAC');
  const open = await prisma.eVCVisit.findFirst({ where: { application_id: app.id, status: 'Scheduled' } });
  if (open) return fail(res, 409, `A visit is already scheduled for ${open.visit_date.toLocaleDateString('en-IN')}; reschedule or cancel it instead`);
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
  if (!(await canTouchInstitution(req.user, visit.application.institution_id))) return fail(res, 403, 'Outside your jurisdiction');
  if (!req.body.visit_date || new Date(req.body.visit_date) < dayStart(new Date())) return fail(res, 400, 'Choose a future date');
  const problems = await conflicts({ application: visit.application, date: req.body.visit_date, memberIds: visit.members.map(m => m.user_id), excludeVisitId: visit.id });
  if (problems.length) return fail(res, 409, problems.join('; '));
  const upd = await prisma.eVCVisit.update({ where: { id: visit.id }, data: { visit_date: new Date(req.body.visit_date) } });
  await logActivity({ actorUserId: req.user.id, action: `Rescheduled EVC for ${visit.application.app_number}`, entityType: 'EVCVisit', entityId: visit.id });
  ok(res, upd);
}));

router.patch('/:id/cancel', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const v = await prisma.eVCVisit.findUnique({ where: { id: Number(req.params.id) }, include: { application: true, members: true } });
  if (!v || !(await canTouchInstitution(req.user, v.application.institution_id))) return fail(res, 404, 'Visit not found');
  if (v.status !== 'Scheduled') return fail(res, 400, 'Only a scheduled visit can be cancelled');
  if (!req.body.reason) return fail(res, 400, 'Give the reason for cancelling the visit');
  const upd = await prisma.eVCVisit.update({ where: { id: Number(req.params.id) }, data: { status: 'Cancelled' } });
  for (const m of v.members) await notify({ userId: m.user_id, type: 'EVC', message: `EVC visit for ${v.application.app_number} cancelled: ${req.body.reason}`, relatedEntityType: 'EVCVisit', relatedEntityId: v.id });
  await logActivity({ actorUserId: req.user.id, action: `Cancelled EVC for ${v.application.app_number}: ${req.body.reason}`, entityType: 'EVCVisit', entityId: v.id });
  ok(res, upd);
}));

router.patch('/:id/report', h(async (req, res) => {
  const { recommendation, report, score } = req.body;
  const visit = await prisma.eVCVisit.findUnique({ where: { id: Number(req.params.id) }, include: { members: true, application: true } });
  if (!visit) return fail(res, 404, 'Visit not found');
  const onPanel = visit.members.some(m => m.user_id === req.user.id);
  // Panel members file their own report; the office may file on a panel's behalf only within its region.
  if (!onPanel && !(isOffice(req.user) && await canTouchInstitution(req.user, visit.application.institution_id))) return fail(res, 403, 'Only panel members can file the report');
  if (visit.status === 'Cancelled') return fail(res, 400, 'This visit was cancelled');
  // A filed report is final; only the Approval Bureau may amend it, with a reason, and the old version is kept.
  if (visit.status === 'Completed' && req.user.role !== 'Admin') return fail(res, 409, 'The report for this visit has already been filed');
  if (visit.status === 'Completed' && !req.body.amend_reason) return fail(res, 400, 'Give the reason for amending a filed report');
  if (!['Recommended', 'Not Recommended', 'Recommended with Conditions'].includes(recommendation)) return fail(res, 400, 'Choose a recommendation');
  if (!report) return fail(res, 400, 'Report text required');
  if (visit.status === 'Completed') await logActivity({ actorUserId: req.user.id, action: `Amended EVC report for ${visit.application.app_number}: ${req.body.amend_reason}`, entityType: 'EVCVisit', entityId: visit.id, metadata: { previous: { recommendation: visit.recommendation, report: visit.report, score: visit.score } } });
  const upd = await prisma.eVCVisit.update({ where: { id: visit.id }, data: { recommendation, report, score: score != null ? Number(score) : null, status: 'Completed', completed_at: visit.completed_at || new Date() } });
  if (visit.application.assigned_officer_id) await notify({ userId: visit.application.assigned_officer_id, type: 'EVC', message: `EVC report filed for ${visit.application.app_number}: ${recommendation}`, relatedEntityType: 'Application', relatedEntityId: visit.application_id });
  await logActivity({ actorUserId: req.user.id, action: `Filed EVC report for ${visit.application.app_number}: ${recommendation}`, entityType: 'EVCVisit', entityId: visit.id });
  // Filing the report completes the EVC stage: the case moves on to the next stage of its route.
  const advanced = await require('../applications/application.routes').autoAdvance(visit.application_id, req.user.id, `EVC report filed (${recommendation})`);
  ok(res, { ...upd, auto_advanced_to: advanced });
}));

module.exports = router;
