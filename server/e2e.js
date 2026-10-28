// End-to-end smoke test of the full approval lifecycle across all four roles.
// Run against a live server:  node e2e.js   (reseed afterwards: npm run seed)
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
  return { user: r.data.user, get: u => call('GET', u), post: (u, b) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b) };
}

(async () => {
  const inst = await login('institute@sahyadri-it.edu.in');
  const off = await login('officer@aicte.gov.in');
  const admin = await login('admin@aicte.gov.in');
  const expert = await login('expert@aicte.gov.in');

  console.log('Application lifecycle');
  const created = await inst.post('/applications', { type: 'New Course', courses: 'B.Tech Robotics' });
  check(created.success, `institution submits application ${created.data?.app_number}`);
  const id = created.data.id;
  let r = await inst.post(`/applications/${id}/transition`, { to: 'SCRUTINY' });
  check(r.status === 403, 'institution cannot start scrutiny (role gate)');
  r = await off.post(`/applications/${id}/transition`, { to: 'SCRUTINY' });
  check(r.success, 'officer starts scrutiny');
  r = await off.post(`/applications/${id}/transition`, { to: 'DEFICIENCY', deficiencies: [{ category: 'Laboratory', description: 'Robotics lab not equipped', severity: 'Major' }] });
  check(r.success, 'officer raises deficiency');
  r = await inst.post(`/applications/${id}/transition`, { to: 'RESCRUTINY' });
  check(r.status === 400, 'cannot go to re-scrutiny with an unanswered deficiency');
  const app = (await inst.get(`/applications/${id}`)).data;
  r = await inst.patch(`/applications/deficiencies/${app.deficiencies[0].id}/respond`, { response: 'Lab equipped, invoices uploaded' });
  check(r.success, 'institution responds to deficiency');
  r = await inst.post(`/applications/${id}/transition`, { to: 'RESCRUTINY' });
  check(r.success, 'institution submits for re-scrutiny');
  r = await off.post(`/applications/${id}/transition`, { to: 'EVC' });
  check(r.success, 'officer clears re-scrutiny to EVC');
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

  console.log('AI');
  r = await inst.post('/ai/chat', { message: 'Which applications are stuck past SLA?', fast: true });
  check(r.success && !/Tapti|Narmada/.test(r.data.answer), 'institution AI answers are scoped to its own data');
  for (const role of [admin, off, expert, inst]) {
    const d = await role.get('/dashboard/overview');
    check(d.success, `dashboard loads for ${role.user.role}`);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
