// Escalation and reminders, modelled on the Right to Services auto-appeal idea:
// nobody has to press a button for a delay to reach the next authority.
//
// Reminders nudge whoever must act, on a cadence before and after a due date.
// Escalations move an overdue item up a ladder of designated authorities
// (Regional Officer → Bureau Head → Member Secretary) as days pass, or sooner
// when the current level does not acknowledge in time. Acknowledging needs a
// note and a promised date; everything closes itself once the item is cleared.
const prisma = require('./prismaClient');
const notify = require('./notify');
const { STAGES, ACTIVE_STAGES, slaInfo, DAY } = require('./workflow');

const DEFAULT_LADDERS = [
  // track, level, after_days, target_role, target_label, scope, ack_hours
  ['PENDENCY', 1, 0, 'Officer', 'Regional Officer', 'region', 48],
  ['PENDENCY', 2, 7, 'Admin', 'Bureau Head, Approval Bureau', 'national', 48],
  ['PENDENCY', 3, 14, 'Admin', 'Member Secretary', 'national', 72],
  ['EVC_REPORT', 1, 0, 'Officer', 'Regional Officer', 'region', 48],
  ['EVC_REPORT', 2, 5, 'Admin', 'Bureau Head, Approval Bureau', 'national', 48],
  ['UNDERTAKING', 1, 0, 'Officer', 'Regional Officer', 'region', 72],
  ['UNDERTAKING', 2, 15, 'Admin', 'Bureau Head, Approval Bureau', 'national', 72],
  ['UNDERTAKING', 3, 30, 'Admin', 'Member Secretary (show-cause)', 'national', 72],
  ['DOCUMENT', 1, 0, 'Officer', 'Regional Officer', 'region', 72],
  ['DOCUMENT', 2, 15, 'Admin', 'Bureau Head, Approval Bureau', 'national', 72],
  ['DOCUMENT', 3, 30, 'Admin', 'Member Secretary (show-cause)', 'national', 72],
];

const DEFAULT_PLANS = [
  ['DOC_EXPIRY', 'Document expiry', [60, 30, 15, 7, 3, 1, 0], 7, 4],
  ['UNDERTAKING_DUE', 'Undertaking due date', [30, 15, 7, 3, 1, 0], 3, 5],
  ['DEFICIENCY_DUE', 'Deficiency response due', [7, 3, 1, 0], 2, 5],
  ['EVC_REPORT', 'EVC report due (3 days after the visit)', [1, 0], 2, 5],
];

const TRACK_LABEL = { PENDENCY: 'Stage pendency', EVC_REPORT: 'EVC report', UNDERTAKING: 'Undertaking', DOCUMENT: 'Expired document' };

async function seedLadders(db = prisma) {
  for (const [track, level, after_days, target_role, target_label, scope, ack_hours] of DEFAULT_LADDERS)
    await db.escalationPolicy.upsert({ where: { track_level: { track, level } }, create: { track, level, after_days, target_role, target_label, scope, ack_hours }, update: {} });
  for (const [track, name, offsets, overdue_every, overdue_max] of DEFAULT_PLANS)
    await db.reminderPlan.upsert({ where: { track }, create: { track, name, offsets: JSON.stringify(offsets), overdue_every, overdue_max }, update: {} });
}

const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const daysBetween = (a, b) => Math.floor((b - a) / DAY);

// Overdue items per escalation track, today.
async function overdueItems(track, now) {
  const items = [];
  if (track === 'PENDENCY') {
    const apps = await prisma.application.findMany({ where: { stage: { in: ACTIVE_STAGES } }, include: { institution: true } });
    for (const a of apps) {
      const s = slaInfo(a, now);
      if (s.sla_days && s.days > s.sla_days) items.push({ entity_type: 'Application', entity_id: a.id, institution_id: a.institution_id, region_id: a.institution.region_id, days_overdue: s.days - s.sla_days,
        title: `${a.app_number} past SLA at ${STAGES[a.stage].label}`, detail: `${a.institution.name}: ${s.days} days in stage against an SLA of ${s.sla_days}.` });
    }
  } else if (track === 'EVC_REPORT') {
    const visits = await prisma.eVCVisit.findMany({ where: { status: 'Scheduled', visit_date: { lt: new Date(now.getTime() - 3 * DAY) } }, include: { application: { include: { institution: true } } } });
    for (const v of visits) items.push({ entity_type: 'EVCVisit', entity_id: v.id, institution_id: v.application.institution_id, region_id: v.application.institution.region_id, days_overdue: daysBetween(v.visit_date, now) - 3,
      title: `EVC report overdue: ${v.application.app_number}`, detail: `${v.application.institution.name}: visited ${fmt(v.visit_date)}, report was due 3 days later.` });
  } else if (track === 'UNDERTAKING') {
    const rows = await prisma.undertaking.findMany({ where: { status: { in: ['Pending', 'Overdue'] }, due_date: { lt: now } }, include: { institution: true } });
    for (const u of rows) items.push({ entity_type: 'Undertaking', entity_id: u.id, institution_id: u.institution_id, region_id: u.institution.region_id, days_overdue: daysBetween(u.due_date, now),
      title: `Undertaking unfulfilled: ${u.title}`, detail: `${u.institution.name}: due ${fmt(u.due_date)}.` });
  } else if (track === 'DOCUMENT') {
    const docs = await prisma.complianceDocument.findMany({ where: { status: 'Expired' }, include: { institution: true } });
    for (const d of docs) items.push({ entity_type: 'Document', entity_id: d.id, institution_id: d.institution_id, region_id: d.institution.region_id, days_overdue: daysBetween(d.valid_to, now),
      title: `${d.doc_type} expired, not renewed`, detail: `${d.institution.name}: lapsed ${fmt(d.valid_to)}.` });
  }
  return items;
}

async function targetsFor(policy, regionId) {
  const where = { role: policy.target_role, status: 'Active' };
  if (policy.scope === 'region' && regionId) where.OR = [{ region_id: regionId }, { region_id: null }];
  return prisma.user.findMany({ where, select: { id: true } });
}

async function runEscalations(now = new Date()) {
  const policies = await prisma.escalationPolicy.findMany({ where: { active: true }, orderBy: [{ track: 'asc' }, { level: 'asc' }] });
  const tracks = [...new Set(policies.map(p => p.track))];
  const out = { raised: 0, closed: 0, by_level: {} };
  for (const track of tracks) {
    const ladder = policies.filter(p => p.track === track);
    const items = await overdueItems(track, now);
    const open = await prisma.escalation.findMany({ where: { track, closed_at: null } });
    const live = new Set(items.map(i => `${i.entity_type}:${i.entity_id}`));

    for (const item of items) {
      const mine = open.filter(e => e.entity_type === item.entity_type && e.entity_id === item.entity_id);
      const top = mine.reduce((m, e) => Math.max(m, e.level), 0);
      let target = ladder.filter(p => p.after_days <= item.days_overdue).reduce((m, p) => Math.max(m, p.level), 0);
      // Silence escalates: an unacknowledged top level past its window moves one level up.
      const topRow = mine.find(e => e.level === top);
      const topPolicy = ladder.find(p => p.level === top);
      if (topRow && !topRow.ack_at && topPolicy && now - topRow.raised_at > topPolicy.ack_hours * 3600 * 1000) target = Math.max(target, top + 1);
      for (const p of ladder.filter(p => p.level > top && p.level <= target)) {
        const created = await prisma.escalation.upsert({
          where: { track_entity_type_entity_id_level: { track, entity_type: item.entity_type, entity_id: item.entity_id, level: p.level } },
          create: { track, level: p.level, entity_type: item.entity_type, entity_id: item.entity_id, institution_id: item.institution_id, region_id: item.region_id,
            title: item.title, detail: item.detail, target_role: p.target_role, target_label: p.target_label, days_overdue: item.days_overdue, raised_at: now },
          update: { closed_at: null, close_reason: null, days_overdue: item.days_overdue, title: item.title, detail: item.detail },
        });
        out.raised++; out.by_level[p.level] = (out.by_level[p.level] || 0) + 1;
        for (const u of await targetsFor(p, item.region_id))
          await notify({ userId: u.id, type: 'ESCALATION', message: `[Escalated L${p.level} → ${p.target_label}] ${item.title} (${item.days_overdue} days overdue)`, relatedEntityType: 'Escalation', relatedEntityId: created.id });
      }
      // Keep the open rows' figures current.
      for (const e of mine) if (e.days_overdue !== item.days_overdue) await prisma.escalation.update({ where: { id: e.id }, data: { days_overdue: item.days_overdue } });
    }
    const cleared = open.filter(e => !live.has(`${e.entity_type}:${e.entity_id}`)).map(e => e.id);
    if (cleared.length) {
      await prisma.escalation.updateMany({ where: { id: { in: cleared } }, data: { closed_at: now, close_reason: 'Condition cleared' } });
      out.closed += cleared.length;
    }
  }
  return out;
}

// ---------- reminders ----------
async function dueItems(track, now) {
  const items = [];
  const instUsers = async id => (await prisma.user.findMany({ where: { institution_id: id, role: 'Institution', status: 'Active' }, select: { id: true } })).map(u => u.id);
  if (track === 'DOC_EXPIRY') {
    const docs = await prisma.complianceDocument.findMany({ where: { valid_to: { not: null }, status: { in: ['Valid', 'Expiring Soon', 'Expired'] } }, include: { institution: true } });
    for (const d of docs) items.push({ entity_type: 'Document', entity_id: d.id, due: d.valid_to, recipients: await instUsers(d.institution_id), what: `${d.doc_type} (${d.institution.name})` });
  } else if (track === 'UNDERTAKING_DUE') {
    const rows = await prisma.undertaking.findMany({ where: { status: { in: ['Pending', 'Overdue'] } }, include: { institution: true } });
    for (const u of rows) items.push({ entity_type: 'Undertaking', entity_id: u.id, due: u.due_date, recipients: await instUsers(u.institution_id), what: `undertaking "${u.title}"` });
  } else if (track === 'DEFICIENCY_DUE') {
    const rows = await prisma.deficiency.findMany({ where: { status: 'Open', due_date: { not: null } }, include: { application: true } });
    for (const d of rows) items.push({ entity_type: 'Deficiency', entity_id: d.id, due: d.due_date, recipients: await instUsers(d.application.institution_id), what: `deficiency response on ${d.application.app_number} (${d.category})` });
  } else if (track === 'EVC_REPORT') {
    const visits = await prisma.eVCVisit.findMany({ where: { status: 'Scheduled', visit_date: { lt: now } }, include: { members: true, application: true } });
    for (const v of visits) items.push({ entity_type: 'EVCVisit', entity_id: v.id, due: new Date(v.visit_date.getTime() + 3 * DAY), recipients: v.members.map(m => m.user_id), what: `EVC report for ${v.application.app_number}` });
  }
  return items;
}

// The reminder that is due right now, if any: the tightest offset already reached, or the n-th overdue nudge.
function markFor(plan, due, now) {
  const daysLeft = Math.ceil((new Date(due) - now) / DAY);
  if (daysLeft >= 0) {
    const reached = JSON.parse(plan.offsets).filter(o => o >= daysLeft);
    if (!reached.length) return null;
    const o = Math.min(...reached);
    return { mark: `T-${o}`, text: o === 0 ? 'is due today' : `is due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` };
  }
  const k = Math.floor(-daysLeft / plan.overdue_every) + 1;
  if (k > plan.overdue_max) return null;
  return { mark: `OD-${k}`, text: `is ${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue` };
}

async function runReminders(now = new Date()) {
  const plans = await prisma.reminderPlan.findMany({ where: { active: true } });
  const digest = new Map(); // userId -> lines
  let sent = 0;
  for (const plan of plans) {
    for (const item of await dueItems(plan.track, now)) {
      const m = markFor(plan, item.due, now);
      if (!m || !item.recipients.length) continue;
      try {
        await prisma.reminderLog.create({ data: { plan_id: plan.id, entity_type: item.entity_type, entity_id: item.entity_id, mark: m.mark, recipients: item.recipients.length, sent_at: now } });
      } catch { continue; } // this reminder was already sent
      sent++;
      for (const u of item.recipients) { if (!digest.has(u)) digest.set(u, []); digest.get(u).push(`${item.what} ${m.text}`); }
    }
  }
  // One digest per person per run, so a busy institution gets one message, not ten.
  for (const [userId, lines] of digest) {
    const head = lines.length === 1 ? `Reminder: ${lines[0]}` : `Reminder: ${lines.length} items need action: ${lines.slice(0, 3).join('; ')}${lines.length > 3 ? '…' : ''}`;
    await notify({ userId, type: 'REMINDER', message: head });
  }
  return { sent, recipients: digest.size };
}

module.exports = { DEFAULT_LADDERS, DEFAULT_PLANS, TRACK_LABEL, seedLadders, runEscalations, runReminders, markFor, overdueItems };
