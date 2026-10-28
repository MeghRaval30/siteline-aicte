// AI Import Studio engine, ported from odoo_2026's intelligence module.
//
// Nothing here trusts one source. Every column is judged by three voters that
// fail in different ways:
//   lexical  reads the header against a synonym list. Knows "PID" is the AICTE
//            ID. Cannot tell what an unlabelled column holds.
//   shape    reads the values. Knows a date or an email on sight and cannot be
//            argued out of it. Has no idea what the column is *for*.
//   model    reads headers and samples and applies judgement neither of the
//            others has. Occasionally confabulates, and is optional.
// The reconciler keeps the losing votes so the screen can show the argument.

const ExcelJS = require('exceljs');
const prisma = require('../../shared/prismaClient');
const { chat } = require('../../shared/llm');
const { TARGETS, KINDS, clean } = require('./schema');

// ---------- reading ----------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text) return v.text;
    if (v.result !== undefined) return cellValue(v.result);
    if (v.hyperlink) return v.text || v.hyperlink;
    return '';
  }
  return v;
}

async function readTable(fileName, base64) {
  const buf = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (/\.csv$/i.test(fileName) || /\.txt$/i.test(fileName)) {
    return { sheet: 'CSV', grid: parseCsv(buf.toString('utf8').replace(/^﻿/, '')) };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  // The sheet with the most filled cells is the data, not the cover page.
  let best = null, bestCount = -1;
  wb.eachSheet(ws => {
    let n = 0; ws.eachRow(r => { n += r.cellCount; });
    if (n > bestCount) { best = ws; bestCount = n; }
  });
  const grid = [];
  best.eachRow({ includeEmpty: true }, (row, rn) => {
    const out = [];
    for (let c = 1; c <= best.columnCount; c++) out.push(cellValue(row.getCell(c).value));
    grid[rn - 1] = out;
  });
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
  return { sheet: best.name, grid };
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9/& ]+/g, ' ').replace(/\s+/g, ' ').trim();
const filled = row => row.filter(v => v !== '' && v != null && String(v).trim() !== '');

// The header is the row (in the first 15) that reads most like column names.
function findHeader(grid, target) {
  const syn = TARGETS[target].fields.flatMap(f => f.synonyms.concat(f.label.toLowerCase()));
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(15, grid.length); i++) {
    const cells = filled(grid[i]);
    if (cells.length < 2) continue;
    const textual = cells.filter(v => typeof v === 'string' && /[a-z]/i.test(v) && v.length < 60).length;
    const hits = cells.filter(v => { const n = norm(v); return syn.some(s => n === s || n.includes(s) || (n.length >= 3 && s.includes(n))); }).length;
    const score = hits * 3 + textual - (cells.length - textual) * 2;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

function splitRows(grid, headerIdx) {
  const width = Math.max(...grid.slice(headerIdx, headerIdx + 50).map(r => r.length), 0);
  const headers = [];
  for (let c = 0; c < width; c++) headers.push(clean(grid[headerIdx][c] instanceof Date ? '' : grid[headerIdx][c]) || `Column ${c + 1}`);
  const rows = [], dropped = [];
  for (let i = 0; i < headerIdx; i++) if (filled(grid[i]).length) dropped.push({ line: i + 1, reason: 'above the header (title or note)' });
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const cells = filled(r);
    if (!cells.length) continue;
    const first = String(cells[0]).trim().toLowerCase();
    if (/^(total|grand total|sum|count|end of report)\b/.test(first) || cells.some(v => /^(grand )?total\b/i.test(String(v).trim()))) { dropped.push({ line: i + 1, reason: 'totals row' }); continue; }
    if (cells.length === 1 && width > 3) { dropped.push({ line: i + 1, reason: 'single-cell note' }); continue; }
    const out = [];
    for (let c = 0; c < width; c++) out.push(r[c] instanceof Date ? r[c].toISOString().slice(0, 10) : (r[c] == null ? '' : String(r[c]).trim()));
    rows.push({ line: i + 1, cells: out });
  }
  // Serial-number columns ("Sr.", "S.No") carry no information.
  return { headers, rows, dropped };
}

// ---------- the three voters ----------
function lexicalVotes(header, fields) {
  const h = norm(header);
  const votes = [];
  for (const f of fields) {
    let s = 0;
    for (const syn of f.synonyms.concat(norm(f.label))) {
      if (h === syn) s = Math.max(s, 1);
      else if (h.includes(syn) && syn.length >= 3) s = Math.max(s, 0.8);
      else if (syn.includes(h) && h.length >= 3) s = Math.max(s, 0.6);
      else {
        const a = new Set(h.split(' ')), b = syn.split(' ');
        const inter = b.filter(w => a.has(w) && w.length > 2).length;
        if (inter) s = Math.max(s, 0.5 * inter / Math.max(a.size, b.length));
      }
    }
    if (s > 0) votes.push({ field: f.key, score: s });
  }
  return votes.sort((x, y) => y.score - x.score);
}

function profile(values) {
  const vals = values.filter(v => v !== '');
  const share = test => vals.length ? vals.filter(v => { try { return test(v); } catch { return false; } }).length / vals.length : 0;
  const shapes = {};
  for (const [k, def] of Object.entries(KINDS)) shapes[k] = share(def.test);
  return { fill: values.length ? vals.length / values.length : 0, distinct: new Set(vals).size, samples: [...new Set(vals)].slice(0, 4), shapes };
}

// What the values say each field could be, 0..1. Also used as a veto.
function shapeVotes(prof, fields) {
  const s = prof.shapes;
  return fields.map(f => {
    let score = s[f.kind] || 0;
    if (f.kind === 'text' || f.kind === 'name') score = Math.max(0, score - s.date - s.email - s.int * 0.8 - s.id);
    if (f.kind === 'int') score = Math.max(0, score - s.year * 0.5 - s.id - s.phone * 0.6);
    if (f.kind === 'phone') score = Math.max(0, score - s.id - s.year);
    if (f.kind === 'text' || f.kind === 'name') score -= 0.1; // a specific shape beats "some text"
    return { field: f.key, score: Math.round(score * 100) / 100 };
  }).filter(v => v.score >= 0.5).sort((a, b) => b.score - a.score);
}

async function modelVotes(headers, profiles, fields) {
  const prompt = [
    'You map spreadsheet columns to fields of an AICTE (Indian technical education regulator) database. Return JSON only.',
    'FIELDS:', ...fields.map(f => `  ${f.key}: ${f.label}`),
    'COLUMNS (index: header | sample values):',
    ...headers.map((h, i) => `  ${i}: ${h} | ${profiles[i].samples.map(v => String(v).slice(0, 30)).join(' ; ')}`),
    'Map each column index to one field key or null. A field may be used at most once.',
    'JSON shape: {"0":"field_key or null", "1": ...}',
  ].join('\n');
  try {
    const { message, model } = await chat([{ role: 'user', content: prompt }], { json: true, timeout: 45000 });
    const raw = JSON.parse(message.content);
    const keys = new Set(fields.map(f => f.key));
    const out = {};
    for (const [i, v] of Object.entries(raw)) if (keys.has(v)) out[Number(i)] = v;
    return { votes: out, model };
  } catch {
    return { votes: null, model: null };
  }
}

// ---------- reconcile ----------
function reconcile(headers, profiles, fields, model) {
  const columns = headers.map((h, i) => {
    const lex = lexicalVotes(h, fields);
    const shp = shapeVotes(profiles[i], fields);
    const mod = model?.[i] || null;
    const scores = {};
    for (const f of fields) {
      const l = lex.find(v => v.field === f.key)?.score || 0;
      const s = shp.find(v => v.field === f.key)?.score || 0;
      const m = mod === f.key ? 1 : 0;
      let total = l * 0.5 + s * 0.3 + m * 0.35;
      // Veto: values that are clearly something else cannot be this field.
      const fs = profiles[i].shapes;
      if (['date'].includes(f.kind) && fs.date < 0.4 && profiles[i].fill > 0.3) total *= 0.2;
      if (['email'].includes(f.kind) && fs.email < 0.5) total *= 0.2;
      if (['phone'].includes(f.kind) && fs.phone < 0.5 && profiles[i].fill > 0.3) total *= 0.2;
      if (['id'].includes(f.kind) && fs.id < 0.5 && profiles[i].fill > 0.3) total *= 0.3;
      if (['text', 'name'].includes(f.kind) && (fs.date > 0.7 || fs.email > 0.7)) total *= 0.2;
      if (total > 0) scores[f.key] = Math.round(total * 100) / 100;
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const serial = /^(sr|s|sl)\.?\s*(no)?\.?$|^#$|^serial/i.test(h.trim());
    return {
      index: i, header: h, samples: profiles[i].samples, fill: Math.round(profiles[i].fill * 100),
      votes: { lexical: lex[0]?.field || null, shape: shp[0] ? fields.find(f => f.key === shp[0].field).kind : null, model: mod },
      candidates: ranked.slice(0, 3).map(([field, score]) => ({ field, score })),
      field: !serial && ranked[0] && ranked[0][1] >= 0.3 ? ranked[0][0] : null,
      confidence: !serial && ranked[0] ? ranked[0][1] : 0,
      note: serial ? 'serial number column, ignored' : null,
    };
  });
  // Each field once: the strongest column keeps it.
  const owner = {};
  for (const c of [...columns].sort((a, b) => b.confidence - a.confidence)) {
    if (!c.field) continue;
    if (owner[c.field] !== undefined) { c.note = `${c.field} already taken by "${columns[owner[c.field]].header}"`; c.field = null; continue; }
    owner[c.field] = c.index;
  }
  return columns;
}

async function analyze({ target, file_name, file_data, use_ai = true }) {
  if (!TARGETS[target]) throw new Error('Unknown import target');
  const { sheet, grid } = await readTable(file_name, file_data);
  if (!grid.length) throw new Error('The file is empty');
  const headerIdx = findHeader(grid, target);
  const { headers, rows, dropped } = splitRows(grid, headerIdx);
  const fields = TARGETS[target].fields;
  const profiles = headers.map((_, c) => profile(rows.map(r => r.cells[c] ?? '')));
  const model = use_ai ? await modelVotes(headers, profiles, fields) : { votes: null, model: null };
  const columns = reconcile(headers, profiles, fields, model.votes);
  const mapped = new Set(columns.map(c => c.field).filter(Boolean));
  return {
    target, sheet, header_line: headerIdx + 1, headers, rows, dropped, columns,
    missing_required: fields.filter(f => f.required && !mapped.has(f.key)).map(f => ({ key: f.key, label: f.label, kind: f.kind })),
    engine: model.model ? `lexical + shape + ${model.model}` : 'lexical + shape (no model running)',
  };
}

// ---------- validation ----------
async function validate({ target, headers, rows, mapping, defaults = {}, options = {} }) {
  const T = TARGETS[target];
  const fields = T.fields;
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const colOf = {};
  for (const [c, key] of Object.entries(mapping || {})) if (key && byKey[key]) colOf[key] = Number(c);

  const existing = new Map((await prisma.institution.findMany({ select: { id: true, aicte_id: true, name: true } })).map(i => [i.aicte_id, i]));
  const seen = new Map();
  let gen = 0;
  const out = [];

  for (const r of rows) {
    const values = {}, issues = [];
    for (const f of fields) {
      let raw = colOf[f.key] !== undefined ? r.cells[colOf[f.key]] : undefined;
      if ((raw === undefined || raw === '') && defaults[f.key] !== undefined && defaults[f.key] !== '') raw = defaults[f.key];
      if (raw === undefined || raw === '') {
        if (f.required && !(f.key === 'aicte_id' && options.generate_ids && target === 'institutions')) issues.push({ field: f.key, level: 'error', msg: `${f.label} is missing` });
        continue;
      }
      const [v, note] = KINDS[f.kind].fn(raw);
      if (v === undefined) issues.push({ field: f.key, level: f.required ? 'error' : 'warning', msg: note });
      else { values[f.key] = v instanceof Date ? v.toISOString().slice(0, 10) : v; if (note) issues.push({ field: f.key, level: 'fixed', msg: note }); }
    }
    if (target === 'institutions' && !values.aicte_id && options.generate_ids && !issues.some(i => i.level === 'error' && i.field !== 'aicte_id')) {
      values.aicte_id = `1-9${String(Date.now() % 1e6).padStart(6, '0')}${String(++gen).padStart(3, '0')}`;
      issues.push({ field: 'aicte_id', level: 'fixed', msg: 'provisional ID generated' });
    }
    let action = issues.some(i => i.level === 'error') ? 'error' : 'create';
    const id = values.aicte_id;
    if (action !== 'error' && target === 'institutions' && id) {
      if (seen.has(id)) { action = 'skip'; issues.push({ field: 'aicte_id', level: 'warning', msg: `duplicate of line ${seen.get(id)} in this file` }); }
      else { seen.set(id, r.line); if (existing.has(id)) { action = 'update'; values._existing = existing.get(id).name; } }
    }
    if (action !== 'error' && target === 'documents') {
      if (!existing.has(id)) { action = 'error'; issues.push({ field: 'aicte_id', level: 'error', msg: `no institution with ID ${id}` }); }
      else values._institution = existing.get(id).name;
      if (values.valid_from && values.valid_to && values.valid_to < values.valid_from) issues.push({ field: 'valid_to', level: 'warning', msg: 'valid-to is before valid-from' });
    }
    out.push({ line: r.line, values, issues, action });
  }
  const count = a => out.filter(r => r.action === a).length;
  return { rows: out, summary: { total: out.length, create: count('create'), update: count('update'), skip: count('skip'), error: count('error'), fixed: out.reduce((s, r) => s + r.issues.filter(i => i.level === 'fixed').length, 0) } };
}

module.exports = { analyze, validate, readTable };
