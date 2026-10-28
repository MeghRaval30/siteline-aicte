const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const logActivity = require('../../shared/logActivity');
const { DAY } = require('../../shared/workflow');
const { EXPIRY_WINDOW_DAYS } = require('../../shared/compliance');
const { ok, fail, h } = require('../../shared/scope');
const { runAll } = require('../alerts/engine');
const { TARGETS } = require('./schema');
const { analyze, validate } = require('./studio');
const { SAMPLES, build } = require('./samples');

const router = express.Router();
router.use(authenticate, requireRole(['Admin', 'Officer']));

router.get('/targets', h(async (req, res) => {
  ok(res, Object.fromEntries(Object.entries(TARGETS).map(([k, t]) => [k, { label: t.label, description: t.description, fields: t.fields.map(({ key, label, kind, required }) => ({ key, label, kind, required })) }])));
}));

router.get('/samples', h(async (req, res) => ok(res, Object.entries(SAMPLES).map(([name, s]) => ({ name, ...s })))));

router.get('/samples/:name', h(async (req, res) => {
  const file = await build(req.params.name);
  if (!file) return fail(res, 404, 'No such sample');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
  res.send(Buffer.from(file.buffer));
}));

router.post('/analyze', h(async (req, res) => {
  const { target, file_name, file_data, use_ai } = req.body;
  if (!file_data || !file_name) return fail(res, 400, 'Choose a file');
  try {
    ok(res, await analyze({ target, file_name, file_data, use_ai: use_ai !== false }));
  } catch (e) {
    fail(res, 400, `Could not read the file: ${e.message}`);
  }
}));

router.post('/preview', h(async (req, res) => ok(res, await validate(req.body))));

const statusFor = (validTo, now = new Date()) => !validTo ? 'Valid' : validTo < now ? 'Expired' : validTo - now <= EXPIRY_WINDOW_DAYS * DAY ? 'Expiring Soon' : 'Valid';

// Replace the institution's current record of a document type, keeping history.
async function upsertDocument(institutionId, docType, data, actor) {
  const prev = await prisma.complianceDocument.findFirst({ where: { institution_id: institutionId, doc_type: docType, status: { not: 'Superseded' } }, orderBy: { created_at: 'desc' } });
  const validTo = data.valid_to ? new Date(data.valid_to) : null;
  if (prev && prev.valid_to && validTo && prev.valid_to.getTime() === validTo.getTime()) return 'unchanged';
  if (prev) await prisma.complianceDocument.update({ where: { id: prev.id }, data: { status: 'Superseded' } });
  await prisma.complianceDocument.create({ data: {
    institution_id: institutionId, doc_type: docType, doc_number: data.doc_number || null, issued_by: data.issued_by || null,
    valid_from: data.valid_from ? new Date(data.valid_from) : null, valid_to: validTo, status: statusFor(validTo),
    verified_by: `${actor} (bulk import)`, renewal_of_id: prev?.id || null, remarks: 'Imported via Import Studio',
  } });
  return prev ? 'replaced' : 'created';
}

router.post('/commit', h(async (req, res) => {
  const { target, file_name } = req.body;
  const { rows, summary } = await validate(req.body);
  const regions = await prisma.region.findMany();
  const regionFor = state => regions.find(r => r.states.split(',').includes(state));
  const result = { created: 0, updated: 0, skipped: 0, failed: 0, documents: 0, errors: [] };

  for (const r of rows) {
    if (r.action === 'skip') { result.skipped++; continue; }
    if (r.action === 'error') { result.failed++; continue; }
    const v = r.values;
    try {
      if (target === 'institutions') {
        const region = regionFor(v.state) || regions.find(x => x.code === 'NRO');
        const data = {
          name: v.name, type: v.type, state: v.state, city: v.city, region_id: region.id,
          ...(v.ownership ? { ownership: v.ownership } : {}), ...(v.established_year ? { established_year: v.established_year } : {}),
          ...(v.approved_intake != null ? { approved_intake: v.approved_intake } : {}), ...(v.head_name ? { head_name: v.head_name } : {}),
          ...(v.email ? { email: v.email } : {}), ...(v.phone ? { phone: v.phone } : {}),
        };
        let inst;
        if (r.action === 'update') { inst = await prisma.institution.update({ where: { aicte_id: v.aicte_id }, data }); result.updated++; }
        else { inst = await prisma.institution.create({ data: { aicte_id: v.aicte_id, ownership: 'Private Self-Financing', established_year: new Date().getFullYear(), ...data } }); result.created++; }
        for (const f of TARGETS.institutions.fields.filter(x => x.doc)) {
          if (!v[f.key]) continue;
          const d = await upsertDocument(inst.id, f.doc, { valid_to: v[f.key] }, req.user.name);
          if (d !== 'unchanged') result.documents++;
        }
      } else {
        const inst = await prisma.institution.findUnique({ where: { aicte_id: v.aicte_id } });
        const d = await upsertDocument(inst.id, v.doc_type, v, req.user.name);
        if (d !== 'unchanged') { result.documents++; result.created++; } else result.skipped++;
      }
    } catch (e) {
      result.failed++;
      result.errors.push({ line: r.line, msg: e.message });
    }
  }

  const run = await runAll();
  result.alerts_raised = run.results?.reduce((s, x) => s + x.created, 0) || 0;
  result.alerts_resolved = run.results?.reduce((s, x) => s + x.auto_resolved, 0) || 0;
  await logActivity({ actorUserId: req.user.id, action: `Imported ${file_name || 'file'} into ${TARGETS[target].label}: ${result.created} created, ${result.updated} updated, ${result.documents} documents`, entityType: 'Import', metadata: { ...result, preview: summary } });
  ok(res, result);
}));

module.exports = router;
