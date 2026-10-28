// Institution Compliance Health Score: one number a reviewer can sort by.
// Starts at 100 and deducts for every open compliance gap, with the reasons
// kept alongside so the score is never a black box.

const prisma = require('./prismaClient');
const { DAY } = require('./workflow');

const EXPIRY_WINDOW_DAYS = 60;

// Refresh time-derived statuses so every screen and rule agrees on "today".
async function sweepStatuses(now = new Date()) {
  const soon = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY);
  const [expired, expiring, overdue] = await Promise.all([
    prisma.complianceDocument.updateMany({
      where: { valid_to: { lt: now }, status: { in: ['Valid', 'Expiring Soon', 'Pending Verification'] } },
      data: { status: 'Expired' },
    }),
    prisma.complianceDocument.updateMany({
      where: { valid_to: { gte: now, lte: soon }, status: 'Valid' },
      data: { status: 'Expiring Soon' },
    }),
    prisma.undertaking.updateMany({
      where: { due_date: { lt: now }, status: 'Pending' },
      data: { status: 'Overdue' },
    }),
  ]);
  return { expired: expired.count, expiring: expiring.count, overdue: overdue.count };
}

function scoreFrom({ documents = [], undertakings = [], deficiencies = [], alerts = [] }, now = new Date()) {
  const reasons = [];
  let score = 100;
  const deduct = (pts, why) => { score -= pts; reasons.push({ points: -pts, reason: why }); };

  for (const d of documents) {
    if (d.status === 'Superseded' || d.status === 'Rejected') continue;
    if (d.status === 'Expired') deduct(15, `${d.doc_type} expired`);
    else if (d.status === 'Expiring Soon') {
      const left = Math.ceil((new Date(d.valid_to) - now) / DAY);
      deduct(left <= 30 ? 6 : 3, `${d.doc_type} expires in ${left} days`);
    } else if (d.status === 'Pending Verification') deduct(1, `${d.doc_type} awaiting verification`);
  }
  for (const u of undertakings) {
    if (u.status === 'Breached') deduct(20, `Undertaking breached: ${u.title}`);
    else if (u.status === 'Overdue') deduct(10, `Undertaking overdue: ${u.title}`);
  }
  const openDef = deficiencies.filter(d => d.status === 'Open');
  if (openDef.length) deduct(Math.min(15, openDef.length * 4), `${openDef.length} open deficienc${openDef.length > 1 ? 'ies' : 'y'}`);
  const crit = alerts.filter(a => a.status === 'Open' && a.severity === 'Critical');
  if (crit.length) deduct(Math.min(10, crit.length * 3), `${crit.length} critical alert${crit.length > 1 ? 's' : ''} open`);

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
  const risk = score >= 85 ? 'Low' : score >= 70 ? 'Moderate' : score >= 50 ? 'High' : 'Severe';
  return { score, grade, risk, reasons };
}

async function institutionScores(where = {}) {
  const institutions = await prisma.institution.findMany({
    where,
    include: {
      region: true,
      documents: true,
      undertakings: true,
      alerts: { where: { status: 'Open' } },
      applications: { include: { deficiencies: true } },
    },
  });
  return institutions.map(inst => {
    const deficiencies = inst.applications.flatMap(a => a.deficiencies);
    const s = scoreFrom({ documents: inst.documents, undertakings: inst.undertakings, deficiencies, alerts: inst.alerts });
    return { inst, ...s };
  });
}

module.exports = { sweepStatuses, scoreFrom, institutionScores, EXPIRY_WINDOW_DAYS };
