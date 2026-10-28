const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const logActivity = require('../../shared/logActivity');
const { ok, fail, h } = require('../../shared/scope');

const router = express.Router();
router.use(authenticate);

const SAFE = { id: true, name: true, email: true, role: true, status: true, designation: true, state: true, specialization: true, region_id: true, institution_id: true, phone: true,
  region: { select: { code: true, name: true } }, institution: { select: { id: true, name: true } } };

router.get('/me', h(async (req, res) => {
  ok(res, await prisma.user.findUnique({ where: { id: req.user.id }, select: SAFE }));
}));

router.get('/', requireRole(['Admin', 'Officer']), h(async (req, res) => {
  const where = {};
  if (req.query.role) where.role = { in: req.query.role.split(',') };
  ok(res, await prisma.user.findMany({ where, select: SAFE, orderBy: [{ role: 'asc' }, { name: 'asc' }] }));
}));

router.post('/', requireRole(['Admin']), h(async (req, res) => {
  const { name, email, password, role, designation, state, specialization, region_id, institution_id } = req.body;
  if (!name || !email || !role) return fail(res, 400, 'name, email and role are required');
  if (!['Admin', 'Officer', 'Expert', 'Institution'].includes(role)) return fail(res, 400, 'Invalid role');
  if (await prisma.user.findUnique({ where: { email } })) return fail(res, 409, 'Email already exists');
  const user = await prisma.user.create({
    data: { name, email, role, designation, state, specialization, password_hash: await bcrypt.hash(password || 'demo1234', 10),
      region_id: region_id ? Number(region_id) : null, institution_id: institution_id ? Number(institution_id) : null },
    select: SAFE,
  });
  await logActivity({ actorUserId: req.user.id, action: `Created ${role} user ${name}`, entityType: 'User', entityId: user.id });
  ok(res, user);
}));

module.exports = router;
