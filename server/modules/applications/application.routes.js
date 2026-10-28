const express = require('express');
const crypto = require('crypto');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const notify = require('../../shared/notify');
const logActivity = require('../../shared/logActivity');
const { STAGES, TRANSITIONS, MAIN_TRACK, STATUS_FOR_STAGE, slaInfo, allowedTransitions, isTerminal, daysBetween, DAY } = require('../../shared/workflow');
const { appScope, isOffice, ok, fail, h } = require('../../shared/scope');

const router = express.Router();

const APP_TYPES = ['New Institution', 'Extension of Approval', 'Increase in Intake', 'New Course', 'Change of Name', 'Change of Site', 'Closure'];
const DEFICIENCY_CATEGORIES = ['Land', 'Building', 'Faculty', 'Infrastructure', 'Laboratory', 'Library', 'Financial', 'Documents'];
const UNDERTAKING_CATEGORIES = ['Lease Renewal', 'Faculty Recruitment', 'Building Completion', 'Fire NOC', 'Land Conversion', 'Library', 'Accreditation'];

const withSla = a => ({ ...a, sla: slaInfo(a), stage_label: STAGES[a.stage]?.label });

async function notifyInstitution(institutionId, message, appId) {
  const users = await prisma.user.findMany({ where: { institution_id: institutionId, role: 'Institution' } });
  for (const u of users) await notify({ userId: u.id, type: 'APPLICATION', message, relatedEntityType: 'Application', relatedEntityId: appId });
}

// ---------- public verification of an issued letter ----------
router.get('/verify/:code', h(async (req, res) => {
  const app = await prisma.application.findUnique({
    where: { letter_code: req.params.code },
    include: { institution: { include: { region: true } }, undertakings: true },
  });
  if (!app) return ok(res, { valid: false });
  ok(res, {
    valid: true,
    app_number: app.app_number, type: app.type, academic_year: app.academic_year,
    status: app.status, stage: app.stage, decided_at: app.decided_at,
    institution: { name: app.institution.name, aicte_id: app.institution.aicte_id, city: app.institution.city, state: app.institution.state, region: app.institution.region.name },
    undertakings: app.undertakings.map(u => ({ title: u.title, due_date: u.due_date, status: u.status })),
  });
}));

router.use(authenticate);

router.get('/meta', h(async (req, res) => {
  ok(res, { stages: STAGES, transitions: TRANSITIONS, main_track: MAIN_TRACK, types: APP_TYPES, deficiency_categories: DEFICIENCY_CATEGORIES, undertaking_categories: UNDERTAKING_CATEGORIES });
}));

router.get('/', h(async (req, res) => {
  const { stage, status, type, region, search, overdue, institution_id, active } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, parseInt(req.query.limit) || 50);
  const where = { AND: [appScope(req.user)] };
  if (stage) where.AND.push({ stage: { in: stage.split(',') } });
  if (status) where.AND.push({ status });
  if (type) where.AND.push({ type });
  if (institution_id) where.AND.push({ institution_id: Number(institution_id) });
  if (region) where.AND.push({ institution: { region: { code: region } } });
  if (active === '1') where.AND.push({ stage: { in: Object.keys(STAGES).filter(s => !STAGES[s].terminal) } });
  if (search) where.AND.push({ OR: [{ app_number: { contains: search } }, { institution: { name: { contains: search } } }, { institution: { aicte_id: { contains: search } } }] });

  let rows = await prisma.application.findMany({
    where,
    include: {
      institution: { include: { region: true } },
      assigned_officer: { select: { id: true, name: true } },
      deficiencies: { where: { status: 'Open' }, select: { id: true } },
    },
    orderBy: [{ stage_entered_at: 'asc' }],
  });
  rows = rows.map(withSla);
  if (overdue === '1') rows = rows.filter(r => r.sla.breached);
  const total = rows.length;
  ok(res, rows.slice((page - 1) * limit, page * limit), { meta: { total, page, limit } });
}));

router.get('/:id', h(async (req, res) => {
  const app = await prisma.application.findFirst({
    where: { AND: [{ id: Number(req.params.id) }, appScope(req.user)] },
    include: {
      institution: { include: { region: true } },
      assigned_officer: { select: { id: true, name: true, email: true } },
      transitions: { include: { actor: { select: { id: true, name: true, role: true } } }, orderBy: { created_at: 'asc' } },
      deficiencies: { include: { raiser: { select: { name: true } } }, orderBy: { created_at: 'desc' } },
      evc_visits: { include: { members: { include: { user: { select: { id: true, name: true, state: true, specialization: true, designation: true } } } } }, orderBy: { visit_date: 'desc' } },
      undertakings: { orderBy: { due_date: 'asc' } },
      documents: true,
    },
  });
  if (!app) return fail(res, 404, 'Application not found');
  const instDocs = await prisma.complianceDocument.findMany({ where: { institution_id: app.institution_id, status: { not: 'Superseded' } }, orderBy: { valid_to: 'asc' } });
  ok(res, { ...withSla(app), institution_documents: instDocs, allowed_transitions: allowedTransitions(app, req.user) });
}));

router.post('/', h(async (req, res) => {
  const { type, academic_year, intake_requested, courses, priority } = req.body;
  let institution_id = req.user.role === 'Institution' ? req.user.institution_id : Number(req.body.institution_id);
  if (!institution_id) return fail(res, 400, 'institution_id required');
  if (!APP_TYPES.includes(type)) return fail(res, 400, 'Invalid application type');
  const inst = await prisma.institution.findUnique({ where: { id: institution_id }, include: { region: true } });
  if (!inst) return fail(res, 404, 'Institution not found');
  const year = academic_year || '2027-28';
  const count = await prisma.application.count();
  const app_number = `APH/${year.slice(0, 4)}/${inst.region.code}/${String(count + 1).padStart(5, '0')}`;
  const app = await prisma.application.create({
    data: {
      app_number, institution_id, type, academic_year: year, priority: priority || 'Normal',
      intake_requested: intake_requested ? Number(intake_requested) : null, courses: courses || null,
      transitions: { create: { to_stage: 'SUBMITTED', actor_id: req.user.id, remarks: 'Application submitted on portal' } },
    },
  });
  await logActivity({ actorUserId: req.user.id, action: `Submitted application ${app_number}`, entityType: 'Application', entityId: app.id });
  const officers = await prisma.user.findMany({ where: { role: 'Officer', OR: [{ region_id: inst.region_id }, { region_id: null }] } });
  for (const o of officers) await notify({ userId: o.id, type: 'APPLICATION', message: `New ${type} application ${app_number} from ${inst.name}`, relatedEntityType: 'Application', relatedEntityId: app.id });
  ok(res, app);
}));

router.post('/:id/transition', h(async (req, res) => {
  const { to, remarks, undertakings = [], deficiencies = [] } = req.body;
  const app = await prisma.application.findFirst({
    where: { AND: [{ id: Number(req.params.id) }, appScope(req.user)] },
    include: { institution: true, deficiencies: true, evc_visits: true },
  });
  if (!app) return fail(res, 404, 'Application not found');
  const move = allowedTransitions(app, req.user).find(m => m.to === to);
  if (!move) return fail(res, 403, `You cannot move this application from ${STAGES[app.stage].label} to ${STAGES[to]?.label || to}`);

  // Guards that keep the pipeline honest
  if (to === 'DEFICIENCY' && !deficiencies.length && !app.deficiencies.some(d => d.status === 'Open'))
    return fail(res, 400, 'List at least one deficiency for the institution to address');
  if (app.stage === 'DEFICIENCY' && to === 'RESCRUTINY' && app.deficiencies.some(d => d.status === 'Open'))
    return fail(res, 400, 'Every open deficiency needs a response before re-scrutiny');
  if (app.stage === 'EVC' && to === 'EC_REVIEW' && !app.evc_visits.some(v => v.status === 'Completed'))
    return fail(res, 400, 'The EVC report must be filed before the application moves to the Executive Committee');
  if (to === 'CONDITIONAL' && !undertakings.length)
    return fail(res, 400, 'A conditional approval needs at least one time-bound undertaking');
  if (['REJECTED', 'CONDITIONAL', 'DEFICIENCY'].includes(to) && !remarks && !deficiencies.length)
    return fail(res, 400, 'Remarks are required for this decision');

  const now = new Date();
  const s = slaInfo(app, now);
  const data = { stage: to, stage_entered_at: now };
  if (STATUS_FOR_STAGE[to]) data.status = STATUS_FOR_STAGE[to];
  else data.status = 'In Process';
  if (to === 'RESCRUTINY') data.rescrutiny_count = { increment: 1 };
  if (['APPROVED', 'CONDITIONAL', 'REJECTED'].includes(to)) {
    data.decided_at = now;
    data.decision_remarks = remarks || null;
    data.letter_code = app.letter_code || crypto.randomBytes(5).toString('hex').toUpperCase();
  }
  if (to === 'SCRUTINY' && !app.assigned_officer_id && req.user.role === 'Officer') data.assigned_officer_id = req.user.id;

  await prisma.$transaction(async tx => {
    await tx.application.update({ where: { id: app.id }, data });
    await tx.stageTransition.create({ data: { application_id: app.id, from_stage: app.stage, to_stage: to, actor_id: req.user.id, remarks: remarks || move.label, days_in_stage: s.days, sla_breached: s.breached } });
    for (const d of deficiencies) {
      await tx.deficiency.create({ data: { application_id: app.id, raised_by: req.user.id, category: d.category || 'Documents', description: d.description, severity: d.severity || 'Major', due_date: new Date(now.getTime() + 15 * DAY) } });
    }
    for (const u of undertakings) {
      await tx.undertaking.create({ data: { institution_id: app.institution_id, application_id: app.id, title: u.title, description: u.description || null, category: u.category || 'Lease Renewal', due_date: new Date(u.due_date) } });
    }
  });

  await logActivity({ actorUserId: req.user.id, action: `${app.app_number}: ${STAGES[app.stage].label} → ${STAGES[to].label}`, entityType: 'Application', entityId: app.id, metadata: { remarks, sla_breached: s.breached } });
  await notifyInstitution(app.institution_id, `${app.app_number} moved to ${STAGES[to].label}${remarks ? ` — ${remarks}` : ''}`, app.id);
  if (app.assigned_officer_id && app.assigned_officer_id !== req.user.id)
    await notify({ userId: app.assigned_officer_id, type: 'APPLICATION', message: `${app.app_number} moved to ${STAGES[to].label} by ${req.user.name}`, relatedEntityType: 'Application', relatedEntityId: app.id });
  ok(res, { id: app.id, stage: to });
}));

router.patch('/:id/assign', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const officer = await prisma.user.findFirst({ where: { id: Number(req.body.officer_id), role: { in: ['Officer', 'Admin'] } } });
  if (!officer) return fail(res, 400, 'Not an officer');
  const app = await prisma.application.update({ where: { id: Number(req.params.id) }, data: { assigned_officer_id: officer.id } });
  await notify({ userId: officer.id, type: 'APPLICATION', message: `${app.app_number} assigned to you`, relatedEntityType: 'Application', relatedEntityId: app.id });
  await logActivity({ actorUserId: req.user.id, action: `Assigned ${app.app_number} to ${officer.name}`, entityType: 'Application', entityId: app.id });
  ok(res, app);
}));

// ---------- deficiencies ----------
router.post('/:id/deficiencies', requireRole(['Admin', 'Officer', 'Expert']), h(async (req, res) => {
  const { category, description, severity } = req.body;
  if (!description) return fail(res, 400, 'Description required');
  const d = await prisma.deficiency.create({ data: { application_id: Number(req.params.id), raised_by: req.user.id, category: category || 'Documents', description, severity: severity || 'Major', due_date: new Date(Date.now() + 15 * DAY) } });
  const app = await prisma.application.findUnique({ where: { id: d.application_id } });
  await notifyInstitution(app.institution_id, `New deficiency raised on ${app.app_number}: ${category}`, app.id);
  ok(res, d);
}));

router.patch('/deficiencies/:did/respond', h(async (req, res) => {
  const d = await prisma.deficiency.findUnique({ where: { id: Number(req.params.did) }, include: { application: true } });
  if (!d) return fail(res, 404, 'Not found');
  if (req.user.role === 'Institution' && d.application.institution_id !== req.user.institution_id) return fail(res, 403, 'Forbidden');
  if (!req.body.response) return fail(res, 400, 'Response required');
  const upd = await prisma.deficiency.update({ where: { id: d.id }, data: { response: req.body.response, status: 'Responded', responded_at: new Date() } });
  await logActivity({ actorUserId: req.user.id, action: `Responded to deficiency (${d.category}) on ${d.application.app_number}`, entityType: 'Deficiency', entityId: d.id });
  ok(res, upd);
}));

router.patch('/deficiencies/:did/review', requireRole(['Admin', 'Officer', 'Expert']), h(async (req, res) => {
  const status = req.body.status;
  if (!['Accepted', 'Rejected', 'Open'].includes(status)) return fail(res, 400, 'Invalid status');
  const upd = await prisma.deficiency.update({ where: { id: Number(req.params.did) }, data: { status } });
  ok(res, upd);
}));

// ---------- letter (LoA / LoR) ----------
router.get('/:id/letter', h(async (req, res) => {
  const app = await prisma.application.findFirst({
    where: { AND: [{ id: Number(req.params.id) }, appScope(req.user)] },
    include: { institution: { include: { region: true } }, undertakings: true, transitions: { orderBy: { created_at: 'asc' } } },
  });
  if (!app || !app.letter_code) return fail(res, 404, 'No letter issued for this application');
  ok(res, { ...app, stage_label: STAGES[app.stage].label, total_days: daysBetween(app.submitted_at, app.decided_at) });
}));

module.exports = router;
