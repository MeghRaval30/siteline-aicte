const prisma = require('../../shared/prismaClient');
const { STAGES, ACTIVE_STAGES, slaInfo, DAY } = require('../../shared/workflow');
const { institutionScores } = require('../../shared/compliance');
const { appScope, instScope } = require('../../shared/scope');

const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const stageCode = s => {
  if (!s) return null;
  const up = String(s).toUpperCase().replace(/[^A-Z_]/g, '');
  if (STAGES[up]) return up;
  const hit = Object.entries(STAGES).find(([, v]) => v.label.toUpperCase().includes(String(s).toUpperCase()) || v.short.toUpperCase() === String(s).toUpperCase());
  return hit ? hit[0] : null;
};
const regionWhere = async region => {
  if (!region) return {};
  const r = await prisma.region.findFirst({ where: { OR: [{ code: String(region).toUpperCase() }, { name: { contains: region } }, { city: { contains: region } }] } });
  return r ? { region_id: r.id } : {};
};

// Every tool takes (args, user) so answers respect the asker's scope.
const TOOL_FUNCTIONS = {
  async pendency_by_stage(args, user) {
    const inst = await regionWhere(args.region);
    const apps = await prisma.application.findMany({ where: { AND: [appScope(user), { stage: { in: ACTIVE_STAGES } }, { institution: inst }] } });
    return ACTIVE_STAGES.map(s => {
      const here = apps.filter(a => a.stage === s).map(a => slaInfo(a));
      return { stage: STAGES[s].label, sla_days: STAGES[s].sla_days, pending: here.length, sla_breached: here.filter(x => x.breached).length, avg_days_in_stage: here.length ? Math.round(here.reduce((t, x) => t + x.days, 0) / here.length) : 0 };
    }).filter(r => r.pending > 0);
  },

  async pendency_by_region(args, user) {
    const apps = await prisma.application.findMany({ where: { AND: [appScope(user), { stage: { in: ACTIVE_STAGES } }] }, include: { institution: { include: { region: true } } } });
    const by = {};
    for (const a of apps) {
      const r = a.institution.region; const s = slaInfo(a);
      by[r.code] = by[r.code] || { region: `${r.name} (${r.code})`, pending: 0, sla_breached: 0, days: 0 };
      by[r.code].pending++; by[r.code].days += s.days; if (s.breached) by[r.code].sla_breached++;
    }
    return Object.values(by).map(x => ({ region: x.region, pending: x.pending, sla_breached: x.sla_breached, avg_days_in_stage: Math.round(x.days / x.pending) })).sort((a, b) => b.sla_breached - a.sla_breached || b.pending - a.pending);
  },

  async list_applications(args, user) {
    const where = { AND: [appScope(user)] };
    const st = stageCode(args.stage);
    if (st) where.AND.push({ stage: st });
    if (args.type) where.AND.push({ type: { contains: args.type } });
    if (args.institution) where.AND.push({ institution: { name: { contains: args.institution } } });
    if (args.region) where.AND.push({ institution: await regionWhere(args.region) });
    let apps = (await prisma.application.findMany({ where, include: { institution: true }, orderBy: { stage_entered_at: 'asc' } })).map(a => ({ a, s: slaInfo(a) }));
    if (args.sla_breached) apps = apps.filter(x => x.s.breached);
    if (args.min_days) apps = apps.filter(x => x.s.days >= Number(args.min_days));
    return { total: apps.length, applications: apps.slice(0, Number(args.limit) || 12).map(({ a, s }) => ({ app_number: a.app_number, institution: a.institution.name, type: a.type, stage: STAGES[a.stage].label, days_in_stage: s.days, sla_days: s.sla_days, breached: s.breached })) };
  },

  async application_status(args, user) {
    const a = await prisma.application.findFirst({
      where: { AND: [appScope(user), { OR: [{ app_number: { contains: args.query } }, { institution: { name: { contains: args.query } } }] }] },
      include: { institution: true, transitions: { orderBy: { created_at: 'asc' } }, deficiencies: true, evc_visits: true, undertakings: true },
      orderBy: { created_at: 'desc' },
    });
    if (!a) return { error: `No application matching "${args.query}"` };
    const s = slaInfo(a);
    return {
      app_number: a.app_number, institution: a.institution.name, type: a.type, status: a.status, stage: STAGES[a.stage].label,
      days_in_stage: s.days, sla_days: s.sla_days, sla_breached: s.breached, submitted: fmt(a.submitted_at),
      history: a.transitions.map(t => `${fmt(t.created_at)}: ${t.from_stage ? STAGES[t.from_stage].short + ' → ' : ''}${STAGES[t.to_stage].short}${t.sla_breached ? ' (SLA breached)' : ''}`),
      open_deficiencies: a.deficiencies.filter(d => d.status === 'Open').map(d => `${d.category}: ${d.description}`),
      evc_visits: a.evc_visits.map(v => `${fmt(v.visit_date)} ${v.status}${v.recommendation ? ' — ' + v.recommendation : ''}`),
      undertakings: a.undertakings.map(u => `${u.title} due ${fmt(u.due_date)} (${u.status})`),
    };
  },

  async expiring_documents(args, user) {
    const days = Number(args.days) || 60;
    const where = { AND: [{ institution: { ...instScope(user), ...(await regionWhere(args.region)) } }] };
    if (args.doc_type) where.AND.push({ doc_type: { contains: args.doc_type } });
    if (args.include_expired) where.AND.push({ OR: [{ status: 'Expired' }, { valid_to: { gte: new Date(), lte: new Date(Date.now() + days * DAY) }, status: { in: ['Valid', 'Expiring Soon'] } }] });
    else where.AND.push({ valid_to: { gte: new Date(), lte: new Date(Date.now() + days * DAY) }, status: { in: ['Valid', 'Expiring Soon'] } });
    const docs = await prisma.complianceDocument.findMany({ where, include: { institution: true }, orderBy: { valid_to: 'asc' } });
    return { total: docs.length, documents: docs.slice(0, 15).map(d => ({ institution: d.institution.name, document: d.doc_type, valid_to: fmt(d.valid_to), status: d.status, days_left: Math.ceil((d.valid_to - Date.now()) / DAY) })) };
  },

  async undertakings_status(args, user) {
    const where = { AND: [{ institution: instScope(user) }] };
    if (args.status) where.AND.push({ status: args.status });
    else where.AND.push({ status: { in: ['Pending', 'Overdue', 'Submitted'] } });
    const rows = await prisma.undertaking.findMany({ where, include: { institution: true }, orderBy: { due_date: 'asc' } });
    return { total: rows.length, overdue: rows.filter(r => r.status === 'Overdue').length, undertakings: rows.slice(0, 15).map(u => ({ institution: u.institution.name, undertaking: u.title, due: fmt(u.due_date), status: u.status })) };
  },

  async evc_schedule(args, user) {
    const days = Number(args.days) || 30;
    const where = { AND: [{ application: appScope(user) }] };
    if (args.pending_reports) where.AND.push({ status: 'Scheduled', visit_date: { lt: new Date() } });
    else where.AND.push({ status: 'Scheduled', visit_date: { gte: new Date(), lte: new Date(Date.now() + days * DAY) } });
    if (user.role === 'Expert') where.AND.push({ members: { some: { user_id: user.id } } });
    const visits = await prisma.eVCVisit.findMany({ where, include: { application: { include: { institution: true } }, members: { include: { user: true } } }, orderBy: { visit_date: 'asc' } });
    return { total: visits.length, visits: visits.slice(0, 15).map(v => ({ date: fmt(v.visit_date), institution: v.application.institution.name, application: v.application.app_number, mode: v.mode, panel: v.members.map(m => m.user.name).join(', ') })) };
  },

  async compliance_ranking(args, user) {
    const where = { ...instScope(user), ...(await regionWhere(args.region)) };
    const rows = await institutionScores(where);
    rows.sort((a, b) => args.best ? b.score - a.score : a.score - b.score);
    return rows.slice(0, Number(args.limit) || 8).map(r => ({ institution: r.inst.name, aicte_id: r.inst.aicte_id, score: r.score, grade: r.grade, risk: r.risk, issues: r.reasons.slice(0, 3).map(x => x.reason) }));
  },

  async institution_profile(args, user) {
    const [r] = await institutionScores({ AND: [instScope(user), { OR: [{ name: { contains: args.name } }, { aicte_id: { contains: args.name } }] }] });
    if (!r) return { error: `No institution matching "${args.name}"` };
    return {
      name: r.inst.name, aicte_id: r.inst.aicte_id, type: r.inst.type, city: r.inst.city, state: r.inst.state, region: r.inst.region.name, status: r.inst.status,
      compliance_score: r.score, grade: r.grade, issues: r.reasons.map(x => x.reason),
      applications: r.inst.applications.map(a => `${a.app_number} ${a.type}: ${STAGES[a.stage].label}`),
      documents: r.inst.documents.filter(d => d.status !== 'Superseded').map(d => `${d.doc_type}: ${d.status}${d.valid_to ? ' (till ' + fmt(d.valid_to) + ')' : ''}`),
    };
  },

  async open_alerts(args, user) {
    const where = { status: 'Open', ...(args.severity ? { severity: args.severity } : {}), ...(user.role === 'Admin' ? {} : { institution: instScope(user) }) };
    const rows = await prisma.alert.findMany({ where, include: { institution: true }, orderBy: { fired_at: 'desc' } });
    const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    rows.sort((a, b) => order[a.severity] - order[b.severity]);
    return { total: rows.length, critical: rows.filter(r => r.severity === 'Critical').length, alerts: rows.slice(0, 12).map(a => ({ severity: a.severity, title: a.title, institution: a.institution?.name })) };
  },
};

const p = (props, required = []) => ({ type: 'object', properties: props, required });
const TOOL_SCHEMAS = [
  { type: 'function', function: { name: 'pendency_by_stage', description: 'Stage-wise pendency: how many applications are pending at each approval stage, SLA breaches and average days', parameters: p({ region: { type: 'string', description: 'Regional office code or city, optional' } }) } },
  { type: 'function', function: { name: 'pendency_by_region', description: 'Pending applications and SLA breaches grouped by AICTE Regional Office, worst first. Use for any question comparing regions.', parameters: p({}) } },
  { type: 'function', function: { name: 'list_applications', description: 'List applications filtered by stage, type, institution, region, SLA breach or minimum days in stage', parameters: p({ stage: { type: 'string', description: 'SCRUTINY, DEFICIENCY, RESCRUTINY, EVC, EC_REVIEW, SAC, SHC, SUBMITTED' }, type: { type: 'string' }, institution: { type: 'string' }, region: { type: 'string' }, sla_breached: { type: 'boolean' }, min_days: { type: 'integer' }, limit: { type: 'integer' } }) } },
  { type: 'function', function: { name: 'application_status', description: 'Full status and history of one application by application number or institution name', parameters: p({ query: { type: 'string' } }, ['query']) } },
  { type: 'function', function: { name: 'expiring_documents', description: 'Compliance documents (lease deed, fire NOC, etc.) expiring within N days, optionally including already expired', parameters: p({ days: { type: 'integer' }, doc_type: { type: 'string' }, region: { type: 'string' }, include_expired: { type: 'boolean' } }) } },
  { type: 'function', function: { name: 'undertakings_status', description: 'Time-bound undertakings from conditional approvals and their status (Pending, Overdue, Submitted, Verified, Breached)', parameters: p({ status: { type: 'string' } }) } },
  { type: 'function', function: { name: 'evc_schedule', description: 'Upcoming Expert Visit Committee visits within N days, or visits whose reports are pending', parameters: p({ days: { type: 'integer' }, pending_reports: { type: 'boolean' } }) } },
  { type: 'function', function: { name: 'compliance_ranking', description: 'Institutions ranked by compliance health score (worst first unless best=true)', parameters: p({ region: { type: 'string' }, best: { type: 'boolean' }, limit: { type: 'integer' } }) } },
  { type: 'function', function: { name: 'institution_profile', description: 'Profile of one institution: compliance score, issues, applications, documents', parameters: p({ name: { type: 'string' } }, ['name']) } },
  { type: 'function', function: { name: 'open_alerts', description: 'Open compliance alerts, optionally by severity', parameters: p({ severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] } }) } },
];

module.exports = { TOOL_SCHEMAS, TOOL_FUNCTIONS };
