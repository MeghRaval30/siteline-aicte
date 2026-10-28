// What an import can fill, how each field is recognised, and how raw cell text
// is turned into a clean value. Ported from odoo_2026's intelligence/schema.

const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Meghalaya', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Himachal Pradesh', 'Jammu and Kashmir', 'Arunachal Pradesh', 'Manipur', 'Mizoram', 'Nagaland', 'Sikkim', 'Chandigarh'];
const STATE_ALIASES = {
  ap: 'Andhra Pradesh', as: 'Assam', br: 'Bihar', cg: 'Chhattisgarh', ct: 'Chhattisgarh', dl: 'Delhi', 'nct of delhi': 'Delhi', 'new delhi': 'Delhi', ga: 'Goa',
  gj: 'Gujarat', hr: 'Haryana', jh: 'Jharkhand', ka: 'Karnataka', kar: 'Karnataka', kl: 'Kerala', mp: 'Madhya Pradesh', mh: 'Maharashtra', maha: 'Maharashtra',
  ml: 'Meghalaya', od: 'Odisha', or: 'Odisha', orissa: 'Odisha', py: 'Puducherry', pondicherry: 'Puducherry', pb: 'Punjab', rj: 'Rajasthan', tn: 'Tamil Nadu',
  ts: 'Telangana', tg: 'Telangana', tr: 'Tripura', up: 'Uttar Pradesh', uk: 'Uttarakhand', ut: 'Uttarakhand', uttaranchal: 'Uttarakhand', wb: 'West Bengal',
  hp: 'Himachal Pradesh', jk: 'Jammu and Kashmir', 'j&k': 'Jammu and Kashmir',
};
const TYPES = ['Engineering', 'Management', 'Pharmacy', 'Architecture', 'Polytechnic', 'MCA', 'HMCT'];
const TYPE_WORDS = [
  [/poly|diploma/, 'Polytechnic'], [/pharm/, 'Pharmacy'], [/arch/, 'Architecture'], [/\bmca\b|computer app/, 'MCA'], [/hotel|hmct|catering/, 'HMCT'],
  [/mba|pgdm|manage|mgmt|business/, 'Management'], [/engg|engineer|b\.?\s?tech|b\.?\s?e\b|technolog|technical/, 'Engineering'],
];
const OWNERSHIP = ['Private Self-Financing', 'Government', 'Government-Aided', 'Deemed'];
const OWN_WORDS = [[/unaided|pvt|private|self|trust|society/, 'Private Self-Financing'], [/aided/, 'Government-Aided'], [/govt|government|state|central/, 'Government'], [/deemed/, 'Deemed']];
const DOC_TYPES = ['Land Lease Deed', 'Fire Safety NOC', 'Building Completion Certificate', 'Structural Stability Certificate', 'Affiliation Letter', 'Corpus Fund FD', 'Society/Trust Registration', 'Land Use Conversion', 'Accreditation (NBA/NAAC)'];
const DOC_WORDS = [
  [/lease/, 'Land Lease Deed'], [/fire|noc/, 'Fire Safety NOC'], [/completion|bcc|occupancy|\boc\b/, 'Building Completion Certificate'],
  [/struct|stab|ssc/, 'Structural Stability Certificate'], [/affil/, 'Affiliation Letter'], [/corpus|\bfd\b|fixed dep/, 'Corpus Fund FD'],
  [/society|trust|regn|registration/, 'Society/Trust Registration'], [/land use|conversion|\bna\b/, 'Land Use Conversion'], [/nba|naac|accredit/, 'Accreditation (NBA/NAAC)'],
];

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

// ---------- transforms: raw text -> [value, note] ----------
function toDate(raw) {
  if (raw == null || raw === '') return [null];
  if (raw instanceof Date && !isNaN(raw)) return [raw];
  const s = String(raw).trim();
  if (/^(na|n\/a|nil|-|--|permanent|lifetime)$/i.test(s)) return [null, 'blank/permanent'];
  if (/^\d{5}(\.\d+)?$/.test(s)) { // Excel serial
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return [d, 'Excel serial date'];
  }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return [new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))];
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) { // Indian convention: day first
    let y = +m[3]; if (y < 100) y += 2000;
    if (+m[2] > 12) return [new Date(Date.UTC(y, +m[1] - 1, +m[2])), 'read as month-first'];
    return [new Date(Date.UTC(y, +m[2] - 1, +m[1]))];
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?[\s,-]+(\d{2,4})$/i);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    let y = +m[3]; if (y < 100) y += 2000;
    if (mo !== undefined) return [new Date(Date.UTC(y, mo, +m[1]))];
  }
  m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) return [new Date(Date.UTC(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]))];
  if (/^\d{1,4}$/.test(s) || !/[a-z]/i.test(s) || s.length < 6) return [undefined, `"${s}" is not a date`];
  const d = new Date(s);
  if (!isNaN(d) && d.getFullYear() > 1900 && d.getFullYear() < 2200) return [d, 'free-text date'];
  return [undefined, `"${s}" is not a date`];
}
function toInt(raw) {
  if (raw == null || raw === '') return [null];
  const s = String(raw).replace(/,/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return [undefined, `"${raw}" is not a number`];
  return [Math.round(Number(m[0])), /[a-z]/i.test(s) ? 'stripped text' : undefined];
}
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
function toName(raw) {
  const s = clean(raw);
  if (!s) return [null];
  const shouting = s === s.toUpperCase() && /[A-Z]{4,}/.test(s), whisper = s === s.toLowerCase();
  if (!shouting && !whisper) return [s];
  const small = new Set(['of', 'and', 'for', 'the', 'in', 'at']);
  const keep = new Set(['IT', 'MBA', 'MCA', 'PG', 'UG', 'KLE', 'SVKM', 'NMIMS', 'BVP', 'DY']);
  const fixed = s.split(' ').map((w, i) => keep.has(w.toUpperCase().replace(/[^A-Z]/g, '')) && shouting ? w.toUpperCase() : (i && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
  return [fixed, 'recased'];
}
function toState(raw) {
  const s = clean(raw);
  if (!s) return [null];
  const k = s.toLowerCase().replace(/\.$/, '');
  if (STATE_ALIASES[k]) return [STATE_ALIASES[k], `${s} → ${STATE_ALIASES[k]}`];
  const hit = STATES.find(x => x.toLowerCase() === k) || STATES.find(x => x.toLowerCase().startsWith(k) && k.length >= 4);
  return hit ? [hit, hit !== s ? `${s} → ${hit}` : undefined] : [undefined, `unknown state "${s}"`];
}
const byWords = (list, all, label) => raw => {
  const s = clean(raw);
  if (!s) return [null];
  const exact = all.find(x => x.toLowerCase() === s.toLowerCase());
  if (exact) return [exact];
  const hit = list.find(([re]) => re.test(s.toLowerCase()))?.[1];
  return hit ? [hit, `${s} → ${hit}`] : [undefined, `unknown ${label} "${s}"`];
};
function toEmail(raw) {
  const s = clean(raw).toLowerCase();
  if (!s) return [null];
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? [s] : [undefined, `"${raw}" is not an email`];
}
function toPhone(raw) {
  const s = clean(raw);
  if (!s) return [null];
  const digits = s.replace(/[^\d]/g, '');
  return digits.length >= 8 ? [s] : [undefined, `"${s}" is not a phone number`];
}
function toAicteId(raw) {
  const s = clean(raw).replace(/\s/g, '');
  if (!s) return [null];
  if (/^1-\d{8,10}$/.test(s)) return [s];
  if (/^\d{9,11}$/.test(s)) return [`1-${s.replace(/^1(?=\d{10}$)/, '')}`, 'added "1-" prefix'];
  return [undefined, `"${s}" is not an AICTE permanent ID`];
}

// kind -> transform, and a shape test used by the value profiler
const KINDS = {
  id:    { fn: toAicteId, test: v => /^1-?\d{8,10}$/.test(String(v).replace(/\s/g, '')) },
  text:  { fn: v => [clean(v) || null], test: v => /[a-z]/i.test(v) && String(v).length > 2 },
  name:  { fn: toName, test: v => /[a-z]{3,}/i.test(v) && String(v).split(' ').length >= 2 },
  int:   { fn: toInt, test: v => /^\s*[\d,]+\s*[a-z]*\s*$/i.test(String(v)) },
  year:  { fn: v => { const [n, note] = toInt(v); return n == null || (n > 1850 && n <= new Date().getFullYear()) ? [n, note] : [undefined, `${v} is not a year`]; }, test: v => /^(18|19|20)\d{2}$/.test(String(v).trim()) },
  date:  { fn: toDate, test: v => v instanceof Date || toDate(v)[0] instanceof Date },
  state: { fn: toState, test: v => toState(v)[0] != null },
  type:  { fn: byWords(TYPE_WORDS, TYPES, 'type'), test: v => byWords(TYPE_WORDS, TYPES, 'type')(v)[0] != null },
  ownership: { fn: byWords(OWN_WORDS, OWNERSHIP, 'ownership'), test: v => byWords(OWN_WORDS, OWNERSHIP, 'ownership')(v)[0] != null },
  doc_type: { fn: byWords(DOC_WORDS, DOC_TYPES, 'document type'), test: v => byWords(DOC_WORDS, DOC_TYPES, 'document type')(v)[0] != null },
  email: { fn: toEmail, test: v => /@/.test(v) },
  phone: { fn: toPhone, test: v => String(v).replace(/[^\d]/g, '').length >= 8 && !/@/.test(v) },
};

const f = (key, label, kind, opts = {}) => ({ key, label, kind, required: false, synonyms: [], ...opts });
const TARGETS = {
  institutions: {
    label: 'Institutions register',
    description: 'Institution master data, plus validity dates of key documents',
    key: 'aicte_id',
    fields: [
      f('aicte_id', 'AICTE Permanent ID', 'id', { required: true, synonyms: ['aicte id', 'permanent id', 'pid', 'aicte pid', 'institute id', 'inst id', 'application id', 'aicte code', 'permanentid'] }),
      f('name', 'Institution name', 'name', { required: true, synonyms: ['name of the institute', 'name of institute', 'institute name', 'institution', 'college', 'college name', 'name of college', 'institute'] }),
      f('type', 'Programme type', 'type', { required: true, synonyms: ['type', 'inst type', 'institution type', 'programme', 'program', 'category', 'discipline', 'stream', 'course type'] }),
      f('ownership', 'Ownership', 'ownership', { synonyms: ['ownership', 'mgmt', 'management type', 'owner', 'status', 'govt/pvt', 'type of management'] }),
      f('city', 'City', 'text', { required: true, synonyms: ['city', 'town', 'city/town', 'district', 'location', 'place'] }),
      f('state', 'State / UT', 'state', { required: true, synonyms: ['state', 'state/ut', 'state ut', 'st', 'province'] }),
      f('established_year', 'Year established', 'year', { synonyms: ['estd', 'established', 'year of establishment', 'est year', 'estd year', 'founded'] }),
      f('approved_intake', 'Approved intake', 'int', { synonyms: ['intake', 'sanctioned intake', 'approved intake', 'total intake', 'seats', 'capacity'] }),
      f('head_name', 'Head of institution', 'name', { synonyms: ['principal', 'director', 'head', 'principal name', 'head of institute', 'hoi', 'contact person', 'nodal officer'] }),
      f('email', 'Email', 'email', { synonyms: ['email', 'email id', 'e-mail', 'mail', 'official email'] }),
      f('phone', 'Phone', 'phone', { synonyms: ['phone', 'contact', 'contact no', 'mobile', 'mob no', 'tel', 'telephone'] }),
      f('lease_valid_to', 'Lease deed valid until', 'date', { doc: 'Land Lease Deed', synonyms: ['lease valid upto', 'lease deed valid upto', 'lease expiry', 'lease deed expiry', 'lease till', 'lease end'] }),
      f('fire_noc_valid_to', 'Fire NOC valid until', 'date', { doc: 'Fire Safety NOC', synonyms: ['fire noc expiry', 'fire noc valid upto', 'fire noc', 'noc expiry', 'fire safety validity'] }),
      f('affiliation_valid_to', 'Affiliation valid until', 'date', { doc: 'Affiliation Letter', synonyms: ['affiliation valid upto', 'affiliation expiry', 'affiliation till', 'university affiliation'] }),
      f('structural_valid_to', 'Structural stability valid until', 'date', { doc: 'Structural Stability Certificate', synonyms: ['structural stability', 'ssc valid upto', 'stability certificate expiry'] }),
    ],
  },
  documents: {
    label: 'Compliance documents',
    description: 'One row per document: type, number, issuer and validity',
    key: null,
    fields: [
      f('aicte_id', 'AICTE Permanent ID', 'id', { required: true, synonyms: ['aicte id', 'permanent id', 'pid', 'permanentid', 'inst id', 'institute id'] }),
      f('doc_type', 'Document type', 'doc_type', { required: true, synonyms: ['document', 'document type', 'doc type', 'doccategory', 'doc category', 'category', 'certificate'] }),
      f('doc_number', 'Document number', 'text', { synonyms: ['doc no', 'document no', 'certno', 'cert no', 'certificate no', 'reference', 'ref no', 'number'] }),
      f('issued_by', 'Issued by', 'text', { synonyms: ['issued by', 'issuing authority', 'issuingauthority', 'authority', 'issuer'] }),
      f('valid_from', 'Valid from', 'date', { synonyms: ['valid from', 'validfrom', 'issue date', 'date of issue', 'from'] }),
      f('valid_to', 'Valid until', 'date', { synonyms: ['valid to', 'valid till', 'validtill', 'valid upto', 'expiry', 'expiry date', 'expires', 'till', 'to'] }),
    ],
  },
};

module.exports = { TARGETS, KINDS, STATES, TYPES, OWNERSHIP, DOC_TYPES, clean };
