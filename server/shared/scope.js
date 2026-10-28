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

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const fail = (res, status, message) => res.status(status).json({ success: false, error: message });

// Wrap async handlers so a thrown error becomes a JSON 500 instead of a hung request.
const h = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  console.error(err);
  fail(res, 500, err.message || 'Internal error');
});

module.exports = { appScope, instScope, isOffice, ok, fail, h };
