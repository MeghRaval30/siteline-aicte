// End-to-end smoke test of the full approval lifecycle across all four roles.
// Run against a live server:  node e2e.js   (it changes data: reseed afterwards with npm run seed)
const B = process.env.API || 'http://localhost:3000/api/v1';
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures++; };

async function login(email) {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'demo1234' }) }).then(r => r.json());
  const token = r.data.token;
  const call = async (method, url, body) => {
    const res = await fetch(`${B}${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json();
    return { status: res.status, ...j };
  };
  return { user: r.data.user, token, get: u => call('GET', u), post: (u, b) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b), put: (u, b) => call('PUT', u, b) };
}

const uploadItem = (who, appId, itemId) => who.post(`/applications/${appId}/checklist/${itemId}/upload`, { file_name: 'doc.pdf', file_data: Buffer.from('%PDF-1.4 e2e').toString('base64') });

(async () => {
  const inst = await login('institute@sahyadri-it.edu.in');
  const off = await login('officer@aicte.gov.in');
  const admin = await login('admin@aicte.gov.in');
  const expert = await login('expert@aicte.gov.in');

  await off.post('/alerts/run', {}); // a fresh seed has no alerts until the engine's first run

  console.log('Application lifecycle');
  const created = await inst.post('/applications', { type: 'New Course', courses: 'B.Tech Robotics' });
  check(created.success, `institution submits application ${created.data?.app_number}`);
  const id = created.data.id;
  let r = await inst.post(`/applications/${id}/transition`, { to: 'SCRUTINY' });
  check(r.status === 403, 'institution cannot start scrutiny (role gate)');
  r = await off.post(`/applications/${id}/transition`, { to: 'SCRUTINY' });
  check(r.status === 400 && /required document/.test(r.error), 'scrutiny blocked until the mandatory documents are uploaded');
  const items = (await inst.get(`/applications/${id}`)).data.checklist;
  check(items.length === 5 && items.every(i => i.status === 'Pending'), `checklist created from the New Course template (${items.length} items)`);
  for (const it of items) await uploadItem(inst, id, it.id);
  r = await off.post(`/applications/${id}/transition`, { to: 'SCRUTINY' });
  check(r.success, 'officer starts scrutiny once every document is uploaded');
  const lab = items.find(i => i.item_key === 'lab_library');
  r = await off.patch(`/applications/${id}/checklist/${lab.id}/review`, { decision: 'Deficient' });
  check(r.status === 400, 'marking a document deficient needs a reason');
  r = await off.patch(`/applications/${id}/checklist/${lab.id}/review`, { decision: 'Deficient', remarks: 'Robotics lab list incomplete' });
  check(r.success, 'officer marks a document deficient');
  for (const it of items.filter(i => i.id !== lab.id)) await off.patch(`/applications/${id}/checklist/${it.id}/review`, { decision: 'Verified' });
  r = await off.post(`/applications/${id}/transition`, { to: 'EVC' });
  check(r.status === 400 && /Verify every required document/.test(r.error), 'cannot clear scrutiny with a deficient document');
  r = await off.post(`/applications/${id}/transition`, { to: 'DEFICIENCY', deficiencies: [{ category: 'Laboratory', description: 'Robotics lab not equipped', severity: 'Major' }] });
  check(r.success, 'officer raises deficiency');
  r = await inst.post(`/applications/${id}/transition`, { to: 'RESCRUTINY' });
  check(r.status === 400, 'cannot go to re-scrutiny with an unanswered deficiency');
  const app = (await inst.get(`/applications/${id}`)).data;
  r = await inst.patch(`/applications/deficiencies/${app.deficiencies[0].id}/respond`, { response: 'Lab equipped, invoices uploaded' });
  check(r.success, 'institution responds to deficiency');
  r = await uploadItem(inst, id, lab.id);
  check(r.success && r.data.status === 'Uploaded', 'institution re-uploads the deficient document');
  r = await inst.post(`/applications/${id}/transition`, { to: 'RESCRUTINY' });
  check(r.success, 'institution submits for re-scrutiny');
  await off.patch(`/applications/${id}/checklist/${lab.id}/review`, { decision: 'Verified' });
  r = await off.post(`/applications/${id}/transition`, { to: 'EVC' });
  check(r.success, 'officer verifies the re-upload and clears re-scrutiny to EVC');
  r = await off.post(`/applications/${id}/transition`, { to: 'EC_REVIEW' });
  check(r.status === 400, 'cannot reach EC before the EVC report is filed');

  console.log('EVC scheduling');
  const date = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const sug = (await off.get(`/evc/suggest?application_id=${id}&date=${date}`)).data;
  check(sug.recommended.length >= 2, `suggester recommends ${sug.recommended.length} eligible experts`);
  const blocked = sug.experts.find(e => e.state === 'Maharashtra');
  if (blocked) {
    r = await off.post('/evc', { application_id: id, visit_date: date, member_ids: [blocked.id, sug.recommended[0]] });
    check(r.status === 409, `conflict of interest blocked (${blocked.name}, ${blocked.state})`);
  }
  const panel = [expert.user.id, ...sug.recommended.filter(x => x !== expert.user.id)].slice(0, 3);
  r = await off.post('/evc', { application_id: id, visit_date: date, member_ids: panel });
  check(r.success, 'EVC scheduled with conflict-free panel');
  const visitId = r.data.id;
  r = await off.post('/evc', { application_id: id, visit_date: date, member_ids: panel });
  check(r.status === 409, 'double-booking the same panel on the same day is blocked');
  r = await expert.patch(`/evc/${visitId}/report`, { recommendation: 'Recommended with Conditions', score: 78, report: 'Lab now adequate; faculty hiring pending.' });
  check(r.success, 'expert files EVC report');
  r = await expert.post(`/applications/${id}/transition`, { to: 'EC_REVIEW', remarks: 'EVC recommends' });
  check(r.success, 'application moves to Executive Committee');
  r = await off.post(`/applications/${id}/transition`, { to: 'CONDITIONAL', remarks: 'x', undertakings: [{ title: 'y', due_date: date }] });
  check(r.status === 403, 'officer cannot grant approval (Admin only)');
  r = await admin.post(`/applications/${id}/transition`, { to: 'CONDITIONAL', remarks: 'Approved with conditions', undertakings: [{ category: 'Faculty Recruitment', title: 'Recruit 3 robotics faculty', due_date: new Date(Date.now() + 120 * 86400000).toISOString() }] });
  check(r.success, 'admin grants conditional approval with undertaking');
  const letter = (await inst.get(`/applications/${id}/letter`)).data;
  check(!!letter?.letter_code, `LoA issued with code ${letter?.letter_code}`);
  const ver = await fetch(`${B}/applications/verify/${letter.letter_code}`).then(x => x.json());
  check(ver.data.valid && ver.data.undertakings.length === 1, 'public verification works without login');
  const bad = await fetch(`${B}/applications/verify/NOTREAL123`).then(x => x.json());
  check(bad.data.valid === false, 'forged code is rejected');

  console.log('Document renewal closes its alert');
  const docs = (await inst.get('/compliance/documents')).data;
  const lease = docs.find(d => d.doc_type === 'Land Lease Deed');
  const alertsBefore = (await off.get(`/alerts?status=Open&institution_id=${lease.institution_id}`)).data.filter(a => a.entity_type === 'Document' && a.entity_id === lease.id);
  check(alertsBefore.length > 0, `lease deed alert open (${alertsBefore[0]?.title})`);
  r = await inst.post('/compliance/documents', { doc_type: 'Land Lease Deed', doc_number: 'LLD/2026/NEW', valid_from: new Date().toISOString(), valid_to: new Date(Date.now() + 3650 * 86400000).toISOString(), renewal_of_id: lease.id, file_name: 'lease.pdf', file_data: Buffer.from('%PDF-1.4 demo').toString('base64') });
  check(r.success && r.data.file_url, 'institution uploads renewed lease with file');
  r = await off.patch(`/compliance/documents/${r.data.id}/verify`, { decision: 'Valid' });
  check(r.success && r.data.status === 'Valid', `officer verifies renewal (${r.data.alerts_auto_resolved} alert(s) auto-resolved)`);
  const alertsAfter = (await off.get(`/alerts?status=Open&institution_id=${lease.institution_id}`)).data.filter(a => a.entity_type === 'Document' && a.entity_id === lease.id);
  check(alertsAfter.length === 0, 'old lease alert no longer open');

  console.log('Undertakings');
  const unds = (await inst.get('/compliance/undertakings')).data;
  const u = unds.find(x => x.status === 'Pending');
  r = await inst.patch(`/compliance/undertakings/${u.id}/submit`, { submission_note: 'Six faculty appointed' });
  check(r.success, 'institution submits undertaking evidence');
  r = await off.patch(`/compliance/undertakings/${u.id}/review`, { decision: 'Verified' });
  check(r.success && r.data.status === 'Verified', 'officer verifies undertaking');

  console.log('Alert rules');
  r = await off.post('/alerts/rules/compile', { text: 'Warn me 120 days before fire NOC of engineering colleges in the Western region expires' });
  check(r.data.ok, `NL rule compiled by ${r.data.engine}: ${r.data.reading} (matches ${r.data.would_match})`);
  r = await off.post('/alerts/rules', { ...r.data.proposal, nl_prompt: 'test' });
  check(r.success, `rule saved; first run raised ${r.data.run.results[0].created} alert(s)`);
  r = await off.post('/alerts/run', {});
  check(r.success, `manual run of ${r.data.results.length} rules`);

  console.log('Import Studio');
  const sample = async name => Buffer.from(await (await fetch(`${B}/import/samples/${name}`, { headers: { Authorization: `Bearer ${off.token}` } })).arrayBuffer()).toString('base64');
  const runImport = async (target, name, extra = {}) => {
    const a = (await off.post('/import/analyze', { target, file_name: name, file_data: await sample(name), use_ai: false })).data;
    const mapping = Object.fromEntries(a.columns.filter(c => c.field).map(c => [c.index, c.field]));
    const body = { target, file_name: name, headers: a.headers, rows: a.rows, mapping, ...extra };
    return { a, p: (await off.post('/import/preview', body)).data, commit: () => off.post('/import/commit', body) };
  };
  let imp = await runImport('institutions', 'wro-institutions-register.xlsx');
  check(imp.a.header_line === 4 && imp.a.dropped.some(d => d.reason === 'totals row'), 'messy register: header found on line 4, title and TOTAL rows set aside');
  check(imp.a.columns.filter(c => c.field).length === 13, 'all 13 meaningful columns mapped without AI');
  check(imp.p.summary.create === 8 && imp.p.summary.update === 2 && imp.p.summary.skip === 1 && imp.p.summary.error === 1, `preview: ${JSON.stringify(imp.p.summary)}`);
  r = await imp.commit();
  check(r.success && r.data.created === 8 && r.data.updated === 2 && r.data.documents > 0, `import committed (${r.data.documents} documents, ${r.data.alerts_raised} alerts raised)`);
  imp = await runImport('institutions', 'wro-institutions-register.xlsx');
  check(imp.p.summary.create === 0 && imp.p.summary.update === 10, 're-importing the same file updates instead of duplicating');
  imp = await runImport('documents', 'legacy-portal-documents.csv');
  check(imp.p.summary.error === 1 && imp.p.summary.create === 16, `legacy vocabulary mapped (LEASE_DEED, FIRE_NOC, BCC…), unknown ID rejected`);
  r = await imp.commit();
  check(r.success && r.data.documents > 0, `documents imported (${r.data.documents})`);
  imp = await runImport('institutions', 'new-colleges-no-ids.xlsx', { defaults: { type: 'Engineering' }, options: { generate_ids: true } });
  check(imp.a.missing_required.map(m => m.key).sort().join() === 'aicte_id,type', 'gaps detected: no ID column, no type column');
  check(imp.p.summary.create === 4 && imp.p.rows.every(x => x.values.aicte_id?.startsWith('1-9')), 'gaps filled: provisional IDs + default type');
  r = await inst.post('/import/analyze', { target: 'institutions', file_name: 'x.csv', file_data: 'YQ==' });
  check(r.status === 403, 'institutions cannot use the Import Studio');

  console.log('Scoping');
  const instApps = (await inst.get('/applications')).data;
  check(instApps.every(a => a.institution_id === inst.user.institution_id), `institution sees only its own ${instApps.length} applications`);
  const offApps = (await off.get('/applications')).data;
  check(offApps.every(a => a.institution.region.code === 'WRO'), `WRO officer sees only WRO (${offApps.length})`);
  const expApps = (await expert.get('/applications')).data;
  check(expApps.length > 0 && expApps.length < offApps.length, `expert sees only panel applications (${expApps.length})`);
  r = await inst.get('/institutions');
  check(r.data.length === 1, 'institution cannot list other institutions');
  r = await off.post('/institutions/remind', { grade: 'D' });
  check(r.success, `bulk reminder to grade-D institutions (${r.data.institutions})`);

  console.log('Security & integrity (review fixes)');
  const all = await admin.get('/compliance/documents?status=Pending Verification');
  const foreignDoc = all.data.find(d => d.institution.region.code !== 'WRO');
  r = await off.patch(`/compliance/documents/${foreignDoc.id}/verify`, { decision: 'Rejected' });
  check(r.status === 403, 'WRO officer cannot verify another region\'s document');
  const foreignU = (await admin.get('/compliance/undertakings')).data.find(u => u.institution.region.code !== 'WRO');
  r = await off.patch(`/compliance/undertakings/${foreignU.id}/review`, { decision: 'Breached' });
  check(r.status === 403, 'WRO officer cannot breach another region\'s undertaking');
  const foreignAlert = (await admin.get('/alerts?status=Open')).data.find(a => a.institution_id && a.institution_id !== inst.user.institution_id);
  r = await inst.patch(`/alerts/${foreignAlert.id}/acknowledge`);
  check(r.status === 404, 'institution cannot acknowledge another institution\'s alert');
  r = await expert.post('/compliance/documents', { institution_id: foreignDoc.institution_id, doc_type: 'Fire Safety NOC' });
  check(r.status === 403, 'expert cannot upload documents');
  r = await inst.post('/compliance/documents', { doc_type: 'Fire Safety NOC', valid_from: '2026-01-01', valid_to: '2020-01-01' });
  check(r.status === 400, 'valid-to before valid-from is rejected');
  r = await inst.post('/applications', { type: 'New Course', courses: '' });
  check(r.status === 400, 'New Course without a course name is rejected');
  const race = await off.post('/applications', { type: 'Extension of Approval', institution_id: (await off.get('/institutions')).data[0].id });
  for (const it of (await off.get(`/applications/${race.data.id}`)).data.checklist) await uploadItem(off, race.data.id, it.id);
  const [t1, t2] = await Promise.all([off.post(`/applications/${race.data.id}/transition`, { to: 'SCRUTINY' }), off.post(`/applications/${race.data.id}/transition`, { to: 'SCRUTINY' })]);
  check([t1.status, t2.status].sort().join() === '200,409', 'double-submitted transition: one succeeds, one is refused (409)');
  const hist = (await off.get(`/applications/${race.data.id}`)).data.transitions.filter(t => t.to_stage === 'SCRUTINY');
  check(hist.length === 1, 'only one transition recorded');
  r = await off.post('/alerts/rules/compile', { text: 'make me a sandwich' });
  check(r.data.ok === false, 'nonsense rule text is refused');
  const logs = (await off.get('/activity-logs?limit=200')).data;
  check(logs.every(l => !l.action.includes('/SRO/') && !l.action.includes('/ERO/')), 'officer audit trail is regional');
  r = await fetch(`${B}/applications/verify/${letter.letter_code.toLowerCase()}`).then(x => x.json());
  check(r.data.valid, 'verification code is case-insensitive');
  r = await off.post(`/applications/${id}/letter/revoke`, { reason: 'probe' });
  check(r.status === 403, 'only the Approval Bureau can revoke a letter');
  r = await admin.post(`/applications/${id}/letter/revoke`, { reason: 'Approval obtained on false lease documents' });
  check(r.success, 'admin revokes a letter with a reason');
  r = await fetch(`${B}/applications/verify/${letter.letter_code}`).then(x => x.json());
  check(r.data.valid && r.data.revoked && /false lease/.test(r.data.revoke_reason), 'public verification shows the letter as revoked, with the reason');
  r = await fetch(`${B}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', email: 'x@y.in', password: 'password123' }) });
  check(r.status === 403, 'self-registration is disabled');
  r = await inst.get(`/activity-logs?actor_user_id=${admin.user.id}&limit=200`);
  check(r.data.every(l => l.actor_user_id === inst.user.id), 'an institution cannot widen its audit trail with actor_user_id');
  r = await admin.get('/activity-logs?search=Revoked&limit=50');
  check(r.data.length >= 1 && r.data.every(l => l.action.includes('Revoked')), 'audit trail search filters by action text');

  console.log('Stage SLA settings');
  r = await off.put('/settings/sla', { SCRUTINY: 60 });
  check(r.status === 403, 'only the Approval Bureau can change SLAs');
  const before = (await admin.get('/applications?stage=SCRUTINY&overdue=1&limit=500')).data.length;
  r = await admin.put('/settings/sla', { SCRUTINY: 0 });
  check(r.status === 400, 'SLA must be at least one day');
  r = await admin.put('/settings/sla', { SCRUTINY: 60 });
  check(r.success && r.data.stages.find(x => x.stage === 'SCRUTINY').days === 60, 'admin extends the scrutiny SLA to 60 days');
  const after = (await admin.get('/applications?stage=SCRUTINY&overdue=1&limit=500')).data.length;
  check(after < before || before === 0, `pendency re-evaluated against the new SLA (${before} → ${after} past SLA)`);
  r = await admin.put('/settings/sla', { SCRUTINY: 15 });
  check(r.success && !r.data.stages.find(x => x.stage === 'SCRUTINY').updated_by, 'setting it back to the APH default removes the override');

  console.log('AI');
  r = await admin.post('/ai/chat', { message: 'Which region has the most applications stuck past SLA?', fast: true });
  check(/Regional Office/.test(r.data.answer) && r.data.trace[0].tool === 'pendency_by_region', 'region question answered from the region tool');
  r = await admin.post('/ai/chat', { message: 'what is the capital of France?', fast: true });
  check(/only answer questions about AICTE/.test(r.data.answer), 'off-topic question gets a scope message');
  r = await inst.post('/ai/chat', { message: 'Which applications are stuck past SLA?', fast: true });
  check(r.success && !/Tapti|Narmada/.test(r.data.answer), 'institution AI answers are scoped to its own data');
  for (const role of [admin, off, expert, inst]) {
    const d = await role.get('/dashboard/overview');
    check(d.success, `dashboard loads for ${role.user.role}`);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
