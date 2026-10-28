require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.get('/api/v1/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' }, error: null });
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve the built client when present (single-port demo: npm run build in client/)
const dist = path.join(__dirname, '../client/dist');
app.use(express.static(dist));
app.get(/^\/(?!api|uploads).*/, (req, res, next) => res.sendFile(path.join(dist, 'index.html'), err => err && next()));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, data: null, error: err.message || 'An unexpected error occurred' });
});

const { initializeOllama } = require('./shared/ollamaSetup');

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`SiteLine AICTE server running on port ${port}`);
  require('./shared/workflow').loadSlaOverrides(require('./shared/prismaClient')).catch(e => console.error('[SLA]', e.message));
  startScheduler();
  if (process.env.AI_AUTOSTART !== 'false') initializeOllama();
});
