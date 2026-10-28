// An English sentence in, an alert rule out (ported from odoo_2026's compiler).
//
// It never runs what the model produced. It returns a *proposal*, validated
// against the real trigger vocabulary, document types and region codes, which
// the officer reads and saves. A keyword parser sits underneath so a machine
// with no GPU still gets something useful, and says plainly that it ran.

const prisma = require('../../shared/prismaClient');
const { chat } = require('../../shared/llm');
const { TRIGGERS } = require('./engine');
const { STAGES } = require('../../shared/workflow');

const DOC_TYPES = ['Land Lease Deed', 'Fire Safety NOC', 'Building Completion Certificate', 'Structural Stability Certificate', 'Affiliation Letter', 'Corpus Fund FD', 'Society/Trust Registration', 'Land Use Conversion', 'Accreditation (NBA/NAAC)'];
const INST_TYPES = ['Engineering', 'Management', 'Pharmacy', 'Architecture', 'Polytechnic', 'MCA', 'HMCT'];
const DOC_WORDS = [
  [/lease/, 'Land Lease Deed'], [/fire|noc/, 'Fire Safety NOC'], [/completion|occupancy/, 'Building Completion Certificate'],
  [/structur|stabilit/, 'Structural Stability Certificate'], [/affiliat/, 'Affiliation Letter'], [/corpus|fd|fixed deposit/, 'Corpus Fund FD'],
  [/society|trust/, 'Society/Trust Registration'], [/land use|conversion|na order/, 'Land Use Conversion'], [/nba|naac|accredit/, 'Accreditation (NBA/NAAC)'],
];
const STAGE_WORDS = [[/re-?scrutiny/, 'RESCRUTINY'], [/scrutiny/, 'SCRUTINY'], [/evc|expert visit/, 'EVC'], [/\bec\b|executive/, 'EC_REVIEW'], [/\bsac\b|appeal/, 'SAC'], [/\bshc\b|hearing/, 'SHC'], [/deficien/, 'DEFICIENCY']];

function days(text) {
  const m = text.match(/(\d+)\s*(day|week|month)/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].startsWith('week') ? n * 7 : m[2].startsWith('month') ? n * 30 : n;
}

async function heuristic(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const params = {};
  const criteria = {};
  let trigger = null;

  const docType = DOC_WORDS.find(([re]) => re.test(t))?.[1];
  const n = days(t);

  if (/undertaking|condition|commitment/.test(t)) {
    trigger = /overdue|missed|past due|lapsed|breach/.test(t) ? 'UNDERTAKING_OVERDUE' : 'UNDERTAKING_DUE';
  } else if (/deficien/.test(t) && /overdue|not respond|unanswered|no response|ignored/.test(t)) {
    trigger = 'DEFICIENCY_OVERDUE';
  } else if (/report/.test(t) && /evc|visit|expert/.test(t)) {
    trigger = 'EVC_REPORT_PENDING';
  } else if (/visit|evc|inspection/.test(t) && /upcoming|before|ahead|scheduled|next/.test(t)) {
    trigger = 'EVC_UPCOMING';
  } else if (/sla|stuck|pending|pendency|delay|longer than|beyond|lying/.test(t)) {
    trigger = 'STAGE_SLA_BREACH';
  } else if (docType || /document|certificate|deed|noc|expir/.test(t)) {
    trigger = /already expired|has expired|lapsed|expired/.test(t) && !/before|ahead|within|in \d/.test(t) ? 'DOC_EXPIRED' : 'DOC_EXPIRING';
  }
  if (!trigger) return null;

  if (['DOC_EXPIRING', 'DOC_EXPIRED'].includes(trigger) && docType) params.doc_type = docType;
  if (['DOC_EXPIRING', 'UNDERTAKING_DUE', 'EVC_UPCOMING', 'EVC_REPORT_PENDING'].includes(trigger)) params.days = n || (trigger === 'EVC_UPCOMING' ? 7 : trigger === 'EVC_REPORT_PENDING' ? 3 : 30);
  if (trigger === 'STAGE_SLA_BREACH') {
    const st = STAGE_WORDS.find(([re]) => re.test(t))?.[1];
    if (st) params.stage = st;
    if (n) params.grace_days = n;
  }

  const regions = await prisma.region.findMany();
  for (const r of regions) {
    const word = r.name.toLowerCase().replace(' regional office', '').replace(/-/g, ' ');
    if (t.includes(r.code.toLowerCase() + ' ') || t.includes(word) || t.includes(r.city.toLowerCase())) { criteria.region = r.code; break; }
  }
  const it = INST_TYPES.find(x => t.includes(x.toLowerCase()) || (x === 'Engineering' && /engineer|b\.?tech/.test(t)));
  if (it) criteria.institution_type = it;

  const severity = /critical|urgent|immediately|show.?cause/.test(t) ? 'Critical' : /important|high|escalat/.test(t) ? 'High' : /low|fyi|gentle/.test(t) ? 'Low' : 'Medium';
  return { trigger, params, criteria, severity };
}

function sanitize(p, regions) {
  if (!p || !TRIGGERS[p.trigger]) return null;
  const allowed = TRIGGERS[p.trigger].params;
  const params = {};
  for (const k of allowed) {
    const v = p.params?.[k];
    if (v === undefined || v === null || v === '') continue;
    if (k === 'doc_type' && !DOC_TYPES.includes(v)) continue;
    if (k === 'stage' && !STAGES[v]) continue;
    params[k] = ['days', 'grace_days'].includes(k) ? Math.max(0, Math.min(365, Number(v) || 0)) : v;
  }
  const criteria = {};
  if (p.criteria?.region && regions.some(r => r.code === p.criteria.region)) criteria.region = p.criteria.region;
  if (p.criteria?.institution_type && INST_TYPES.includes(p.criteria.institution_type)) criteria.institution_type = p.criteria.institution_type;
  const severity = ['Low', 'Medium', 'High', 'Critical'].includes(p.severity) ? p.severity : 'Medium';
  return { trigger: p.trigger, params, criteria, severity };
}

function describe(p, regions) {
  const T = TRIGGERS[p.trigger]?.label || p.trigger;
  const bits = [T];
  if (p.params.doc_type) bits.push(`for ${p.params.doc_type}`);
  if (p.params.days) bits.push(`within ${p.params.days} days`);
  if (p.params.stage) bits.push(`at ${STAGES[p.params.stage].label}`);
  if (p.params.grace_days) bits.push(`(+${p.params.grace_days} days grace)`);
  if (p.criteria.region) bits.push(`in ${regions.find(r => r.code === p.criteria.region)?.name}`);
  if (p.criteria.institution_type) bits.push(`for ${p.criteria.institution_type} institutions`);
  return bits.join(' ') + ` — severity ${p.severity}`;
}

function autoName(p) {
  const base = TRIGGERS[p.trigger].label;
  return [p.params.doc_type, base, p.criteria.region, p.criteria.institution_type].filter(Boolean).join(' · ');
}

// Is the sentence about something this system can watch at all? Keeps the
// model from turning "make me a sandwich" into a plausible-looking rule.
const DOMAIN = /lease|noc|fire|document|certificat|deed|affiliat|corpus|accredit|nba|naac|expir|renew|lapse|valid|undertaking|condition|deficien|visit|evc|inspection|expert|scrutiny|sla|stuck|pending|pendency|delay|late|overdue|due|stage|appeal|sac|shc|hearing|committee|application|approval|report/i;

async function compile(text) {
  if (!DOMAIN.test(text)) return { ok: false, engine: 'guard', message: 'That does not describe anything this system monitors. Mention a document, undertaking, deficiency, EVC visit or approval stage, e.g. "Warn me 45 days before any lease deed in the Southern region expires".' };
  const regions = await prisma.region.findMany();
  let engine = 'ai';
  let proposal = null;
  try {
    const prompt = [
      'Convert an AICTE compliance officer\'s sentence into a monitoring rule. Return JSON only.',
      'TRIGGERS (pick one):',
      ...Object.entries(TRIGGERS).map(([k, v]) => `  ${k}: ${v.label}; params: ${v.params.join(', ') || 'none'}`),
      `doc_type must be one of: ${DOC_TYPES.join(' | ')}`,
      `stage must be one of: ${Object.keys(STAGES).filter(s => !STAGES[s].terminal).join(', ')}`,
      `criteria.region must be a code from: ${regions.map(r => `${r.code} (${r.name}, ${r.city})`).join('; ')}`,
      `criteria.institution_type from: ${INST_TYPES.join(', ')}`,
      'severity: Low | Medium | High | Critical. days and grace_days are whole numbers of days.',
      'Include only what the sentence asks for.',
      `SENTENCE: ${text}`,
      'JSON shape: {"trigger":"...","params":{...},"criteria":{...},"severity":"...","name":"short rule name"}',
    ].join('\n');
    const { message } = await chat([{ role: 'user', content: prompt }], { json: true, timeout: 45000 });
    const raw = JSON.parse(message.content);
    proposal = sanitize(raw, regions);
    if (proposal && raw.name) proposal.name = String(raw.name).slice(0, 80);
  } catch {
    proposal = null;
  }
  if (!proposal) {
    engine = 'keyword';
    proposal = sanitize(await heuristic(text), regions);
  }
  if (!proposal) return { ok: false, engine, message: 'Could not understand that rule. Try: "Warn me 45 days before any lease deed in the Southern region expires".' };
  proposal.name = proposal.name || autoName(proposal);
  return { ok: true, engine, proposal, reading: describe(proposal, regions) };
}

module.exports = { compile, DOC_TYPES, INST_TYPES };
