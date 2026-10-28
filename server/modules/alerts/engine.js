// Standing alert rules, ported from the odoo_2026 "playbooks" idea.
//
// The thing being automated is not a decision, it is *remembering*. Nobody at
// AICTE forgets how to verify a lease deed; they forget that the one filed
// three years ago lapses next month. So a rule never acts: it raises an alert
// that says what and why, and a person decides. The worst a misconfigured rule
// can do is put a line in an inbox.
//
// Each rule fires at most once per entity (DB unique key), and alerts whose
// condition has cleared are resolved automatically on the next run.

const prisma = require('../../shared/prismaClient');
const notify = require('../../shared/notify');
const { STAGES, ACTIVE_STAGES, slaInfo, loadSlaOverrides, DAY } = require('../../shared/workflow');
const { sweepStatuses } = require('../../shared/compliance');

const TRIGGERS = {
  DOC_EXPIRING:        { label: 'Document expiring',        entity: 'Document',    params: ['days', 'doc_type'] },
  DOC_EXPIRED:         { label: 'Document expired',         entity: 'Document',    params: ['doc_type'] },
  UNDERTAKING_DUE:     { label: 'Undertaking due soon',     entity: 'Undertaking', params: ['days'] },
  UNDERTAKING_OVERDUE: { label: 'Undertaking overdue',      entity: 'Undertaking', params: [] },
  STAGE_SLA_BREACH:    { label: 'Stage SLA breached',       entity: 'Application', params: ['stage', 'grace_days'] },
  EVC_UPCOMING:        { label: 'EVC visit upcoming',       entity: 'EVCVisit',    params: ['days'] },
  EVC_REPORT_PENDING:  { label: 'EVC report pending',       entity: 'EVCVisit',    params: ['days'] },
  DEFICIENCY_OVERDUE:  { label: 'Deficiency response overdue', entity: 'Deficiency', params: [] },
};

const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

function institutionWhere(criteria) {
  const w = {};
  if (criteria.region) w.region = { code: criteria.region };
  if (criteria.institution_type) w.type = criteria.institution_type;
  if (criteria.state) w.state = criteria.state;
  return w;
}

// Returns [{entity_id, institution_id, title, detail}] for one rule, today.
async function matches(rule, now = new Date()) {
  const p = JSON.parse(rule.params || '{}');
  const c = JSON.parse(rule.criteria || '{}');
  const inst = institutionWhere(c);
  const hits = [];

  switch (rule.trigger) {
    case 'DOC_EXPIRING': {
      const until = new Date(now.getTime() + (Number(p.days) || 30) * DAY);
      const docs = await prisma.complianceDocument.findMany({
        where: { valid_to: { gte: now, lte: until }, status: { in: ['Valid', 'Expiring Soon'] }, ...(p.doc_type ? { doc_type: p.doc_type } : {}), institution: inst },
        include: { institution: true },
      });
      for (const d of docs) {
        const left = Math.ceil((d.valid_to - now) / DAY);
        hits.push({ entity_id: d.id, institution_id: d.institution_id,
          title: `${d.doc_type} expires in ${left} days`,
          detail: `${d.institution.name} — valid till ${fmt(d.valid_to)}. Renewal must be uploaded before expiry.` });
      }
      break;
    }
    case 'DOC_EXPIRED': {
      const docs = await prisma.complianceDocument.findMany({
        where: { status: 'Expired', ...(p.doc_type ? { doc_type: p.doc_type } : {}), institution: inst },
        include: { institution: true },
      });
      for (const d of docs) {
        hits.push({ entity_id: d.id, institution_id: d.institution_id,
          title: `${d.doc_type} EXPIRED`,
          detail: `${d.institution.name} — lapsed on ${fmt(d.valid_to)}, ${Math.floor((now - d.valid_to) / DAY)} days ago. No renewal on file.` });
      }
      break;
    }
    case 'UNDERTAKING_DUE': {
      const until = new Date(now.getTime() + (Number(p.days) || 30) * DAY);
      const rows = await prisma.undertaking.findMany({
        where: { status: 'Pending', due_date: { gte: now, lte: until }, institution: inst },
        include: { institution: true },
      });
      for (const u of rows) {
        hits.push({ entity_id: u.id, institution_id: u.institution_id,
          title: `Undertaking due in ${Math.ceil((u.due_date - now) / DAY)} days: ${u.title}`,
          detail: `${u.institution.name} — compliance proof due ${fmt(u.due_date)}.` });
      }
      break;
    }
    case 'UNDERTAKING_OVERDUE': {
      const rows = await prisma.undertaking.findMany({
        where: { status: 'Overdue', institution: inst },
        include: { institution: true },
      });
      for (const u of rows) {
        hits.push({ entity_id: u.id, institution_id: u.institution_id,
          title: `Undertaking overdue: ${u.title}`,
          detail: `${u.institution.name} — was due ${fmt(u.due_date)} (${Math.floor((now - u.due_date) / DAY)} days ago). Consider show-cause.` });
      }
      break;
    }
    case 'STAGE_SLA_BREACH': {
      const stages = p.stage ? [p.stage] : ACTIVE_STAGES;
      const grace = Number(p.grace_days) || 0;
      const apps = await prisma.application.findMany({
        where: { stage: { in: stages }, institution: inst, ...(c.application_type ? { type: c.application_type } : {}) },
        include: { institution: true },
      });
      for (const a of apps) {
        const s = slaInfo(a, now);
        if (s.sla_days && s.days > s.sla_days + grace) {
          hits.push({ entity_id: a.id, institution_id: a.institution_id,
            title: `${a.app_number} stuck in ${STAGES[a.stage].label} for ${s.days} days`,
            detail: `${a.institution.name} — ${a.type}. SLA is ${s.sla_days} days; ${s.days - s.sla_days} days over.` });
        }
      }
      break;
    }
    case 'EVC_UPCOMING': {
      const until = new Date(now.getTime() + (Number(p.days) || 7) * DAY);
      const visits = await prisma.eVCVisit.findMany({
        where: { status: 'Scheduled', visit_date: { gte: now, lte: until }, application: { institution: inst } },
        include: { application: { include: { institution: true } }, members: { include: { user: true } } },
      });
      for (const v of visits) {
        hits.push({ entity_id: v.id, institution_id: v.application.institution_id,
          title: `EVC visit on ${fmt(v.visit_date)}: ${v.application.institution.name}`,
          detail: `${v.mode} visit for ${v.application.app_number}. Panel: ${v.members.map(m => m.user.name).join(', ')}.` });
      }
      break;
    }
    case 'EVC_REPORT_PENDING': {
      const before = new Date(now.getTime() - (Number(p.days) || 3) * DAY);
      const visits = await prisma.eVCVisit.findMany({
        where: { status: 'Scheduled', visit_date: { lt: before }, application: { institution: inst } },
        include: { application: { include: { institution: true } } },
      });
      for (const v of visits) {
        hits.push({ entity_id: v.id, institution_id: v.application.institution_id,
          title: `EVC report pending ${Math.floor((now - v.visit_date) / DAY)} days after visit`,
          detail: `${v.application.institution.name} (${v.application.app_number}) — visited ${fmt(v.visit_date)}, no report filed.` });
      }
      break;
    }
    case 'DEFICIENCY_OVERDUE': {
      const rows = await prisma.deficiency.findMany({
        where: { status: 'Open', due_date: { lt: now }, application: { institution: inst } },
        include: { application: { include: { institution: true } } },
      });
      for (const d of rows) {
        hits.push({ entity_id: d.id, institution_id: d.application.institution_id,
          title: `Deficiency unanswered: ${d.category}`,
          detail: `${d.application.institution.name} (${d.application.app_number}) — response was due ${fmt(d.due_date)}.` });
      }
      break;
    }
  }
  return hits;
}

async function runRule(rule, now = new Date()) {
  const entity = TRIGGERS[rule.trigger]?.entity || 'Unknown';
  const hits = await matches(rule, now);
  const existing = await prisma.alert.findMany({ where: { rule_id: rule.id } });
  const byEntity = new Map(existing.map(a => [a.entity_id, a]));
  let created = 0;
  const createdAlerts = [];

  for (const h of hits) {
    const prior = byEntity.get(h.entity_id);
    if (prior) {
      // Keep the wording fresh ("expires in 12 days" -> "in 11 days"); reopen if it came back.
      // Reopen only what the engine itself closed; a person's "resolved" stands.
      const reopen = prior.status === 'Resolved' && !prior.acknowledged_by;
      await prisma.alert.update({ where: { id: prior.id }, data: { title: h.title, detail: h.detail, ...(reopen ? { status: 'Open', resolved_at: null, fired_at: now } : {}) } });
      continue;
    }
    const alert = await prisma.alert.create({
      data: { rule_id: rule.id, institution_id: h.institution_id, entity_type: entity, entity_id: h.entity_id, title: h.title, detail: h.detail, severity: rule.severity, fired_at: now },
    });
    created++;
    createdAlerts.push(alert);
  }

  // Auto-resolve alerts whose condition no longer holds.
  const live = new Set(hits.map(h => h.entity_id));
  const stale = existing.filter(a => a.status !== 'Resolved' && !live.has(a.entity_id)).map(a => a.id);
  if (stale.length) await prisma.alert.updateMany({ where: { id: { in: stale } }, data: { status: 'Resolved', resolved_at: now } });

  await prisma.alertRule.update({ where: { id: rule.id }, data: { last_run: now } });

  if (created) await fanOut(rule, createdAlerts);
  return { rule_id: rule.id, name: rule.name, matched: hits.length, created, auto_resolved: stale.length };
}

// Staff get one digest line per rule run; institutions get each alert that concerns them.
async function fanOut(rule, alerts) {
  const roles = (rule.notify_roles || '').split(',').map(s => s.trim()).filter(Boolean);
  if (roles.length) {
    const staff = await prisma.user.findMany({ where: { role: { in: roles }, status: 'Active' } });
    for (const u of staff) {
      await notify({ userId: u.id, type: 'ALERT', message: `[${rule.severity}] ${rule.name}: ${alerts.length} new alert${alerts.length > 1 ? 's' : ''}`, relatedEntityType: 'AlertRule', relatedEntityId: rule.id });
    }
  }
  if (rule.notify_institution) {
    for (const a of alerts) {
      if (!a.institution_id) continue;
      const users = await prisma.user.findMany({ where: { institution_id: a.institution_id, role: 'Institution' } });
      for (const u of users) {
        await notify({ userId: u.id, type: 'ALERT', message: a.title, relatedEntityType: a.entity_type, relatedEntityId: a.entity_id });
      }
    }
  }
}

let running = false;
async function runAll({ ruleId } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    const now = new Date();
    await loadSlaOverrides(prisma);
    const sweep = await sweepStatuses(now);
    const rules = await prisma.alertRule.findMany({ where: { active: true, ...(ruleId ? { id: ruleId } : {}) } });
    const results = [];
    for (const r of rules) results.push(await runRule(r, now));
    return { ran_at: now, sweep, results };
  } finally {
    running = false;
  }
}

function startScheduler(minutes = Number(process.env.ALERT_INTERVAL_MIN) || 10) {
  setTimeout(() => runAll().then(r => console.log(`[Alerts] startup run: ${r.results?.reduce((s, x) => s + x.created, 0) || 0} new alerts`)).catch(e => console.error('[Alerts]', e.message)), 3000);
  setInterval(() => runAll().catch(e => console.error('[Alerts]', e.message)), minutes * 60 * 1000);
}

module.exports = { TRIGGERS, matches, runRule, runAll, startScheduler };
