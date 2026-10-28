const { TOOL_SCHEMAS, TOOL_FUNCTIONS } = require('./tools');
const { chat } = require('../../shared/llm');

const MAX_ITERATIONS = 5;

const SYSTEM_PROMPT = `You are SiteLine AI, the assistant inside AICTE's approval workflow and compliance monitoring system.
You answer questions about institution applications moving through approval stages (Submitted, Scrutiny, Deficiency, Re-Scrutiny, Expert Visit Committee (EVC), Executive Committee, SAC appeal, SHC hearing), stage-wise pendency and SLA breaches, EVC scheduling, time-bound undertakings from conditional approvals, compliance documents and their validity (lease deeds, fire NOCs, etc.), institution compliance scores and alerts.
Always call a tool to get real data before answering. Use pendency_by_region for questions comparing Regional Offices and pendency_by_stage for stages; never confuse the two. If a question is not about AICTE approvals or compliance, say you can only help with those. You are read-only and cannot modify, delete or approve anything. Be concise and specific: quote application numbers, institution names, dates and counts. Use short bullet lists. Never invent data.`;

// Deterministic intent router: the floor under the feature, so the assistant
// still answers when no local model is running. It says plainly that it ran.
function route(q) {
  const t = q.toLowerCase();
  const days = Number((t.match(/(\d+)\s*day/) || [])[1]) || undefined;
  const appNo = (q.match(/APH\/[\w/]+/i) || [])[0];
  if (appNo) return ['application_status', { query: appNo }];
  if (/status of|where is|track/.test(t)) {
    const name = q.replace(/.*(status of|where is|track)\s*/i, '').replace(/[?.]$/, '');
    return ['application_status', { query: name }];
  }
  if (/region|regional office|ro|zone|which office/.test(t) && !/lease|noc|document|undertaking/.test(t)) return ['pendency_by_region', {}];
  if (/alert|critical|urgent/.test(t)) return ['open_alerts', /critical/.test(t) ? { severity: 'Critical' } : {}];
  if (/undertaking|condition/.test(t)) return ['undertakings_status', /overdue/.test(t) ? { status: 'Overdue' } : {}];
  if (/lease|noc|document|certificate|expir|validity|renew/.test(t)) {
    const doc = /lease/.test(t) ? 'Lease' : /fire|noc/.test(t) ? 'Fire' : undefined;
    return ['expiring_documents', { days: days || 60, doc_type: doc, include_expired: /expired|lapsed/.test(t) }];
  }
  if (/evc|visit|expert|inspection/.test(t)) return ['evc_schedule', /report/.test(t) ? { pending_reports: true } : { days: days || 30 }];
  if (/score|complian|risk|worst|best|rank/.test(t)) return ['compliance_ranking', { best: /best|top|highest/.test(t) }];
  if (/profile|about|tell me about|institute of|college/.test(t)) {
    const name = q.replace(/.*(profile of|about|tell me about)\s*/i, '').replace(/[?.]$/, '');
    return ['institution_profile', { name }];
  }
  if (/stuck|breach|sla|delay|overdue|longest/.test(t)) return ['list_applications', { sla_breached: true }];
  const stage = /re-?scrutiny/.test(t) ? 'RESCRUTINY' : /scrutiny/.test(t) ? 'SCRUTINY' : /deficien/.test(t) ? 'DEFICIENCY' : /\bsac\b|appeal/.test(t) ? 'SAC' : /\bshc\b|hearing/.test(t) ? 'SHC' : /executive|\bec\b/.test(t) ? 'EC_REVIEW' : null;
  if (stage) return ['list_applications', { stage }];
  if (/pend|stage|pipeline|how many|count|status|overview|summary|backlog/.test(t)) return ['pendency_by_stage', {}];
  return ['out_of_scope', {}];
}

function summarize(tool, r) {
  if (r?.error) return r.error;
  const lines = [];
  switch (tool) {
    case 'pendency_by_region':
      lines.push('Pendency by Regional Office (most SLA breaches first):');
      r.forEach(x => lines.push(`• ${x.region}: ${x.pending} pending, ${x.sla_breached} past SLA, avg ${x.avg_days_in_stage} days in stage`));
      break;
    case 'pendency_by_stage':
      lines.push('Stage-wise pendency right now:');
      r.forEach(x => lines.push(`• ${x.stage}: ${x.pending} pending (${x.sla_breached} past the ${x.sla_days}-day SLA), avg ${x.avg_days_in_stage} days`));
      break;
    case 'list_applications':
      lines.push(`${r.total} application(s) found${r.total > r.applications.length ? `, showing ${r.applications.length}` : ''}:`);
      r.applications.forEach(a => lines.push(`• ${a.app_number} — ${a.institution} (${a.type}) at ${a.stage}, ${a.days_in_stage} days${a.breached ? ` ⚠ SLA ${a.sla_days}d breached` : ''}`));
      break;
    case 'application_status':
      lines.push(`${r.app_number} — ${r.institution}`, `${r.type} · ${r.status} · currently at ${r.stage} for ${r.days_in_stage} days${r.sla_breached ? ` (SLA ${r.sla_days}d breached)` : ''}`, '', 'History:');
      r.history.forEach(x => lines.push(`• ${x}`));
      if (r.open_deficiencies.length) { lines.push('', 'Open deficiencies:'); r.open_deficiencies.forEach(x => lines.push(`• ${x}`)); }
      if (r.evc_visits.length) { lines.push('', 'EVC:'); r.evc_visits.forEach(x => lines.push(`• ${x}`)); }
      if (r.undertakings.length) { lines.push('', 'Undertakings:'); r.undertakings.forEach(x => lines.push(`• ${x}`)); }
      break;
    case 'expiring_documents':
      lines.push(`${r.total} document(s) need attention:`);
      r.documents.forEach(d => lines.push(`• ${d.institution} — ${d.document}, ${d.status === 'Expired' ? `EXPIRED ${d.valid_to}` : `valid till ${d.valid_to} (${d.days_left} days)`}`));
      break;
    case 'undertakings_status':
      lines.push(`${r.total} undertaking(s), ${r.overdue} overdue:`);
      r.undertakings.forEach(u => lines.push(`• ${u.institution} — ${u.undertaking}, due ${u.due} [${u.status}]`));
      break;
    case 'evc_schedule':
      lines.push(`${r.total} visit(s):`);
      r.visits.forEach(v => lines.push(`• ${v.date} — ${v.institution} (${v.application}), ${v.mode}. Panel: ${v.panel}`));
      break;
    case 'compliance_ranking':
      lines.push('Compliance health ranking:');
      r.forEach(x => lines.push(`• ${x.institution} — ${x.score}/100 (grade ${x.grade}, ${x.risk} risk)${x.issues.length ? ': ' + x.issues.join('; ') : ''}`));
      break;
    case 'institution_profile':
      lines.push(`${r.name} (${r.aicte_id}) — ${r.type}, ${r.city}, ${r.state} · ${r.region}`, `Compliance score ${r.compliance_score}/100, grade ${r.grade}. Status: ${r.status}`);
      if (r.issues.length) { lines.push('', 'Issues:'); r.issues.forEach(x => lines.push(`• ${x}`)); }
      lines.push('', 'Applications:'); r.applications.forEach(x => lines.push(`• ${x}`));
      break;
    case 'open_alerts':
      lines.push(`${r.total} open alert(s), ${r.critical} critical:`);
      r.alerts.forEach(a => lines.push(`• [${a.severity}] ${a.title}${a.institution ? ' — ' + a.institution : ''}`));
      break;
  }
  return lines.join('\n');
}

const HELP = 'I can only answer questions about AICTE approvals and compliance, for example: pendency by stage or region, applications past SLA, the status of an application or institution, expiring documents, undertakings, EVC visits, compliance scores and alerts. I cannot change any data.';

async function runOffline(userMessage, user) {
  const [tool, args] = route(userMessage);
  if (tool === 'out_of_scope') return { answer: HELP, trace: [], engine: 'keyword' };
  const result = await TOOL_FUNCTIONS[tool](args, user);
  return { answer: summarize(tool, result), trace: [{ tool, arguments: args, result }], engine: 'keyword' };
}

async function runAgent(userMessage, conversationHistory = [], user) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...conversationHistory, { role: 'user', content: userMessage }];
  const trace = [];
  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const { message: msg, model } = await chat(messages, { tools: TOOL_SCHEMAS, timeout: 120000 });
      messages.push(msg);
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        if (!trace.length) {
          // The model answered without looking anything up; ground it with the router.
          const off = await runOffline(userMessage, user);
          return { ...off, engine: 'keyword' };
        }
        return { answer: msg.content || 'No response generated.', trace, engine: model };
      }
      for (const call of msg.tool_calls) {
        const name = call.function?.name;
        let args = call.function?.arguments || {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        let result;
        try { result = TOOL_FUNCTIONS[name] ? await TOOL_FUNCTIONS[name](args, user) : { error: `Unknown tool ${name}` }; } catch (e) { result = { error: e.message }; }
        trace.push({ tool: name, arguments: args, result });
        messages.push({ role: 'tool', content: JSON.stringify(result).slice(0, 6000) });
      }
    }
    return { answer: trace.length ? summarize(trace[trace.length - 1].tool, trace[trace.length - 1].result) : 'No answer.', trace, engine: 'keyword' };
  } catch (err) {
    return runOffline(userMessage, user);
  }
}

module.exports = { runAgent, runOffline };
