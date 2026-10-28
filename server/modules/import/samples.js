// Demo files for the Import Studio, built on request from the live database so
// their IDs always match the seeded institutions and their dates stay relative
// to today. Each one looks like something a Regional Office actually receives.

const ExcelJS = require('exceljs');
const prisma = require('../../shared/prismaClient');
const { DAY } = require('../../shared/workflow');

const ahead = n => new Date(Date.now() + n * DAY);
const dmy = (d, sep = '-') => [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join(sep);
const dmyShort = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
const pretty = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const iso = d => d.toISOString().slice(0, 10);

const SAMPLES = {
  'wro-institutions-register.xlsx': {
    title: 'WRO institutions register (hand-kept)',
    target: 'institutions',
    what: 'Title rows above the header, abbreviated headers, five date formats, MH/maha./GOA, CAPS names, "540 seats", a duplicate, a missing state, a TOTAL row, and two institutions that already exist (updates).',
  },
  'legacy-portal-documents.csv': {
    title: 'Legacy portal document export',
    target: 'documents',
    what: 'Structurally clean but in another vocabulary: LEASE_DEED, FIRE_NOC, BCC… IDs without the "1-" prefix, dd.mm.yyyy dates, one unknown institution, some already expired.',
  },
  'new-colleges-no-ids.xlsx': {
    title: 'New colleges list (no AICTE IDs)',
    target: 'institutions',
    what: 'No AICTE ID column and no type column: shows gap filling, with provisional IDs generated and a default type for every row.',
  },
};

async function build(name) {
  if (name === 'wro-institutions-register.xlsx') {
    const existing = await prisma.institution.findMany({ where: { region: { code: 'WRO' }, aicte_id: { not: '1-4421907351' } }, take: 2, orderBy: { id: 'asc' } });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Register 2027-28');
    ws.addRow(['WRO Mumbai — Institutions Register (compiled from desk files)']);
    ws.addRow(['Note: dates as received from institutions; verify before upload. Updated by section officer.']);
    ws.addRow([]);
    ws.addRow(['Sr.', 'Name of the Institute', 'AICTE PID', 'Inst. Type', 'Mgmt', 'City/Town', 'State/UT', 'Estd.', 'Sanctioned Intake', 'Principal', 'Email ID', 'Contact No', 'Lease Deed Valid Upto', 'Fire NOC Expiry']);
    const rows = [
      ['PANCHGANGA INSTITUTE OF TECHNOLOGY', '1-5100000101', 'Engg', 'Pvt', 'Kolhapur', 'MH', 2008, '540 seats', 'dr. sunil patil', 'Principal@Panchganga-IT.edu.in', '0231-2600 101', dmy(ahead(-24)), dmy(ahead(140))],
      ['Bhima Valley College of Pharmacy', '5100000102', 'B.Pharm', 'Self Financing', 'Solapur', 'Maharashtra', 2011, '120', 'Dr. Meena Joshi', 'office@bvcp.edu.in', '0217-2300 445', dmyShort(ahead(35)), pretty(ahead(300))],
      ['krishna coast school of management', '1-5100000103', 'MBA', 'Pvt (Unaided)', 'Ratnagiri', 'maha.', 2014, '180 seats', 'Prof. Anand Rao', 'director@kcsm.ac.in', '02352-220 330', pretty(ahead(900)), dmy(ahead(-6), '.')],
      ['Western Ghats Polytechnic', '1-5100000104', 'Diploma', 'Govt.', 'Satara', 'MH', 1998, '300', 'Shri V. K. Pawar', 'wgp.satara@gov.example.in', '02162-234 567', ahead(1200), ahead(58)],
      ['Sindhudurg Institute of Engineering', '1-5100000105', 'Engineering College', 'Private', 'Kudal', 'MH', 2010, '1,080', 'Dr. Rekha Sawant', 'principal@sie.edu.in', '02362-222 111', iso(ahead(15)), iso(ahead(200))],
      ['AJANTA SCHOOL OF ARCHITECTURE', '1-5100000106', 'B.Arch', 'Pvt', 'Aurangabad', 'Maharashtra', 2012, '80', 'Ar. Nikhil Deshmukh', 'admissions@asa.edu.in', '0240-2480 909', dmy(ahead(700)), dmy(ahead(90))],
      ['Vidarbha Institute of Computer Applications', '1-5100000107', 'MCA', 'Self Financing', 'Amravati', 'MH', 2015, '120 seats', 'Dr. Pooja Wankhede', 'principal at vica dot edu', '0721-2550 120', pretty(ahead(-120)), pretty(ahead(20))],
      ['Mandovi College of Engineering', '1-5100000108', 'Engg', 'Govt Aided', 'Margao', 'GOA', 2001, '420', 'Dr. Francis D\'Souza', 'principal@mce-goa.edu.in', '0832-2700 456', dmy(ahead(1500)), dmy(ahead(310))],
      ['Purna College of Engineering', '1-5100000109', 'Engg', 'Pvt', 'Parbhani', '', 2013, '360', 'Dr. S. Kale', 'pce@purna.edu.in', '02452-240 100', dmy(ahead(400)), dmy(ahead(100))],
      ['Panchganga Institute of Technology', '1-5100000101', 'Engg', 'Pvt', 'Kolhapur', 'MH', 2008, '540', 'Dr. Sunil Patil', 'principal@panchganga-it.edu.in', '0231-2600 101', dmy(ahead(-24)), dmy(ahead(140))],
      ...existing.map((e, i) => [e.name.toUpperCase(), e.aicte_id.replace('1-', ''), e.type === 'Engineering' ? 'Engg' : e.type, 'Pvt', e.city, e.state === 'Maharashtra' ? 'MH' : e.state, e.established_year, `${e.approved_intake + 60} seats`, e.head_name, e.email, '', dmy(ahead(2400 + i * 90)), dmy(ahead(330))]),
    ];
    rows.forEach((r, i) => ws.addRow([i + 1, ...r]));
    ws.addRow([]);
    ws.addRow(['', 'TOTAL', '', '', '', '', '', '', 4320]);
    ws.getRow(4).font = { bold: true };
    ws.columns.forEach(c => { c.width = 18; });
    ws.getColumn(2).width = 42;
    return { buffer: await wb.xlsx.writeBuffer(), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  if (name === 'legacy-portal-documents.csv') {
    const insts = await prisma.institution.findMany({ where: { aicte_id: { not: '1-4421907351' } }, take: 8, orderBy: { id: 'desc' } });
    const CAT = [['LEASE_DEED', 'Sub-Registrar', 3650], ['FIRE_NOC', 'State Fire Services', 365], ['BCC', 'Municipal Corporation', null], ['STRUCT_STAB', 'Chartered Structural Engineer', 1095], ['AFFILIATION', 'State Technical University', 365], ['CORPUS_FD', 'Nationalised Bank', 1825]];
    const offsets = [400, -15, null, 40, 25, 900, -60, 150, 12, 700, 300, 33];
    const lines = ['PermanentID,DocCategory,CertNo,IssuingAuthority,ValidFrom,ValidTill'];
    let k = 0;
    insts.forEach((inst, i) => {
      for (const [cat, issuer, span] of [CAT[i % CAT.length], CAT[(i + 2) % CAT.length]]) {
        const off = span === null ? null : offsets[k++ % offsets.length];
        const till = off === null ? null : ahead(off);
        const from = till ? new Date(till.getTime() - span * DAY) : ahead(-2000);
        const pid = i % 3 === 0 ? inst.aicte_id.replace('1-', '') : inst.aicte_id;
        lines.push([pid, cat, `${cat.slice(0, 3)}/${1000 + i * 7 + k}/${from.getFullYear()}`, `"${issuer}"`, dmy(from, '.'), till ? dmy(till, '.') : 'NA'].join(','));
      }
    });
    lines.push('1-9999999999,FIRE_NOC,FIR/0000/2025,"State Fire Services",01.01.2026,01.01.2027');
    return { buffer: Buffer.from(lines.join('\r\n') + '\r\n', 'utf8'), mime: 'text/csv' };
  }

  if (name === 'new-colleges-no-ids.xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Proposed 2027-28');
    ws.addRow(['College', 'District', 'State', 'Seats', 'Contact person', 'Email', 'Lease till']);
    [
      ['Wainganga Institute of Technology', 'Bhandara', 'Maharashtra', 300, 'Dr. Ashok Meshram', 'info@wit-bhandara.edu.in', '31 Mar 2034'],
      ['Ellora Institute of Technology', 'Aurangabad', 'Maharashtra', 240, 'Dr. Kavita Jadhav', 'principal@eit-ellora.edu.in', '15-06-2033'],
      ['Mula Mutha Institute of Technology', 'Pune', 'Maharashtra', 420, 'Prof. Rohan Gokhale', 'contact@mmit.edu.in', '2035-01-31'],
      ['Tapi Valley Institute of Technology', 'Jalgaon', 'Maharashtra', 180, 'Dr. Neelam Chaudhari', 'tvit@tapi.edu.in', '30/09/32'],
    ].forEach(r => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach(c => { c.width = 22; });
    return { buffer: await wb.xlsx.writeBuffer(), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  return null;
}

module.exports = { SAMPLES, build };
