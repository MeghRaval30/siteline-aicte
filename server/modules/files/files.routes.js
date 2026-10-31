// Serves uploaded documents to signed-in users who may see the record they belong to.
// Files are always sent as downloads with sniffing disabled, so an uploaded file can
// never run as a page on this origin.
const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const { appScope, canTouchInstitution, fail, h } = require('../../shared/scope');
const { storedFile, FILE_URL_PREFIX } = require('../../shared/files');

const router = express.Router();
router.use(authenticate);

router.get('/:name', h(async (req, res) => {
  const name = String(req.params.name);
  const file = storedFile(name);
  if (!file) return fail(res, 404, 'File not found');
  const urls = [FILE_URL_PREFIX + name, `/uploads/${name}`];

  let allowed = false;
  const item = await prisma.checklistItem.findFirst({ where: { file_url: { in: urls } }, select: { application_id: true, file_name: true } });
  if (item) allowed = !!(await prisma.application.findFirst({ where: { AND: [{ id: item.application_id }, appScope(req.user)] }, select: { id: true } }));
  let doc;
  if (!allowed) {
    doc = await prisma.complianceDocument.findFirst({ where: { file_url: { in: urls } }, select: { institution_id: true, file_name: true } });
    if (doc) allowed = await canTouchInstitution(req.user, doc.institution_id);
  }
  let ev;
  if (!allowed) {
    ev = await prisma.undertaking.findFirst({ where: { evidence_file_url: { in: urls } }, select: { institution_id: true, evidence_file_name: true } });
    if (ev) { allowed = await canTouchInstitution(req.user, ev.institution_id); ev = { file_name: ev.evidence_file_name }; }
  }
  if (!allowed) return fail(res, 404, 'File not found');

  const downloadName = String((item || doc || ev).file_name || name).replace(/[^\w.\- ]/g, '_');
  res.set({
    'Content-Type': file.mime,
    'Content-Disposition': `attachment; filename="${downloadName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  });
  res.sendFile(file.full);
}));

module.exports = router;
