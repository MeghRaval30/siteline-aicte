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
  const where = { AND: [] };
  if (req.query.role) where.AND.push({ role: { in: req.query.role.split(',') } });
  // Officers see experts, the Bureau, and people in their own Regional Office only.
  if (req.user.role === 'Officer' && req.user.region_id) where.AND.push({ OR: [
    { role: { in: ['Expert', 'Admin'] } },
    { role: 'Officer', region_id: req.user.region_id },
    { role: 'Institution', institution: { region_id: req.user.region_id } },
  ] });
  ok(res, await prisma.user.findMany({ where, select: SAFE, orderBy: [{ role: 'asc' }, { name: 'asc' }] }));
}));

router.post('/', requireRole(['Admin']), h(async (req, res) => {
  const { name, email, password, role, designation, state, specialization, region_id, institution_id } = req.body;
  if (!name || !email || !role) return fail(res, 400, 'name, email and role are required');
  if (!['Admin', 'Officer', 'Expert', 'Institution'].includes(role)) return fail(res, 400, 'Invalid role');
  if (await prisma.user.findUnique({ where: { email } })) return fail(res, 409, 'Email already exists');
  if (password && (String(password).length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) return fail(res, 400, 'Password needs 10+ characters with a letter and a digit');
  // No shared default password: without one, issue a random temporary password shown once to the Bureau.
  const temporary = password ? null : require('crypto').randomBytes(9).toString('base64url');
  const user = await prisma.user.create({
    data: { name, email, role, designation, state, specialization, password_hash: await bcrypt.hash(password || temporary, 10),
      region_id: region_id ? Number(region_id) : null, institution_id: institution_id ? Number(institution_id) : null },
    select: SAFE,
  });
  await logActivity({ actorUserId: req.user.id, action: `Created ${role} user ${name}`, entityType: 'User', entityId: user.id });
  ok(res, { ...user, ...(temporary ? { temporary_password: temporary } : {}) });
}));

module.exports = router;
