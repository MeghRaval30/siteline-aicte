// Mandatory documents per application type, after the APH submission
// checklist. Scrutiny verifies each item; nothing moves past scrutiny until
// every required item is verified.

const ITEMS = {
  affidavit:      { label: 'Affidavit on non-judicial stamp paper (notarised)', category: 'Documents' },
  society_reg:    { label: 'Society / Trust / Company registration certificate', category: 'Documents' },
  land_docs:      { label: 'Land ownership or registered lease deed', category: 'Land' },
  building_plan:  { label: 'Building plan approved by competent authority', category: 'Building' },
  bcc:            { label: 'Building Completion / Occupancy Certificate', category: 'Building' },
  fire_noc:       { label: 'Fire Safety NOC', category: 'Infrastructure' },
  ssc:            { label: 'Structural Stability Certificate', category: 'Building' },
  corpus_fd:      { label: 'Corpus fund FD in joint name with AICTE', category: 'Financial' },
  state_noc:      { label: 'NOC from State Government / UT', category: 'Documents' },
  affiliation:    { label: 'Consent of affiliating University / Board', category: 'Documents' },
  faculty_list:   { label: 'Faculty list with qualifications and appointment orders', category: 'Faculty' },
  lab_library:    { label: 'Laboratory equipment and library holdings', category: 'Laboratory' },
  accreditation:  { label: 'NBA / NAAC accreditation status', category: 'Documents', optional: true },
  resolution:     { label: 'Board resolution approving the change', category: 'Documents' },
  closure_plan:   { label: 'Plan for students currently on rolls', category: 'Documents' },
};

const BY_TYPE = {
  'New Institution':       ['affidavit', 'society_reg', 'land_docs', 'building_plan', 'bcc', 'fire_noc', 'ssc', 'corpus_fd', 'state_noc', 'affiliation', 'faculty_list', 'lab_library'],
  'Extension of Approval': ['affidavit', 'land_docs', 'bcc', 'fire_noc', 'faculty_list', 'lab_library', 'accreditation'],
  'Increase in Intake':    ['affidavit', 'state_noc', 'affiliation', 'bcc', 'faculty_list', 'lab_library'],
  'New Course':            ['affidavit', 'state_noc', 'affiliation', 'faculty_list', 'lab_library'],
  'Change of Name':        ['affidavit', 'society_reg', 'resolution'],
  'Change of Site':        ['affidavit', 'land_docs', 'building_plan', 'bcc', 'fire_noc', 'ssc'],
  'Closure':               ['affidavit', 'resolution', 'closure_plan', 'state_noc'],
  'NRI Seats':             ['affidavit', 'resolution'],
  'Merger of Institutions':['affidavit', 'society_reg', 'resolution', 'land_docs', 'bcc', 'faculty_list'],
  'Conversion Diploma/Degree': ['affidavit', 'state_noc', 'affiliation', 'faculty_list', 'lab_library'],
  'Restoration after Break':   ['affidavit', 'land_docs', 'bcc', 'fire_noc', 'faculty_list', 'lab_library'],
  'Intake Reduction':      ['affidavit', 'resolution'],
  'FN/OCI Seats':          ['affidavit', 'resolution'],
};

function template(type) {
  return (BY_TYPE[type] || BY_TYPE['Extension of Approval']).map(key => ({ item_key: key, label: ITEMS[key].label, required: !ITEMS[key].optional }));
}

function summary(items = []) {
  const req = items.filter(i => i.required);
  return {
    total: items.length,
    required: req.length,
    uploaded: items.filter(i => ['Uploaded', 'Verified'].includes(i.status)).length,
    verified: items.filter(i => i.status === 'Verified').length,
    deficient: items.filter(i => i.status === 'Deficient').length,
    missing: req.filter(i => i.status === 'Pending').map(i => i.label),
    unverified: req.filter(i => i.status !== 'Verified').map(i => i.label),
  };
}

const TEMPLATES = Object.fromEntries(Object.keys(BY_TYPE).map(t => [t, template(t)]));

module.exports = { ITEMS, template, summary, TEMPLATES };
