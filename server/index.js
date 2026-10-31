require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const { jwtSecret, corsOrigins } = require('./shared/config');

jwtSecret(); // fail fast in production when the signing secret is weak

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: corsOrigins(), credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => { req.id = crypto.randomUUID().slice(0, 8); res.set('X-Request-Id', req.id); next(); });

app.get('/api/v1/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' }, error: null });
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.id} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

const { authRouter } = require('./modules/auth');
const applicationRoutes = require('./modules/applications/application.routes');
const evcRoutes = require('./modules/evc/evc.routes');
const complianceRoutes = require('./modules/compliance/compliance.routes');
const alertRoutes = require('./modules/alerts/alert.routes');
const institutionRoutes = require('./modules/institutions/institution.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const userRoutes = require('./modules/users/user.routes');
const notificationRoutes = require('./modules/notifications/notification.routes');
const activityLogRoutes = require('./modules/notifications/activityLog.routes');
const aiRoutes = require('./modules/ai/ai.routes');
const importRoutes = require('./modules/import/import.routes');
const settingsRoutes = require('./modules/settings/settings.routes');
const outboxRoutes = require('./modules/outbox/outbox.routes');
const { startScheduler } = require('./modules/alerts/engine');

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/applications', applicationRoutes);
app.use('/api/v1/evc', evcRoutes);
app.use('/api/v1/compliance', complianceRoutes);
app.use('/api/v1/alerts', alertRoutes);
app.use('/api/v1/institutions', institutionRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/activity-logs', activityLogRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/import', importRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/outbox', outboxRoutes);
app.use('/api/v1/files', require('./modules/files/files.routes'));
app.use('/api/v1/audit', require('./modules/audit/audit.routes'));
app.use('/api/v1/escalations', require('./modules/escalations/escalation.routes'));
app.use('/api/v1', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// Serve the built client when present (single-port demo: npm run build in client/)
const dist = path.join(__dirname, '../client/dist');
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (req, res, next) => res.sendFile(path.join(dist, 'index.html'), err => err && next()));

app.use((err, req, res, next) => {
  console.error(`[${req.id}]`, err);
  const status = err.status || err.statusCode || 500;
  // Client errors (bad JSON, body too large) keep their message; server errors never leak internals.
  res.status(status).json({ success: false, data: null, error: status < 500 ? (err.expose ? err.message : 'Bad request') : `Something went wrong (ref ${req.id})` });
});

const { initializeOllama } = require('./shared/ollamaSetup');

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`SiteLine AICTE server running on port ${port}`);
  const prisma = require('./shared/prismaClient');
  Promise.all([
    require('./shared/workflow').loadSlaOverrides(prisma),
    require('./shared/routes').loadRoutes(prisma),
    require('./shared/audit').ensureGuards(prisma),
    require('./shared/escalation').seedLadders(prisma),
  ]).catch(e => console.error('[startup]', e.message)).finally(() => startScheduler());
  if (process.env.AI_AUTOSTART !== 'false') initializeOllama();
});
