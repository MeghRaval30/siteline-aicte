// Who sees what. Admin sees the nation, an Officer sees their Regional Office,
// an Expert sees applications on panels they sit on, an Institution sees itself.

function appScope(user) {
  switch (user.role) {
    case 'Admin': return {};
    case 'Officer': return user.region_id ? { institution: { region_id: user.region_id } } : {};
    case 'Expert': return { evc_visits: { some: { members: { some: { user_id: user.id } } } } };
    case 'Institution': return { institution_id: user.institution_id || -1 };
    default: return { id: -1 };
  }
}

function instScope(user) {
  switch (user.role) {
    case 'Admin': return {};
    case 'Officer': return user.region_id ? { region_id: user.region_id } : {};
    case 'Expert': return { applications: { some: appScope(user) } };
    case 'Institution': return { id: user.institution_id || -1 };
    default: return { id: -1 };
  }
}

const isOffice = user => user.role === 'Admin' || user.role === 'Officer';

// Guard for writes on a record that belongs to an institution: the same rules
// as instScope, checked against one id. Every mutating route calls this.
async function canTouchInstitution(user, institutionId) {
  if (!institutionId) return user.role === 'Admin';
  const prisma = require('./prismaClient');
  const hit = await prisma.institution.findFirst({ where: { AND: [{ id: Number(institutionId) }, instScope(user)] }, select: { id: true } });
  return !!hit;
}

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const fail = (res, status, message) => res.status(status).json({ success: false, error: message });

// Wrap async handlers so a thrown error becomes a JSON 500 instead of a hung request.
// Known client errors (err.status 4xx) keep their message; anything else is logged, not echoed.
const h = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  if (err.status && err.status < 500) return fail(res, err.status, err.message);
  console.error(`[${req.id || '-'}]`, err);
  fail(res, 500, `Something went wrong (ref ${req.id || 'n/a'})`);
});

module.exports = { appScope, instScope, isOffice, canTouchInstitution, ok, fail, h };
