const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const requireRole = require('../../shared/requireRole');
const { ok, h } = require('../../shared/scope');

const router = express.Router();
router.use(authenticate, requireRole(['Admin', 'Officer']));

router.get('/', h(async (req, res) => {
  const { search, channel } = req.query;
  const where = { AND: [] };
  // A Regional Officer sees mail to their region's institutions and to experts.
  if (req.user.role === 'Officer' && req.user.region_id) {
    const users = await prisma.user.findMany({ where: { OR: [{ institution: { region_id: req.user.region_id } }, { role: 'Expert' }] }, select: { id: true } });
    where.AND.push({ user_id: { in: users.map(u => u.id) } });
  }
  if (search) where.AND.push({ OR: [{ to_email: { contains: String(search) } }, { to_name: { contains: String(search) } }, { subject: { contains: String(search) } }, { body: { contains: String(search) } }] });
  if (channel) where.AND.push({ channel: String(channel) });
  const rows = await prisma.outbox.findMany({ where, orderBy: { created_at: 'desc' }, take: Math.min(500, Number(req.query.limit) || 200) });
  const total = await prisma.outbox.count({ where });
  ok(res, rows, { meta: { total, mail_server: !!process.env.SMTP_URL } });
}));

module.exports = router;
