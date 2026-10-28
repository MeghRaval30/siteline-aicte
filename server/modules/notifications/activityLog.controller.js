const prisma = require('../../shared/prismaClient');

exports.list = async (req, res) => {
  const { actor_user_id, action, date_from, date_to, page = 1, limit = 50 } = req.query;

  const where = {};
  // Regional officers see actions by their own region's staff and institutions; experts and institutions see their own.
  if (req.user.role === 'Officer' && req.user.region_id) where.actor = { OR: [{ region_id: req.user.region_id }, { institution: { region_id: req.user.region_id } }] };
  else if (req.user.role !== 'Admin') where.actor_user_id = req.user.id;
  if (actor_user_id) where.actor_user_id = parseInt(actor_user_id, 10);
  if (action) where.action = action;
  
  if (date_from || date_to) {
    where.created_at = {};
    if (date_from) where.created_at.gte = new Date(date_from);
    if (date_to) where.created_at.lte = new Date(date_to);
  }

  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const take = parseInt(limit, 10);

  try {
    const logs = await prisma.activityLog.findMany({
      where,
      skip,
      take,
      orderBy: { created_at: 'desc' },
      include: { actor: { select: { id: true, name: true, email: true } } }
    });
    
    const total = await prisma.activityLog.count({ where });

    res.json({ data: logs, meta: { total, page: parseInt(page, 10), limit: take } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
