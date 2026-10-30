const express = require('express');
const { saveUpload, UploadError } = require('../../shared/files');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const notify = require('../../shared/notify');
const logActivity = require('../../shared/logActivity');
const { DAY } = require('../../shared/workflow');
const { EXPIRY_WINDOW_DAYS } = require('../../shared/compliance');
const crypto = require('crypto');
const { instScope, canTouchInstitution, ok, fail, h } = require('../../shared/scope');
const { runAll } = require('../alerts/engine');
const { DOC_TYPES } = require('../alerts/compiler');

const router = express.Router();
router.use(authenticate);

// Documents that never lapse; every other prescribed document must carry a validity date.
const PERMANENT_TYPES = ['Building Completion Certificate', 'Society/Trust Registration', 'Land Use Conversion'];

function saveOr400(res, file_name, file_data) {
  try { return saveUpload(file_name, file_data); } catch (e) { if (e instanceof UploadError) { fail(res, 400, e.message); return null; } throw e; }
}

function statusFor(validTo, now = new Date()) {
  if (!validTo) return 'Valid';
  const t = new Date(validTo);
  if (t < now) return 'Expired';
  if (t - now <= EXPIRY_WINDOW_DAYS * DAY) return 'Expiring Soon';
  return 'Valid';
}


router.get('/doc-types', h(async (req, res) => ok(res, DOC_TYPES)));

// ---------- documents ----------
router.get('/documents', h(async (req, res) => {
  const { status, doc_type, institution_id, expiring_days, search } = req.query;
  const where = { AND: [{ institution: instScope(req.user) }] };
  if (status) where.AND.push({ status: { in: status.split(',') } });
  else where.AND.push({ status: { not: 'Superseded' } });
  if (doc_type) where.AND.push({ doc_type });
  if (institution_id) where.AND.push({ institution_id: Number(institution_id) });
  if (expiring_days) where.AND.push({ valid_to: { gte: new Date(), lte: new Date(Date.now() + Number(expiring_days) * DAY) } });
  if (search) where.AND.push({ OR: [{ institution: { name: { contains: search } } }, { doc_number: { contains: search } }] });
  const docs = await prisma.complianceDocument.findMany({ where, include: { institution: { include: { region: true } } }, orderBy: [{ valid_to: 'asc' }] });
  const pendingFor = new Set((await prisma.complianceDocument.findMany({ where: { status: 'Pending Verification', renewal_of_id: { in: docs.map(d => d.id) } }, select: { renewal_of_id: true } })).map(d => d.renewal_of_id));
  ok(res, docs.map(d => ({ ...d, days_left: d.valid_to ? Math.ceil((new Date(d.valid_to) - Date.now()) / DAY) : null, renewal_pending: pendingFor.has(d.id) })));
}));

// Upload a document, or a renewal of an existing one (renewal_of_id).
router.post('/documents', h(async (req, res) => {
  const { doc_type, doc_number, issued_by, valid_from, valid_to, renewal_of_id, file_name, file_data, remarks } = req.body;
  if (req.user.role === 'Expert') return fail(res, 403, 'Experts cannot upload institution documents');
  const institution_id = req.user.role === 'Institution' ? req.user.institution_id : Number(req.body.institution_id);
  if (!institution_id) return fail(res, 400, 'Choose the institution');
  if (!(await canTouchInstitution(req.user, institution_id))) return fail(res, 403, 'That institution is outside your jurisdiction');
  if (!DOC_TYPES.includes(doc_type)) return fail(res, 400, 'Choose a valid document type');
  if (valid_to && isNaN(new Date(valid_to))) return fail(res, 400, 'Valid-to is not a date');
  if (valid_from && valid_to && new Date(valid_to) < new Date(valid_from)) return fail(res, 400, 'Valid-to cannot be before valid-from');
  if (valid_to && new Date(valid_to) < new Date()) return fail(res, 400, 'This document has already expired; upload the renewed document instead');
  if (!valid_to && !PERMANENT_TYPES.includes(doc_type)) return fail(res, 400, `${doc_type} must have a valid-to date so its expiry can be monitored`);
  let saved = null;
  if (file_data && file_name) { saved = saveOr400(res, file_name, file_data); if (!saved) return; }
  if (renewal_of_id) {
    const prev = await prisma.complianceDocument.findUnique({ where: { id: Number(renewal_of_id) } });
    if (!prev || prev.institution_id !== institution_id) return fail(res, 400, 'Invalid document to renew');
    if (prev.doc_type !== doc_type) return fail(res, 400, 'A renewal must be the same type of document');
    if (prev.valid_to && valid_to && new Date(valid_to) <= prev.valid_to) return fail(res, 400, 'The renewed document must be valid beyond the current one');
    if (!saved) return fail(res, 400, 'Attach the renewed document');
    const pending = await prisma.complianceDocument.findFirst({ where: { renewal_of_id: prev.id, status: 'Pending Verification' } });
    if (pending) return fail(res, 409, 'A renewal of this document is already awaiting verification');
  }
  const doc = await prisma.complianceDocument.create({
    data: {
      institution_id, doc_type, doc_number: doc_number || null, issued_by: issued_by || null,
      valid_from: valid_from ? new Date(valid_from) : null, valid_to: valid_to ? new Date(valid_to) : null,
      status: 'Pending Verification', file_name: saved?.file_name || null, file_url: saved?.file_url || null, file_sha256: saved?.sha256 || null, remarks: remarks || null,
      renewal_of_id: renewal_of_id ? Number(renewal_of_id) : null,
    },
    include: { institution: true },
  });
  const officers = await prisma.user.findMany({ where: { role: 'Officer', OR: [{ region_id: doc.institution.region_id }, { region_id: null }] } });
  for (const o of officers) await notify({ userId: o.id, type: 'DOCUMENT', message: `${doc.institution.name} uploaded ${renewal_of_id ? 'a renewed ' : ''}${doc_type} for verification`, relatedEntityType: 'Document', relatedEntityId: doc.id });
  await logActivity({ actorUserId: req.user.id, action: `Uploaded ${renewal_of_id ? 'renewal of ' : ''}${doc_type} (${doc.institution.name})`, entityType: 'Document', entityId: doc.id });
  ok(res, doc);
}));

router.patch('/documents/:id/verify', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const { decision, remarks } = req.body;
  const doc = await prisma.complianceDocument.findUnique({ where: { id: Number(req.params.id) }, include: { institution: true } });
  if (!doc) return fail(res, 404, 'Not found');
  if (!(await canTouchInstitution(req.user, doc.institution_id))) return fail(res, 403, 'That institution is outside your jurisdiction');
  if (!['Valid', 'Rejected'].includes(decision)) return fail(res, 400, 'Decision must be Valid or Rejected');
  if (decision === 'Rejected' && !remarks) return fail(res, 400, 'Say why the document is rejected');
  // Without a file on record, verification must say what original was checked.
  if (decision === 'Valid' && !doc.file_url && !remarks) return fail(res, 400, 'No file is attached: record what original document you checked');
  const status = decision === 'Rejected' ? 'Rejected' : statusFor(doc.valid_to);
  const upd = await prisma.complianceDocument.update({ where: { id: doc.id }, data: { status, verified_by: req.user.name, unverified_import: false, remarks: remarks || doc.remarks } });
  if (decision === 'Valid' && doc.renewal_of_id) {
    await prisma.complianceDocument.update({ where: { id: doc.renewal_of_id }, data: { status: 'Superseded' } });
  }
  const users = await prisma.user.findMany({ where: { institution_id: doc.institution_id } });
  for (const u of users) await notify({ userId: u.id, type: 'DOCUMENT', message: `${doc.doc_type} ${decision === 'Valid' ? 'verified' : 'rejected'}${remarks ? `: ${remarks}` : ''}`, relatedEntityType: 'Document', relatedEntityId: doc.id });
  await logActivity({ actorUserId: req.user.id, action: `${decision === 'Valid' ? 'Verified' : 'Rejected'} ${doc.doc_type} of ${doc.institution.name}`, entityType: 'Document', entityId: doc.id });
  // Renewals close their own alerts: re-run the rules now rather than at the next tick.
  const run = await runAll();
  ok(res, { ...upd, alerts_auto_resolved: run.results?.reduce((s, r) => s + r.auto_resolved, 0) || 0 });
}));

// ---------- undertakings ----------
router.get('/undertakings', h(async (req, res) => {
  const { status, institution_id, category } = req.query;
  const where = { AND: [{ institution: instScope(req.user) }] };
  if (status) where.AND.push({ status: { in: status.split(',') } });
  if (category) where.AND.push({ category });
  if (institution_id) where.AND.push({ institution_id: Number(institution_id) });
  const rows = await prisma.undertaking.findMany({ where, include: { institution: { include: { region: true } }, application: { select: { id: true, app_number: true } } }, orderBy: { due_date: 'asc' } });
  ok(res, rows.map(u => ({ ...u, days_left: Math.ceil((new Date(u.due_date) - Date.now()) / DAY) })));
}));

router.post('/undertakings', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const { institution_id, application_id, title, description, category, due_date } = req.body;
  if (!institution_id || !title || !due_date) return fail(res, 400, 'institution_id, title and due_date are required');
  if (!(await canTouchInstitution(req.user, institution_id))) return fail(res, 403, 'That institution is outside your jurisdiction');
  if (isNaN(new Date(due_date)) || new Date(due_date) < new Date()) return fail(res, 400, 'Due date must be a future date');
  const u = await prisma.undertaking.create({ data: { institution_id: Number(institution_id), application_id: application_id ? Number(application_id) : null, title, description, category: category || 'Lease Renewal', due_date: new Date(due_date) } });
  const users = await prisma.user.findMany({ where: { institution_id: u.institution_id, role: 'Institution' } });
  for (const usr of users) await notify({ userId: usr.id, type: 'UNDERTAKING', message: `New undertaking due ${new Date(u.due_date).toLocaleDateString('en-IN')}: ${u.title}`, relatedEntityType: 'Undertaking', relatedEntityId: u.id });
  await logActivity({ actorUserId: req.user.id, action: `Created undertaking "${title}"`, entityType: 'Undertaking', entityId: u.id });
  ok(res, u);
}));

router.patch('/undertakings/:id/submit', h(async (req, res) => {
  const u = await prisma.undertaking.findUnique({ where: { id: Number(req.params.id) }, include: { institution: true } });
  if (!u) return fail(res, 404, 'Not found');
  if (req.user.role === 'Expert' || !(await canTouchInstitution(req.user, u.institution_id))) return fail(res, 403, 'Forbidden');
  if (!req.body.submission_note) return fail(res, 400, 'Describe the compliance evidence');
  let saved = null;
  if (req.body.file_data && req.body.file_name) { saved = saveOr400(res, req.body.file_name, req.body.file_data); if (!saved) return; }
  const upd = await prisma.undertaking.update({ where: { id: u.id }, data: { status: 'Submitted', submission_note: req.body.submission_note, submitted_at: new Date(),
    ...(saved ? { evidence_file_name: saved.file_name, evidence_file_url: saved.file_url, evidence_sha256: saved.sha256 } : {}) } });
  const officers = await prisma.user.findMany({ where: { role: 'Officer', OR: [{ region_id: u.institution.region_id }, { region_id: null }] } });
  for (const o of officers) await notify({ userId: o.id, type: 'UNDERTAKING', message: `${u.institution.name} submitted compliance for "${u.title}"`, relatedEntityType: 'Undertaking', relatedEntityId: u.id });
  await logActivity({ actorUserId: req.user.id, action: `Submitted compliance for undertaking "${u.title}"`, entityType: 'Undertaking', entityId: u.id });
  await runAll();
  ok(res, upd);
}));

router.patch('/undertakings/:id/review', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const { decision, note } = req.body;
  if (!['Verified', 'Breached', 'Waived', 'Pending'].includes(decision)) return fail(res, 400, 'Invalid decision');
  const u = await prisma.undertaking.findUnique({ where: { id: Number(req.params.id) }, include: { institution: true } });
  if (!u) return fail(res, 404, 'Not found');
  if (!(await canTouchInstitution(req.user, u.institution_id))) return fail(res, 403, 'That institution is outside your jurisdiction');
  if (['Breached', 'Waived'].includes(decision) && !note) return fail(res, 400, `Record the reason for marking this ${decision.toLowerCase()}`);
  const status = decision === 'Pending' ? (new Date(u.due_date) < new Date() ? 'Overdue' : 'Pending') : decision;
  const upd = await prisma.undertaking.update({ where: { id: u.id }, data: { status, verifier_note: note || null, verified_at: decision === 'Verified' ? new Date() : null } });
  if (decision === 'Breached') await prisma.institution.update({ where: { id: u.institution_id }, data: { status: 'Under Show-Cause' } });
  const users = await prisma.user.findMany({ where: { institution_id: u.institution_id } });
  for (const usr of users) await notify({ userId: usr.id, type: 'UNDERTAKING', message: `Undertaking "${u.title}" marked ${status}${note ? `: ${note}` : ''}`, relatedEntityType: 'Undertaking', relatedEntityId: u.id });
  await logActivity({ actorUserId: req.user.id, action: `Marked undertaking "${u.title}" (${u.institution.name}) as ${status}`, entityType: 'Undertaking', entityId: u.id });
  await runAll();
  ok(res, upd);
}));

module.exports = router;
