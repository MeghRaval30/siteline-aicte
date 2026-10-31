const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const audit = require('../../shared/audit');
const { ok, h } = require('../../shared/scope');

const router = express.Router();
router.use(authenticate, requireRole(['Admin', 'Officer']));

// Recompute the whole hash chain and check it against every published anchor.
router.get('/verify', h(async (req, res) => ok(res, await audit.verify(prisma))));

router.get('/head', h(async (req, res) => {
  const last = await prisma.auditEvent.findFirst({ orderBy: { id: 'desc' } });
  const anchors = await prisma.auditAnchor.findMany({ orderBy: { id: 'desc' }, take: 10 });
  ok(res, { count: await prisma.auditEvent.count(), head: last?.hash || audit.GENESIS, last_at: last?.at || null, anchors });
}));

router.get('/events', requireRole(['Admin']), h(async (req, res) => {
  const where = {};
  if (req.query.entity_type) where.entity_type = req.query.entity_type;
  if (req.query.entity_id) where.entity_id = Number(req.query.entity_id);
  ok(res, await prisma.auditEvent.findMany({ where, orderBy: { id: 'desc' }, take: Math.min(500, Number(req.query.limit) || 100) }));
}));

router.post('/anchor', requireRole(['Admin']), h(async (req, res) => ok(res, await audit.anchor(prisma))));

module.exports = router;
