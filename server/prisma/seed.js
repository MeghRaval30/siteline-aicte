// Demo data for the AICTE approval & compliance system.
// Every date is relative to today, so the demo always has something expiring
// next week, something past its SLA, and a visit coming up.
// Institution names are fictional.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { STAGES, DAY } = require('../shared/workflow');
const { template } = require('../shared/checklist');

const prisma = new PrismaClient();

let seed = 20261028;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = arr => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const now = new Date();
const daysAgo = n => new Date(now.getTime() - n * DAY);
const daysAhead = n => new Date(now.getTime() + n * DAY);

const REGIONS = [
  { code: 'WRO', name: 'Western Regional Office', city: 'Mumbai', states: ['Maharashtra', 'Goa'] },
  { code: 'SRO', name: 'Southern Regional Office', city: 'Chennai', states: ['Tamil Nadu', 'Puducherry'] },
  { code: 'SWRO', name: 'South-Western Regional Office', city: 'Bengaluru', states: ['Karnataka', 'Kerala'] },
  { code: 'SCRO', name: 'South-Central Regional Office', city: 'Hyderabad', states: ['Telangana', 'Andhra Pradesh'] },
  { code: 'NRO', name: 'Northern Regional Office', city: 'Kanpur', states: ['Uttar Pradesh', 'Uttarakhand', 'Bihar'] },
  { code: 'NWRO', name: 'North-Western Regional Office', city: 'Chandigarh', states: ['Punjab', 'Haryana', 'Rajasthan', 'Delhi'] },
  { code: 'CRO', name: 'Central Regional Office', city: 'Bhopal', states: ['Madhya Pradesh', 'Chhattisgarh', 'Gujarat'] },
  { code: 'ERO', name: 'Eastern Regional Office', city: 'Kolkata', states: ['West Bengal', 'Odisha', 'Jharkhand'] },
  { code: 'NERO', name: 'North-Eastern Regional Office', city: 'Guwahati', states: ['Assam', 'Meghalaya', 'Tripura'] },
];
const CITIES = {
  Maharashtra: ['Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Kolhapur'], Goa: ['Panaji'], 'Tamil Nadu': ['Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem'], Puducherry: ['Puducherry'],
  Karnataka: ['Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi'], Kerala: ['Kochi', 'Thrissur'], Telangana: ['Warangal', 'Karimnagar'], 'Andhra Pradesh': ['Vijayawada', 'Guntur', 'Tirupati'],
  'Uttar Pradesh': ['Lucknow', 'Prayagraj', 'Gorakhpur'], Uttarakhand: ['Dehradun'], Bihar: ['Patna'], Punjab: ['Ludhiana', 'Patiala'], Haryana: ['Rohtak', 'Hisar'], Rajasthan: ['Jaipur', 'Udaipur'], Delhi: ['New Delhi'],
  'Madhya Pradesh': ['Indore', 'Jabalpur', 'Gwalior'], Chhattisgarh: ['Raipur'], Gujarat: ['Vadodara', 'Surat', 'Rajkot'], 'West Bengal': ['Durgapur', 'Siliguri'], Odisha: ['Bhubaneswar', 'Cuttack'], Jharkhand: ['Ranchi'],
  Assam: ['Guwahati', 'Jorhat'], Meghalaya: ['Shillong'], Tripura: ['Agartala'],
};
const NAMES = ['Narmada', 'Vindhya', 'Godavari', 'Kaveri', 'Aravalli', 'Satpura', 'Tapti', 'Konkan', 'Deccan', 'Malwa', 'Shivalik', 'Nilgiri', 'Mahanadi', 'Tungabhadra', 'Chambal', 'Brahmaputra', 'Sabarmati', 'Krishna Valley', 'Pench', 'Kanha', 'Western Ghats', 'Eastern Coast', 'Indus', 'Saraswati', 'Lohit', 'Damodar', 'Bhima', 'Penna', 'Vaigai', 'Periyar', 'Sharavati', 'Mandovi', 'Zuari', 'Betwa', 'Son', 'Ken', 'Gomti', 'Ghaghra', 'Teesta', 'Subansiri', 'Barak'];
const TYPES = [
  ['Engineering', 'Institute of Technology', 0.42], ['Engineering', 'College of Engineering', 0.18], ['Management', 'School of Management', 0.12], ['Pharmacy', 'College of Pharmacy', 0.1],
  ['Polytechnic', 'Polytechnic', 0.08], ['Architecture', 'School of Architecture', 0.05], ['MCA', 'Institute of Computer Applications', 0.05],
];
const pickType = () => { let r = rand(); for (const t of TYPES) { if ((r -= t[2]) <= 0) return t; } return TYPES[0]; };
const OWNERSHIP = ['Private Self-Financing', 'Private Self-Financing', 'Private Self-Financing', 'Government', 'Government-Aided'];
const FIRST = ['Anil', 'Sunita', 'Rajesh', 'Meera', 'Vikram', 'Kavita', 'Suresh', 'Lakshmi', 'Arvind', 'Priya', 'Mohan', 'Nandini', 'Harish', 'Deepa', 'Ganesh', 'Shalini', 'Prakash', 'Rekha'];
const LAST = ['Kulkarni', 'Iyer', 'Reddy', 'Sharma', 'Banerjee', 'Nair', 'Patil', 'Verma', 'Menon', 'Joshi', 'Rao', 'Das', 'Gupta', 'Pillai', 'Deshmukh', 'Saxena'];
const person = () => `${pick(FIRST)} ${pick(LAST)}`;

const DEF_TEXT = {
  Land: ['Land documents do not show clear title in the name of the Trust', 'Land use conversion (NA order) not submitted for 2.1 acres'],
  Building: ['Built-up area of instructional block short by 640 sq.m against APH norms', 'Building completion certificate from competent authority not uploaded'],
  Faculty: ['Faculty-student ratio 1:24 against required 1:20', 'Two professors lack PhD as required for the cadre'],
  Infrastructure: ['Seminar hall capacity below norms', 'Separate common rooms for boys and girls not provided'],
  Laboratory: ['Computer centre has 40 systems against required 60', 'Fluid mechanics lab equipment list incomplete'],
  Library: ['Library lacks e-journal subscriptions (DELNET/INDEST)', 'Book volumes below the prescribed minimum'],
  Financial: ['Corpus fund FD not in the joint name of AICTE and the Trust', 'Audited balance sheet of last 3 years not submitted'],
  Documents: ['Fire safety NOC copy is illegible', 'Affidavit on non-judicial stamp paper missing notarisation'],
};
const UNDERTAKINGS = [
  ['Lease Renewal', 'Renew land lease deed and submit registered copy'],
  ['Faculty Recruitment', 'Recruit 6 additional faculty to meet 1:20 ratio'],
  ['Building Completion', 'Complete second floor of academic block and submit completion certificate'],
  ['Fire NOC', 'Obtain renewed Fire Safety NOC for hostel block'],
  ['Land Conversion', 'Submit land use conversion order from Collector'],
  ['Library', 'Subscribe to e-journals and add 2,000 volumes'],
  ['Accreditation', 'Apply for NBA accreditation of at least two programmes'],
];

// Typical hop length per stage, as a fraction of its SLA
function hopDays(stage, slow) {
  const sla = STAGES[stage].sla_days || 10;
  return slow ? Math.round(sla * (1.2 + rand() * 1.3)) : Math.max(1, Math.round(sla * (0.3 + rand() * 0.6)));
}

const PATHS = {
  SUBMITTED: ['SUBMITTED'],
  SCRUTINY: ['SUBMITTED', 'SCRUTINY'],
  DEFICIENCY: ['SUBMITTED', 'SCRUTINY', 'DEFICIENCY'],
  RESCRUTINY: ['SUBMITTED', 'SCRUTINY', 'DEFICIENCY', 'RESCRUTINY'],
  EVC: ['SUBMITTED', 'SCRUTINY', 'EVC'],
  EVC2: ['SUBMITTED', 'SCRUTINY', 'DEFICIENCY', 'RESCRUTINY', 'EVC'],
  EC_REVIEW: ['SUBMITTED', 'SCRUTINY', 'EVC', 'EC_REVIEW'],
  APPROVED: ['SUBMITTED', 'SCRUTINY', 'EVC', 'EC_REVIEW', 'APPROVED'],
  APPROVED_EOA: ['SUBMITTED', 'SCRUTINY', 'EC_REVIEW', 'APPROVED'],
  CONDITIONAL: ['SUBMITTED', 'SCRUTINY', 'DEFICIENCY', 'RESCRUTINY', 'EVC', 'EC_REVIEW', 'CONDITIONAL'],
  CONDITIONAL2: ['SUBMITTED', 'SCRUTINY', 'EVC', 'EC_REVIEW', 'CONDITIONAL'],
  REJECTED: ['SUBMITTED', 'SCRUTINY', 'DEFICIENCY', 'RESCRUTINY', 'EVC', 'EC_REVIEW', 'REJECTED'],
  SAC: ['SUBMITTED', 'SCRUTINY', 'EVC', 'EC_REVIEW', 'REJECTED', 'SAC'],
  SHC: ['SUBMITTED', 'SCRUTINY', 'EVC', 'EC_REVIEW', 'REJECTED', 'SAC', 'SHC'],
  WITHDRAWN: ['SUBMITTED', 'SCRUTINY', 'WITHDRAWN'],
};
const PLAN = [['SUBMITTED', 6], ['SCRUTINY', 14], ['DEFICIENCY', 9], ['RESCRUTINY', 5], ['EVC', 8], ['EVC2', 4], ['EC_REVIEW', 7], ['SAC', 3], ['SHC', 2],
  ['APPROVED', 12], ['APPROVED_EOA', 8], ['CONDITIONAL', 5], ['CONDITIONAL2', 6], ['REJECTED', 5], ['WITHDRAWN', 2]];

async function main() {
  console.log('Clearing database...');
  for (const m of ['outbox', 'stageSla', 'alert', 'alertRule', 'notification', 'activityLog', 'conversationSession', 'checklistItem', 'eVCMember', 'eVCVisit', 'deficiency', 'undertaking', 'complianceDocument', 'stageTransition', 'application', 'user', 'institution', 'region']) {
    await prisma[m].deleteMany();
  }

  const hash = await bcrypt.hash('demo1234', 10);
  const regions = {};
  for (const r of REGIONS) regions[r.code] = await prisma.region.create({ data: { code: r.code, name: r.name, city: r.city, states: r.states.join(',') } });
  const regionOfState = s => REGIONS.find(r => r.states.includes(s));

  // ---------- staff ----------
  const admin = await prisma.user.create({ data: { name: 'Dr. Ramesh Chandra', email: 'admin@aicte.gov.in', password_hash: hash, role: 'Admin', designation: 'Director, Approval Bureau', state: 'Delhi' } });
  const officer = await prisma.user.create({ data: { name: 'Smt. Anjali Deshpande', email: 'officer@aicte.gov.in', password_hash: hash, role: 'Officer', designation: 'Regional Officer, WRO Mumbai', state: 'Maharashtra', region_id: regions.WRO.id } });
  const officers = [officer];
  for (const code of ['SRO', 'SWRO', 'SCRO', 'NRO', 'NWRO', 'CRO', 'ERO', 'NERO']) {
    officers.push(await prisma.user.create({ data: { name: person(), email: `ro.${code.toLowerCase()}@aicte.gov.in`, password_hash: hash, role: 'Officer', designation: `Regional Officer, ${code}`, region_id: regions[code].id, state: REGIONS.find(r => r.code === code).states[0] } }));
  }
  const EXPERTS = [
    ['Prof. Venkatesh Murthy', 'expert@aicte.gov.in', 'Karnataka', 'Engineering — Mechanical', 'Professor, NIT (retd.)'],
    ['Prof. Shabnam Qureshi', 'expert2@aicte.gov.in', 'Uttar Pradesh', 'Engineering — Computer Science', 'Professor & Dean'],
    ['Dr. Rohit Malhotra', 'expert3@aicte.gov.in', 'Punjab', 'Management', 'Professor of Strategy'],
    ['Dr. Kalpana Iyer', 'expert4@aicte.gov.in', 'Tamil Nadu', 'Pharmacy', 'Principal, College of Pharmacy'],
    ['Prof. Debashish Sen', 'expert5@aicte.gov.in', 'West Bengal', 'Engineering — Civil', 'Professor of Structures'],
    ['Ar. Neha Kapoor', 'expert6@aicte.gov.in', 'Delhi', 'Architecture', 'Professor of Architecture'],
    ['Prof. Srinivas Rao', 'expert7@aicte.gov.in', 'Telangana', 'Engineering — Electrical', 'Professor, Electrical Engg.'],
    ['Dr. Manoj Tiwari', 'expert8@aicte.gov.in', 'Madhya Pradesh', 'Polytechnic / Engineering', 'Principal, Govt. Polytechnic'],
    ['Prof. Aisha Fernandes', 'expert9@aicte.gov.in', 'Goa', 'MCA / Computer Applications', 'Professor of Computer Applications'],
    ['Dr. Harpreet Gill', 'expert10@aicte.gov.in', 'Haryana', 'Engineering — Electronics', 'Professor, ECE'],
    ['Prof. Rajiv Bhatt', 'expert11@aicte.gov.in', 'Gujarat', 'Engineering — Chemical', 'Professor, Chemical Engg.'],
    ['Dr. Lata Mukherjee', 'expert12@aicte.gov.in', 'Odisha', 'Management', 'Director, School of Business'],
  ];
  const experts = [];
  for (const [name, email, state, specialization, designation] of EXPERTS) {
    experts.push(await prisma.user.create({ data: { name, email, password_hash: hash, role: 'Expert', state, specialization, designation } }));
  }

  // ---------- institutions ----------
  const institutions = [];
  const states = Object.keys(CITIES);
  // The demo institution comes first, in WRO, with a story to tell.
  const demoInst = await prisma.institution.create({ data: {
    aicte_id: '1-4421907351', name: 'Sahyadri Institute of Technology', type: 'Engineering', ownership: 'Private Self-Financing', state: 'Maharashtra', city: 'Pune',
    region_id: regions.WRO.id, established_year: 2009, approved_intake: 540, head_name: 'Dr. Prakash Kulkarni', email: 'principal@sahyadri-it.edu.in', phone: '020-2765 1100',
  } });
  institutions.push(demoInst);
  const usedNames = new Set(['Sahyadri Institute of Technology']);
  let n = 0;
  while (institutions.length < 46) {
    // Weight WRO so the regional officer's desk is busy
    const state = rand() < 0.3 ? pick(['Maharashtra', 'Maharashtra', 'Goa']) : pick(states);
    const [type, suffix] = pickType();
    const name = `${pick(NAMES)} ${suffix}`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    const reg = regionOfState(state);
    institutions.push(await prisma.institution.create({ data: {
      aicte_id: `1-${String(4400000000 + between(1000000, 99999999))}`, name, type, ownership: pick(OWNERSHIP), state, city: pick(CITIES[state]),
      region_id: regions[reg.code].id, established_year: between(1985, 2022), approved_intake: type === 'Engineering' ? between(4, 18) * 60 : between(1, 5) * 60,
      head_name: `Dr. ${person()}`, email: `principal${++n}@${name.split(' ')[0].toLowerCase()}.edu.in`,
    } }));
  }

  const instUser = await prisma.user.create({ data: { name: 'Dr. Prakash Kulkarni', email: 'institute@sahyadri-it.edu.in', password_hash: hash, role: 'Institution', designation: 'Principal', institution_id: demoInst.id, state: 'Maharashtra' } });
  for (const inst of institutions.slice(1, 12)) {
    await prisma.user.create({ data: { name: inst.head_name, email: inst.email, password_hash: hash, role: 'Institution', designation: 'Principal', institution_id: inst.id, state: inst.state } });
  }

  // ---------- compliance documents ----------
  const DOCS = [
    ['Land Lease Deed', 'Sub-Registrar', () => { const r = rand(); return r < 0.12 ? -between(5, 90) : r < 0.32 ? between(8, 58) : between(120, 1800); }],
    ['Fire Safety NOC', 'State Fire Services', () => { const r = rand(); return r < 0.1 ? -between(3, 60) : r < 0.3 ? between(5, 55) : between(70, 360); }],
    ['Building Completion Certificate', 'Municipal Corporation', () => null],
    ['Structural Stability Certificate', 'Chartered Structural Engineer', () => rand() < 0.08 ? -between(10, 200) : between(90, 1500)],
    ['Affiliation Letter', 'State Technical University', () => rand() < 0.15 ? between(10, 50) : between(80, 300)],
    ['Corpus Fund FD', 'Nationalised Bank', () => between(200, 1500)],
    ['Society/Trust Registration', 'Charity Commissioner', () => null],
  ];
  const statusFor = vt => !vt ? 'Valid' : vt < now ? 'Expired' : vt - now <= 60 * DAY ? 'Expiring Soon' : 'Valid';
  for (const inst of institutions) {
    for (const [doc_type, issued_by, offset] of DOCS) {
      let off = offset();
      if (inst.id === demoInst.id) off = { 'Land Lease Deed': 21, 'Fire Safety NOC': 140, 'Structural Stability Certificate': 600, 'Affiliation Letter': 45, 'Corpus Fund FD': 400 }[doc_type] ?? off;
      const valid_to = off === null ? null : daysAhead(off);
      const span = doc_type === 'Land Lease Deed' ? 3650 * 3 : doc_type === 'Fire Safety NOC' ? 365 : 1095;
      await prisma.complianceDocument.create({ data: {
        institution_id: inst.id, doc_type, issued_by, doc_number: `${doc_type.split(' ').map(w => w[0]).join('').replace(/[^A-Z]/g, '')}/${between(1000, 9999)}/${between(2015, 2025)}`,
        valid_from: valid_to ? new Date(valid_to.getTime() - span * DAY) : daysAgo(between(800, 4000)), valid_to,
        status: rand() < 0.05 ? 'Pending Verification' : statusFor(valid_to), verified_by: officer.name,
        file_name: `${doc_type.toLowerCase().replace(/[^a-z]+/g, '-')}.pdf`,
      } });
    }
  }

  // ---------- applications ----------
  const queue = [];
  for (const [kind, count] of PLAN) for (let i = 0; i < count; i++) queue.push(kind);
  let seq = 0;
  const allInst = institutions.slice(1);

  async function makeApp(inst, kind, opts = {}) {
    const path = PATHS[kind];
    const final = path[path.length - 1];
    const terminal = !!STAGES[final].terminal;
    const slowCurrent = opts.slow ?? rand() < 0.38;
    // time already spent in the current stage
    const curDays = opts.curDays ?? (terminal ? between(5, 160) : slowCurrent ? hopDays(final, true) : hopDays(final, false));
    // walk backwards to place every hop in time
    const hops = [];
    let t = daysAgo(curDays);
    for (let i = path.length - 1; i >= 1; i--) {
      const stage = path[i - 1];
      const d = hopDays(stage, rand() < 0.25);
      const enteredPrev = new Date(t.getTime() - d * DAY);
      hops.unshift({ from: stage, to: path[i], at: new Date(t), days: d, breached: STAGES[stage].sla_days ? d > STAGES[stage].sla_days : false, entered: enteredPrev });
      t = enteredPrev;
    }
    const submitted = t;
    const type = opts.type || (kind === 'APPROVED_EOA' ? 'Extension of Approval' : pick(['Extension of Approval', 'Extension of Approval', 'Increase in Intake', 'New Course', 'New Institution', 'Change of Name', 'Change of Site']));
    seq++;
    const region = REGIONS.find(r => regions[r.code].id === inst.region_id).code;
    const app = await prisma.application.create({ data: {
      app_number: `APH/${submitted.getFullYear()}/${region}/${String(seq).padStart(5, '0')}`,
      institution_id: inst.id, type, academic_year: '2027-28', stage: final,
      status: { APPROVED: 'Approved', CONDITIONAL: 'Conditionally Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn' }[final] || 'In Process',
      stage_entered_at: daysAgo(curDays), submitted_at: submitted, created_at: submitted,
      decided_at: ['APPROVED', 'CONDITIONAL', 'REJECTED'].includes(final) ? daysAgo(curDays) : (path.includes('REJECTED') ? hops.find(h => h.to === 'REJECTED').at : null),
      assigned_officer_id: path.length > 1 ? (inst.region_id === regions.WRO.id ? officer.id : officers.find(o => o.region_id === inst.region_id)?.id) : null,
      priority: rand() < 0.08 ? 'Court-Directed' : rand() < 0.2 ? 'High' : 'Normal',
      intake_requested: type === 'Increase in Intake' ? between(1, 3) * 60 : type === 'New Institution' ? between(3, 6) * 60 : null,
      courses: type === 'New Course' || type === 'New Institution' ? pick(['B.Tech CSE (AI & ML)', 'B.Tech Data Science', 'MBA (Business Analytics)', 'B.Pharm', 'Diploma Mechatronics', 'M.Tech VLSI']) : null,
      decision_remarks: final === 'REJECTED' ? 'Deficiencies in land and building not rectified after re-scrutiny' : final === 'CONDITIONAL' ? 'Approved subject to time-bound undertakings' : null,
      letter_code: path.some(s => ['APPROVED', 'CONDITIONAL', 'REJECTED'].includes(s)) ? crypto.randomBytes(5).toString('hex').toUpperCase() : null,
      rescrutiny_count: path.filter(s => s === 'RESCRUTINY').length,
      transitions: { create: [
        { to_stage: 'SUBMITTED', actor_id: null, remarks: 'Application submitted on portal', created_at: submitted },
        ...hops.map(hp => ({ from_stage: hp.from, to_stage: hp.to, actor_id: ['APPROVED', 'CONDITIONAL', 'REJECTED', 'SAC', 'SHC'].includes(hp.to) ? admin.id : officer.id, remarks: `${STAGES[hp.from].short} → ${STAGES[hp.to].short}`, days_in_stage: hp.days, sla_breached: hp.breached, created_at: hp.at })),
      ] },
    } });

    // submission checklist, consistent with how far the application has got
    const tpl = template(type);
    const defKeys = final === 'DEFICIENCY' ? (opts.deficientKeys || [pick(tpl.filter(t => t.required)).item_key]) : [];
    await prisma.checklistItem.createMany({ data: tpl.map((t, i) => {
      let status = 'Verified';
      if (final === 'SUBMITTED') status = i >= tpl.length - 2 && rand() < 0.5 ? 'Pending' : 'Uploaded';
      else if (final === 'SCRUTINY') status = rand() < 0.5 ? 'Verified' : 'Uploaded';
      else if (final === 'DEFICIENCY') status = defKeys.includes(t.item_key) ? 'Deficient' : 'Verified';
      else if (final === 'RESCRUTINY') status = rand() < 0.35 ? 'Uploaded' : 'Verified';
      const reviewed = ['Verified', 'Deficient'].includes(status);
      return {
        ...t, application_id: app.id, status,
        file_name: status === 'Pending' ? null : `${t.item_key.replace(/_/g, '-')}.pdf`,
        uploaded_at: status === 'Pending' ? null : submitted,
        verified_by: reviewed ? officer.name : null,
        verified_at: reviewed ? submitted : null,
        remarks: status === 'Deficient' ? (opts.deficientRemarks?.[t.item_key] || 'Not as per APH format; resubmit the complete document') : null,
      };
    }) });

    // deficiencies
    if (path.includes('DEFICIENCY')) {
      const defHop = hops.find(h => h.to === 'DEFICIENCY');
      const open = final === 'DEFICIENCY';
      const cats = opts.defCats || [pick(Object.keys(DEF_TEXT)), pick(Object.keys(DEF_TEXT))].filter((v, i, a) => a.indexOf(v) === i);
      for (const cat of cats) {
        await prisma.deficiency.create({ data: {
          application_id: app.id, raised_by: officer.id, category: cat, description: pick(DEF_TEXT[cat]), severity: pick(['Major', 'Major', 'Critical', 'Minor']),
          status: open ? 'Open' : 'Accepted', response: open ? null : 'Rectified. Supporting documents uploaded on the portal.', due_date: new Date(defHop.at.getTime() + 15 * DAY),
          responded_at: open ? null : new Date(defHop.at.getTime() + 10 * DAY), created_at: defHop.at,
        } });
      }
    }

    // EVC visits
    if (path.includes('EVC')) {
      const eligible = experts.filter(e => e.state !== inst.state);
      const panel = [...eligible].sort(() => rand() - 0.5).slice(0, 3);
      const evcHop = hops.find(h => h.to === 'EVC');
      let visit_date, status = 'Completed', recommendation = null, report = null, score = null;
      if (final === 'EVC') {
        const r = opts.evcMode || pick(['future', 'future', 'past_pending', 'completed']);
        if (r === 'future') { visit_date = daysAhead(between(1, 14)); status = 'Scheduled'; }
        else if (r === 'past_pending') { visit_date = daysAgo(between(4, 12)); status = 'Scheduled'; }
        else { visit_date = daysAgo(between(1, 5)); recommendation = 'Recommended'; report = 'Infrastructure, faculty and labs verified as per APH norms.'; score = between(72, 92); }
      } else {
        visit_date = new Date(evcHop.at.getTime() + between(5, 12) * DAY);
        recommendation = final === 'REJECTED' || final === 'SAC' || final === 'SHC' ? 'Not Recommended' : final === 'CONDITIONAL' || kind === 'CONDITIONAL2' ? 'Recommended with Conditions' : 'Recommended';
        report = recommendation === 'Not Recommended' ? 'Built-up area and faculty strength significantly below norms; land title not clear.' : recommendation === 'Recommended' ? 'All norms met. Laboratories well equipped.' : 'Broadly compliant; lease renewal and faculty recruitment pending.';
        score = recommendation === 'Not Recommended' ? between(35, 55) : between(65, 90);
      }
      await prisma.eVCVisit.create({ data: {
        application_id: app.id, visit_date, status, recommendation, report, score, mode: pick(['Physical', 'Physical', 'Hybrid']),
        completed_at: status === 'Completed' ? visit_date : null,
        members: { create: panel.map((e, i) => ({ user_id: e.id, is_chair: i === 0 })) },
      } });
    }

    // undertakings for conditional approvals
    if (final === 'CONDITIONAL') {
      const picks = opts.undertakings || [...UNDERTAKINGS].sort(() => rand() - 0.5).slice(0, between(1, 3)).map(([cat, title]) => ({ cat, title, due: between(-40, 150), status: null }));
      for (const u of picks) {
        const due = daysAhead(u.due);
        const status = u.status || (u.due < 0 ? (rand() < 0.3 ? 'Submitted' : 'Overdue') : rand() < 0.2 ? 'Submitted' : 'Pending');
        await prisma.undertaking.create({ data: {
          institution_id: inst.id, application_id: app.id, title: u.title, category: u.cat, due_date: due, status,
          description: 'Condition of approval recorded in the Letter of Approval.',
          submission_note: status === 'Submitted' ? 'Evidence uploaded: registered documents and photographs.' : null, submitted_at: status === 'Submitted' ? daysAgo(between(1, 10)) : null,
        } });
      }
    }
    return app;
  }

  // The demo institution's own story
  await makeApp(demoInst, 'APPROVED_EOA', { curDays: 400, type: 'Extension of Approval' });
  await makeApp(demoInst, 'CONDITIONAL2', { curDays: 210, type: 'Increase in Intake', undertakings: [
    { cat: 'Faculty Recruitment', title: 'Recruit 6 additional faculty for the increased intake', due: 12 },
    { cat: 'Lease Renewal', title: 'Renew land lease deed and submit registered copy', due: 28 },
  ] });
  await makeApp(demoInst, 'DEFICIENCY', { curDays: 9, slow: false, type: 'New Course', defCats: ['Laboratory', 'Faculty'],
    deficientKeys: ['lab_library', 'faculty_list'],
    deficientRemarks: { lab_library: 'Robotics lab equipment list incomplete; invoices missing', faculty_list: 'Two professors lack PhD as required for the cadre' } });

  // A few apps for the expert's own panel
  for (const kind of queue) {
    const inst = kind.startsWith('EVC') || kind === 'SCRUTINY' && rand() < 0.4 ? pick(allInst.filter(i => i.region_id === regions.WRO.id)) || pick(allInst) : pick(allInst);
    await makeApp(inst, kind);
  }

  // Guarantee the logged-in expert has an upcoming visit and a pending report
  const demoExpert = experts[0];
  const wroEvc = await prisma.application.findMany({ where: { stage: 'EVC', institution: { state: { not: demoExpert.state } } }, include: { evc_visits: { include: { members: true } } }, take: 2 });
  for (const [i, a] of wroEvc.entries()) {
    const v = a.evc_visits[0];
    if (!v) continue;
    if (!v.members.some(m => m.user_id === demoExpert.id)) {
      await prisma.eVCMember.deleteMany({ where: { visit_id: v.id, is_chair: true } });
      await prisma.eVCMember.create({ data: { visit_id: v.id, user_id: demoExpert.id, is_chair: true } });
    }
    await prisma.eVCVisit.update({ where: { id: v.id }, data: i === 0 ? { status: 'Scheduled', visit_date: daysAhead(3), recommendation: null, report: null, score: null, completed_at: null } : { status: 'Scheduled', visit_date: daysAgo(5), recommendation: null, report: null, score: null, completed_at: null } });
  }

  // ---------- default alert rules (playbooks) ----------
  const RULES = [
    ['Lease deed expiring within 60 days', 'DOC_EXPIRING', { days: 60, doc_type: 'Land Lease Deed' }, {}, 'High'],
    ['Fire NOC expiring within 30 days', 'DOC_EXPIRING', { days: 30, doc_type: 'Fire Safety NOC' }, {}, 'High'],
    ['Affiliation letter expiring within 45 days', 'DOC_EXPIRING', { days: 45, doc_type: 'Affiliation Letter' }, {}, 'Medium'],
    ['Any prescribed document has expired', 'DOC_EXPIRED', {}, {}, 'Critical'],
    ['Undertaking due within 30 days', 'UNDERTAKING_DUE', { days: 30 }, {}, 'Medium'],
    ['Undertaking overdue — show-cause candidate', 'UNDERTAKING_OVERDUE', {}, {}, 'Critical'],
    ['Application past stage SLA', 'STAGE_SLA_BREACH', {}, {}, 'High'],
    ['EVC visit in the next 7 days', 'EVC_UPCOMING', { days: 7 }, {}, 'Low'],
    ['EVC report not filed 3 days after visit', 'EVC_REPORT_PENDING', { days: 3 }, {}, 'High'],
    ['Deficiency response overdue', 'DEFICIENCY_OVERDUE', {}, {}, 'High'],
  ];
  for (const [name, trigger, params, criteria, severity] of RULES) {
    await prisma.alertRule.create({ data: { name, trigger, params: JSON.stringify(params), criteria: JSON.stringify(criteria), severity, notify_roles: trigger === 'EVC_UPCOMING' ? 'Officer' : 'Admin,Officer' } });
  }

  await prisma.activityLog.create({ data: { actor_user_id: admin.id, action: 'Seeded AICTE approval cycle 2027-28 demo data' } });

  // Run the monitoring rules once so the Alert Center is populated straight away.
  const { runAll } = require('../modules/alerts/engine');
  const run = await runAll();
  console.log(`Alert rules ran: ${run.results.reduce((t, r) => t + r.created, 0)} alerts raised`);

  const counts = await Promise.all(['institution', 'application', 'complianceDocument', 'undertaking', 'eVCVisit', 'user'].map(m => prisma[m].count()));
  console.log('Seeded:', { institutions: counts[0], applications: counts[1], documents: counts[2], undertakings: counts[3], evc_visits: counts[4], users: counts[5] });
  console.log('Logins (password demo1234): admin@aicte.gov.in, officer@aicte.gov.in, expert@aicte.gov.in, institute@sahyadri-it.edu.in');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
