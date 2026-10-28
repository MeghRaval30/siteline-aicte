const prisma = require('./prismaClient');

// External stakeholders do not live in the portal, so what reaches them in-app
// is also queued as an email. Staff (Admin, Officer) get in-app only.
const EXTERNAL = ['Institution', 'Expert'];
const SUBJECT = {
  ALERT: 'AICTE compliance alert', APPLICATION: 'Update on your AICTE application', EVC: 'Expert Visit Committee',
  DOCUMENT: 'Compliance document update', UNDERTAKING: 'Undertaking update', REMINDER: 'Compliance reminder from AICTE',
};

async function notify({ userId, type, message, relatedEntityType, relatedEntityId }) {
  try {
    await prisma.notification.create({
      data: {
        user_id: userId,
        type,
        message,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId
      }
    });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, role: true } });
    if (user && EXTERNAL.includes(user.role)) {
      await prisma.outbox.create({
        data: {
          user_id: userId, to_name: user.name, to_email: user.email, channel: 'Email',
          subject: `${SUBJECT[type] || 'Message from AICTE'}${type === 'ALERT' ? `: ${message.slice(0, 60)}` : ''}`,
          body: `Dear ${user.name},\n\n${message}\n\nPlease sign in to the AICTE approval portal for details and to respond.\n\n— AICTE Approval Bureau (automated message, SiteLine prototype)`,
          status: process.env.SMTP_URL ? 'Queued' : 'Simulated',
          related_entity_type: relatedEntityType, related_entity_id: relatedEntityId,
        },
      });
    }
  } catch (error) {
    console.error('Failed to create notification:', error);
    // Don't throw to avoid failing primary actions
  }
}

module.exports = notify;
