// Tamper-evident audit trail. Each event stores sha256(prev_hash ‖ canonical event),
// so changing, removing or reordering any past row breaks every hash after it.
// The database refuses UPDATE and DELETE on the chain (triggers below), the chain
// can be re-verified at any time, and its head is anchored daily in AuditAnchor.
const crypto = require('crypto');

const GENESIS = '0'.repeat(64);

const canonical = e => JSON.stringify([e.at.toISOString(), e.actor_id ?? null, e.action, e.entity_type ?? null, e.entity_id ?? null, e.metadata ?? null]);
const hashOf = (prev, e) => crypto.createHash('sha256').update(prev + '|' + canonical(e)).digest('hex');

// Appends are serialised so two writers never chain onto the same previous hash.
let tail = Promise.resolve();
function record(prisma, { actorId, action, entityType, entityId, metadata }) {
  const run = tail.then(async () => {
    const last = await prisma.auditEvent.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
    const prev = last?.hash || GENESIS;
    const e = {
      at: new Date(), actor_id: actorId ?? null, action: String(action).slice(0, 500),
      entity_type: entityType ?? null, entity_id: entityId != null ? Number(entityId) : null,
      metadata: metadata == null ? null : typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
    };
    return prisma.auditEvent.create({ data: { ...e, prev_hash: prev, hash: hashOf(prev, e) } });
  });
  tail = run.catch(() => {});
  return run;
}

// Walk the whole chain and report the first row whose hash or link does not match.
async function verify(prisma) {
  const rows = await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } });
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev) return { ok: false, count: rows.length, broken_at: r.id, reason: 'link to the previous event does not match' };
    if (hashOf(prev, r) !== r.hash) return { ok: false, count: rows.length, broken_at: r.id, reason: 'event content was altered' };
    prev = r.hash;
  }
  const anchors = await prisma.auditAnchor.findMany({ orderBy: { id: 'asc' } });
  for (const a of anchors) {
    const at = rows[a.count - 1];
    if (a.count > rows.length || (at && at.hash !== a.head)) return { ok: false, count: rows.length, broken_at: at?.id ?? null, reason: `history differs from the anchor published ${a.at.toISOString()}` };
  }
  return { ok: true, count: rows.length, head: prev, anchors: anchors.length };
}

async function anchor(prisma) {
  const last = await prisma.auditEvent.findFirst({ orderBy: { id: 'desc' } });
  if (!last) return null;
  const count = await prisma.auditEvent.count();
  return prisma.auditAnchor.create({ data: { count, head: last.hash } });
}

// Database-level guards. SQLite and PostgreSQL both reject UPDATE/DELETE on the chain.
async function ensureGuards(prisma) {
  const sqlite = await prisma.$queryRawUnsafe('SELECT sqlite_version() AS v').then(() => true, () => false);
  if (sqlite) {
    for (const [table, verb, name] of [['AuditEvent', 'UPDATE', 'audit_no_update'], ['AuditEvent', 'DELETE', 'audit_no_delete'], ['AuditAnchor', 'UPDATE', 'anchor_no_update'], ['AuditAnchor', 'DELETE', 'anchor_no_delete']]) {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${verb} ON "${table}" BEGIN SELECT RAISE(ABORT, 'audit trail is append-only'); END;`);
    }
  } else {
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit trail is append-only'; END; $$ LANGUAGE plpgsql;`);
    for (const table of ['AuditEvent', 'AuditAnchor']) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${table.toLowerCase()}_append_only ON "${table}";`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${table.toLowerCase()}_append_only BEFORE UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION audit_append_only();`);
    }
  }
}

module.exports = { record, verify, anchor, ensureGuards, hashOf, GENESIS };
