const express = require('express');
const prisma = require('../../shared/prismaClient');
const authenticate = require('../../shared/authenticate');
const { STAGES, ACTIVE_STAGES, slaInfo, DAY } = require('../../shared/workflow');
const { institutionScores, scoreFrom } = require('../../shared/compliance');
const { appScope, instScope, ok, h } = require('../../shared/scope');

const router = express.Router();
router.use(authenticate);

router.get('/overview', h(async (req, res) => {
  const now = new Date();
  const user = req.user;
  const aScope = appScope(user);
  const iScope = instScope(user);

  const [apps, docs, undertakings, visits, alerts, regions, transitions] = await Promise.all([
    prisma.application.findMany({ where: aScope, include: { institution: { include: { region: true } } } }),
    prisma.complianceDocument.findMany({ where: { institution: iScope, status: { not: 'Superseded' } }, include: { institution: true } }),
    prisma.undertaking.findMany({ where: { institution: iScope }, include: { institution: true } }),
    prisma.eVCVisit.findMany({
      where: { application: aScope, ...(user.role === 'Expert' ? { members: { some: { user_id: user.id } } } : {}) },
      include: { application: { include: { institution: true } }, members: { include: { user: { select: { name: true } } } } },
      orderBy: { visit_date: 'asc' },
    }),
    prisma.alert.findMany({ where: { status: 'Open', ...(user.role === 'Admin' ? {} : { institution: iScope }) }, include: { institution: { select: { name: true } } }, orderBy: { fired_at: 'desc' } }),
    prisma.region.findMany({ orderBy: { code: 'asc' } }),
    prisma.stageTransition.findMany({ where: { application: aScope, created_at: { gte: new Date(now.getTime() - 185 * DAY) } }, select: { to_stage: true, from_stage: true, created_at: true, days_in_stage: true, sla_breached: true } }),
  ]);

  const active = apps.filter(a => !STAGES[a.stage].terminal).map(a => ({ ...a, sla: slaInfo(a, now) }));
  const in7 = new Date(now.getTime() + 7 * DAY);

  const kpis = {
    active_applications: active.length,
    sla_breached: active.filter(a => a.sla.breached).length,
    evc_next_7_days: visits.filter(v => v.status === 'Scheduled' && v.visit_date >= now && v.visit_date <= in7).length,
    evc_reports_pending: visits.filter(v => v.status === 'Scheduled' && v.visit_date < now).length,
    docs_expiring: docs.filter(d => d.status === 'Expiring Soon').length,
    docs_expired: docs.filter(d => d.status === 'Expired').length,
    undertakings_overdue: undertakings.filter(u => u.status === 'Overdue').length,
    undertakings_due_30: undertakings.filter(u => u.status === 'Pending' && u.due_date <= new Date(now.getTime() + 30 * DAY)).length,
    open_alerts: alerts.length,
    critical_alerts: alerts.filter(a => a.severity === 'Critical').length,
    decided_this_year: apps.filter(a => a.decided_at && a.decided_at.getFullYear() === now.getFullYear()).length,
  };

  const pipeline = ACTIVE_STAGES.map(s => {
    const here = active.filter(a => a.stage === s);
    return {
      stage: s, label: STAGES[s].short, full_label: STAGES[s].label, color: STAGES[s].color, sla_days: STAGES[s].sla_days,
      count: here.length, breached: here.filter(a => a.sla.breached).length, within: here.filter(a => !a.sla.breached).length,
      avg_days: here.length ? Math.round(here.reduce((t, a) => t + a.sla.days, 0) / here.length) : 0,
    };
  });

  const buckets = [['0–7 days', 0, 7], ['8–15 days', 8, 15], ['16–30 days', 16, 30], ['31–60 days', 31, 60], ['60+ days', 61, 99999]]
    .map(([label, lo, hi]) => ({ label, count: active.filter(a => a.sla.days >= lo && a.sla.days <= hi).length }));

  const heatmap = regions.map(r => {
    const row = { region: r.code, region_name: r.name };
    for (const s of ACTIVE_STAGES) row[s] = active.filter(a => a.institution.region_id === r.id && a.stage === s).length;
    row.total = ACTIVE_STAGES.reduce((t, s) => t + row[s], 0);
    row.breached = active.filter(a => a.institution.region_id === r.id && a.sla.breached).length;
    return row;
  }).filter(r => user.role === 'Admin' || r.total > 0);

  const outcomes = ['APPROVED', 'CONDITIONAL', 'REJECTED', 'WITHDRAWN'].map(s => ({ stage: s, label: STAGES[s].short, color: STAGES[s].color, count: apps.filter(a => a.stage === s).length }));

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const inMonth = transitions.filter(t => t.created_at >= d && t.created_at < next);
    months.push({
      month: d.toLocaleString('en-IN', { month: 'short' }),
      submitted: inMonth.filter(t => t.to_stage === 'SUBMITTED').length,
      decided: inMonth.filter(t => ['APPROVED', 'CONDITIONAL', 'REJECTED'].includes(t.to_stage)).length,
      breaches: inMonth.filter(t => t.sla_breached).length,
    });
  }

  // Stage SLA adherence from completed stage hops
  const adherence = ACTIVE_STAGES.map(s => {
    const hops = transitions.filter(t => t.from_stage === s);
    return { stage: s, label: STAGES[s].short, hops: hops.length, on_time: hops.length ? Math.round(100 * hops.filter(t => !t.sla_breached).length / hops.length) : null, avg_days: hops.length ? Math.round(hops.reduce((x, t) => x + t.days_in_stage, 0) / hops.length) : null };
  }).filter(a => a.hops > 0);

  const sevOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const top_alerts = [...alerts].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || b.fired_at - a.fired_at).slice(0, 8);
  const upcoming_visits = visits.filter(v => v.status === 'Scheduled').slice(0, 6);
  const longest_pending = [...active].sort((a, b) => (b.sla.days - (b.sla.sla_days || 0)) - (a.sla.days - (a.sla.sla_days || 0))).slice(0, 6)
    .map(a => ({ id: a.id, app_number: a.app_number, institution: a.institution.name, stage: a.stage, stage_label: STAGES[a.stage].label, type: a.type, sla: a.sla }));

  let compliance = null;
  if (user.role !== 'Expert') {
    const scores = await institutionScores(iScope);
    compliance = {
      grades: ['A', 'B', 'C', 'D'].map(g => ({ grade: g, count: scores.filter(s => s.grade === g).length })),
      average: scores.length ? Math.round(scores.reduce((t, s) => t + s.score, 0) / scores.length) : null,
      worst: scores.sort((a, b) => a.score - b.score).slice(0, 5).map(s => ({ id: s.inst.id, name: s.inst.name, score: s.score, grade: s.grade, reason: s.reasons[0]?.reason })),
    };
  }

  let institution = null;
  if (user.role === 'Institution' && user.institution_id) {
    const inst = await prisma.institution.findUnique({ where: { id: user.institution_id }, include: { region: true } });
    const defs = await prisma.deficiency.findMany({ where: { application: { institution_id: inst.id } }, include: { application: { select: { id: true, app_number: true } } } });
    const s = scoreFrom({ documents: docs, undertakings, deficiencies: defs, alerts });
    institution = { ...inst, compliance: s, open_deficiencies: defs.filter(d => d.status === 'Open') };
  }

  ok(res, {
    role: user.role, kpis, pipeline, buckets, heatmap, outcomes, months, adherence, top_alerts, upcoming_visits, longest_pending, compliance, institution,
    my_applications: user.role === 'Institution' ? apps.map(a => ({ ...a, sla: slaInfo(a, now), stage_label: STAGES[a.stage].label })) : undefined,
    expiring_docs: docs.filter(d => ['Expiring Soon', 'Expired'].includes(d.status)).sort((a, b) => a.valid_to - b.valid_to).slice(0, 8),
    due_undertakings: undertakings.filter(u => ['Pending', 'Overdue'].includes(u.status)).sort((a, b) => a.due_date - b.due_date).slice(0, 8),
    pending_reports: user.role === 'Expert' ? visits.filter(v => v.status === 'Scheduled' && v.visit_date < now) : undefined,
  });
}));

module.exports = router;
