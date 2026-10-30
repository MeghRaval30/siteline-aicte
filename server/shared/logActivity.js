const prisma = require('./prismaClient');
const audit = require('./audit');

// Every action goes to the readable activity log and to the hash-chained audit trail.
// A failure to write the audit chain is surfaced in the server log as an integrity problem.
async function logActivity({ actorUserId, action, entityType, entityId, metadata }) {
  try {
    await prisma.activityLog.create({
      data: {
        actor_user_id: actorUserId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        metadata: metadata ? JSON.stringify(metadata) : null
      }
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
  try {
    await audit.record(prisma, { actorId: actorUserId, action, entityType, entityId, metadata });
  } catch (error) {
    console.error('[AUDIT] could not append to the audit chain:', error);
  }
}

module.exports = logActivity;
