const express = require('express');
const crypto = require('crypto');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const notify = require('../../shared/notify');
const logActivity = require('../../shared/logActivity');
const { STAGES, TRANSITIONS, MAIN_TRACK, STATUS_FOR_STAGE, slaInfo, allowedTransitions, isTerminal, daysBetween, DAY } = require('../../shared/workflow');
const { appScope, isOffice, canTouchInstitution, ok, fail, h } = require('../../shared/scope');
const { template, summary, TEMPLATES } = require('../../shared/checklist');
const fs = require('fs');
const path = require('path');
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
    where: { letter_code: String(req.params.code).trim().toUpperCase() },
    include: { institution: { include: { region: true } }, undertakings: true },
  });
  if (!app) return ok(res, { valid: false });
  ok(res, {
    valid: true,
    revoked: !!app.letter_revoked_at, revoked_at: app.letter_revoked_at, revoke_reason: app.letter_revoke_reason,
    institution_status: app.institution.status,
    app_number: app.app_number, type: app.type, academic_year: app.academic_year,
    status: app.status, stage: app.stage, decided_at: app.decided_at,
    institution: { name: app.institution.name, aicte_id: app.institution.aicte_id, city: app.institution.city, state: app.institution.state, region: app.institution.region.name },
    undertakings: app.undertakings.map(u => ({ title: u.title, due_date: u.due_date, status: u.status })),
  });
}));

router.use(authenticate);

router.get('/meta', h(async (req, res) => {
  ok(res, { stages: STAGES, transitions: TRANSITIONS, main_track: MAIN_TRACK, types: APP_TYPES, checklist_templates: TEMPLATES, deficiency_categories: DEFICIENCY_CATEGORIES, undertaking_categories: UNDERTAKING_CATEGORIES });
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
      checklist: { select: { status: true, required: true, label: true } },
    },
    orderBy: [{ stage_entered_at: 'asc' }],
  });
  rows = rows.map(r => { const { checklist, ...rest } = withSla(r); return { ...rest, checklist: summary(checklist) }; });
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
      checklist: { orderBy: { id: 'asc' } },
    },
  });
  if (!app) return fail(res, 404, 'Application not found');
  const instDocs = await prisma.complianceDocument.findMany({ where: { institution_id: app.institution_id, status: { not: 'Superseded' } }, orderBy: { valid_to: 'asc' } });
  ok(res, { ...withSla(app), checklist_summary: summary(app.checklist), institution_documents: instDocs, allowed_transitions: allowedTransitions(app, req.user) });
}));

router.post('/', h(async (req, res) => {
  const { type, academic_year, intake_requested, courses, priority } = req.body;
  let institution_id = req.user.role === 'Institution' ? req.user.institution_id : Number(req.body.institution_id);
  if (!institution_id) return fail(res, 400, 'institution_id required');
  if (!APP_TYPES.includes(type)) return fail(res, 400, 'Invalid application type');
  if (['Increase in Intake', 'New Institution'].includes(type) && !(Number(intake_requested) > 0)) return fail(res, 400, 'Enter the intake requested (a positive number)');
  if (['New Course', 'New Institution'].includes(type) && !String(courses || '').trim()) return fail(res, 400, 'Name the course(s) applied for');
  if (!(await canTouchInstitution(req.user, institution_id))) return fail(res, 403, 'That institution is outside your jurisdiction');
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
      checklist: { create: template(type) },
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
    include: { institution: true, deficiencies: true, evc_visits: true, transitions: { select: { to_stage: true } }, checklist: true },
  });
  if (!app) return fail(res, 404, 'Application not found');
  const move = allowedTransitions(app, req.user).find(m => m.to === to);
  if (!move) return fail(res, 403, `You cannot move this application from ${STAGES[app.stage].label} to ${STAGES[to]?.label || to}`);

  // Guards that keep the pipeline honest
  const docs = summary(app.checklist);
  if (app.stage === 'SUBMITTED' && to === 'SCRUTINY' && docs.missing.length)
    return fail(res, 400, `Scrutiny can't start: ${docs.missing.length} required document(s) not uploaded (${docs.missing.slice(0, 3).join('; ')}${docs.missing.length > 3 ? '…' : ''})`);
  if (['SCRUTINY', 'RESCRUTINY'].includes(app.stage) && ['EVC', 'EC_REVIEW'].includes(to) && docs.unverified.length)
    return fail(res, 400, `Verify every required document before clearing scrutiny (${docs.unverified.length} not verified)`);
  if (to === 'DEFICIENCY' && !deficiencies.length && !app.deficiencies.some(d => d.status === 'Open'))
    return fail(res, 400, 'List at least one deficiency for the institution to address');
  if (app.stage === 'DEFICIENCY' && to === 'RESCRUTINY' && app.deficiencies.some(d => d.status === 'Open'))
    return fail(res, 400, 'Every open deficiency needs a response before re-scrutiny');
  if (app.stage === 'EVC' && to === 'EC_REVIEW' && !app.evc_visits.some(v => v.status === 'Completed' && v.completed_at && v.completed_at >= app.stage_entered_at))
    return fail(res, 400, 'The EVC report for this round must be filed before the application moves to the Executive Committee');
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

  try {
  await prisma.$transaction(async tx => {
    // Optimistic lock: only move if nobody else moved it since we read it (double-clicks, two officers).
    const moved = await tx.application.updateMany({ where: { id: app.id, stage: app.stage, stage_entered_at: app.stage_entered_at }, data });
    if (moved.count !== 1) throw Object.assign(new Error('STALE'), { stale: true });
    await tx.stageTransition.create({ data: { application_id: app.id, from_stage: app.stage, to_stage: to, actor_id: req.user.id, remarks: remarks || move.label, days_in_stage: s.days, sla_breached: s.breached } });
    for (const d of deficiencies) {
      await tx.deficiency.create({ data: { application_id: app.id, raised_by: req.user.id, category: d.category || 'Documents', description: d.description, severity: d.severity || 'Major', due_date: new Date(now.getTime() + 15 * DAY) } });
    }
    for (const u of undertakings) {
      await tx.undertaking.create({ data: { institution_id: app.institution_id, application_id: app.id, title: u.title, description: u.description || null, category: u.category || 'Lease Renewal', due_date: new Date(u.due_date) } });
    }
  });
  } catch (e) {
    if (e.stale) return fail(res, 409, 'This application was just moved by someone else. Refresh to see its current stage.');
    throw e;
  }

  await logActivity({ actorUserId: req.user.id, action: `${app.app_number}: ${STAGES[app.stage].label} → ${STAGES[to].label}`, entityType: 'Application', entityId: app.id, metadata: { remarks, sla_breached: s.breached } });
  await notifyInstitution(app.institution_id, `${app.app_number} moved to ${STAGES[to].label}${remarks ? ` — ${remarks}` : ''}`, app.id);
  if (app.assigned_officer_id && app.assigned_officer_id !== req.user.id)
    await notify({ userId: app.assigned_officer_id, type: 'APPLICATION', message: `${app.app_number} moved to ${STAGES[to].label} by ${req.user.name}`, relatedEntityType: 'Application', relatedEntityId: app.id });
  ok(res, { id: app.id, stage: to });
}));

router.patch('/:id/assign', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const target = await prisma.application.findFirst({ where: { AND: [{ id: Number(req.params.id) }, appScope(req.user)] }, include: { institution: true } });
  if (!target) return fail(res, 404, 'Application not found');
  const officer = await prisma.user.findFirst({ where: { id: Number(req.body.officer_id), role: { in: ['Officer', 'Admin'] } } });
  if (!officer) return fail(res, 400, 'Not an officer');
  if (officer.role === 'Officer' && officer.region_id && officer.region_id !== target.institution.region_id) return fail(res, 400, `${officer.name} belongs to another Regional Office`);
  const app = await prisma.application.update({ where: { id: Number(req.params.id) }, data: { assigned_officer_id: officer.id } });
  await notify({ userId: officer.id, type: 'APPLICATION', message: `${app.app_number} assigned to you`, relatedEntityType: 'Application', relatedEntityId: app.id });
  await logActivity({ actorUserId: req.user.id, action: `Assigned ${app.app_number} to ${officer.name}`, entityType: 'Application', entityId: app.id });
  ok(res, app);
}));

// ---------- deficiencies ----------
router.post('/:id/deficiencies', requireRole(['Admin', 'Officer', 'Expert']), h(async (req, res) => {
  const { category, description, severity } = req.body;
  if (!description) return fail(res, 400, 'Description required');
  const scoped = await prisma.application.findFirst({ where: { AND: [{ id: Number(req.params.id) }, appScope(req.user)] } });
  if (!scoped) return fail(res, 404, 'Application not found');
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
  const def = await prisma.deficiency.findFirst({ where: { id: Number(req.params.did), application: appScope(req.user) } });
  if (!def) return fail(res, 404, 'Deficiency not found');
  const upd = await prisma.deficiency.update({ where: { id: Number(req.params.did) }, data: { status } });
  ok(res, upd);
}));

// ---------- submission checklist ----------
async function checklistTarget(req, res) {
  const app = await prisma.application.findFirst({ where: { AND: [{ id: Number(req.params.id) }, appScope(req.user)] } });
  if (!app) { fail(res, 404, 'Application not found'); return null; }
  const item = await prisma.checklistItem.findFirst({ where: { id: Number(req.params.itemId), application_id: app.id } });
  if (!item) { fail(res, 404, 'Checklist item not found'); return null; }
  return { app, item };
}

router.post('/:id/checklist/:itemId/upload', h(async (req, res) => {
  const t = await checklistTarget(req, res); if (!t) return;
  const { app, item } = t;
  if (req.user.role === 'Expert') return fail(res, 403, 'Experts cannot upload application documents');
  const open = req.user.role === 'Institution' ? ['SUBMITTED', 'DEFICIENCY'] : ['SUBMITTED', 'SCRUTINY', 'DEFICIENCY', 'RESCRUTINY'];
  if (!open.includes(app.stage)) return fail(res, 400, `Documents can't be changed while the application is at ${STAGES[app.stage].label}`);
  if (item.status === 'Verified') return fail(res, 400, 'This document is already verified');
  const { file_name, file_data } = req.body;
  if (!file_name || !file_data) return fail(res, 400, 'Choose a file to upload');
  const ext = (String(file_name).match(/\.[a-zA-Z0-9]{1,5}$/) || [''])[0];
  const stored = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), Buffer.from(String(file_data).replace(/^data:[^;]+;base64,/, ''), 'base64'));
  const upd = await prisma.checklistItem.update({ where: { id: item.id }, data: { status: 'Uploaded', file_name: String(file_name).slice(0, 120), file_url: `/uploads/${stored}`, uploaded_at: new Date(), remarks: item.status === 'Deficient' ? `Re-uploaded after: ${item.remarks || 'deficiency'}` : null } });
  await logActivity({ actorUserId: req.user.id, action: `Uploaded "${item.label}" for ${app.app_number}`, entityType: 'Application', entityId: app.id });
  ok(res, upd);
}));

router.patch('/:id/checklist/:itemId/review', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const t = await checklistTarget(req, res); if (!t) return;
  const { app, item } = t;
  const { decision, remarks } = req.body;
  if (!['SUBMITTED', 'SCRUTINY', 'RESCRUTINY'].includes(app.stage)) return fail(res, 400, 'Documents are verified during scrutiny');
  if (!['Verified', 'Deficient'].includes(decision)) return fail(res, 400, 'Decision must be Verified or Deficient');
  if (item.status === 'Pending') return fail(res, 400, 'Nothing uploaded for this item yet');
  if (decision === 'Deficient' && !remarks) return fail(res, 400, 'Say what is wrong with the document');
  const upd = await prisma.checklistItem.update({ where: { id: item.id }, data: { status: decision, remarks: remarks || null, verified_by: req.user.name, verified_at: new Date() } });
  if (decision === 'Deficient') await notifyInstitution(app.institution_id, `${app.app_number}: "${item.label}" marked deficient — ${remarks}`, app.id);
  await logActivity({ actorUserId: req.user.id, action: `${decision === 'Verified' ? 'Verified' : 'Marked deficient'} "${item.label}" on ${app.app_number}`, entityType: 'Application', entityId: app.id });
  ok(res, upd);
}));

// ---------- letter (LoA / LoR) ----------
router.post('/:id/letter/revoke', requireRole(['Admin']), h(async (req, res) => {
  const app = await prisma.application.findUnique({ where: { id: Number(req.params.id) } });
  if (!app || !app.letter_code) return fail(res, 404, 'No letter issued for this application');
  if (app.letter_revoked_at) return fail(res, 400, 'This letter is already revoked');
  if (!req.body.reason) return fail(res, 400, 'Give the reason for revocation (it is shown on the public verification page)');
  const upd = await prisma.application.update({ where: { id: app.id }, data: { letter_revoked_at: new Date(), letter_revoke_reason: req.body.reason } });
  await notifyInstitution(app.institution_id, `The letter for ${app.app_number} has been revoked: ${req.body.reason}`, app.id);
  await logActivity({ actorUserId: req.user.id, action: `Revoked letter ${app.letter_code} (${app.app_number}): ${req.body.reason}`, entityType: 'Application', entityId: app.id });
  ok(res, upd);
}));

router.get('/:id/letter', h(async (req, res) => {
  const app = await prisma.application.findFirst({
    where: { AND: [{ id: Number(req.params.id) }, appScope(req.user)] },
    include: { institution: { include: { region: true } }, undertakings: true, transitions: { orderBy: { created_at: 'asc' } } },
  });
  if (!app || !app.letter_code) return fail(res, 404, 'No letter issued for this application');
  ok(res, { ...app, stage_label: STAGES[app.stage].label, total_days: daysBetween(app.submitted_at, app.decided_at) });
}));

module.exports = router;
