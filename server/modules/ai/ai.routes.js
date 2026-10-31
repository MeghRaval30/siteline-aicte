const express = require('express');
const router = express.Router();
const authenticate = require('../../shared/authenticate');
const { runAgent, runOffline } = require('./agent');
const prisma = require('../../shared/prismaClient');
const { pickModel } = require('../../shared/llm');
const { DAY, ACTIVE_STAGES, slaInfo } = require('../../shared/workflow');
const { appScope, instScope } = require('../../shared/scope');

// POST /api/v1/ai/chat  { message, session_id, fast }
router.post('/chat', authenticate, async (req, res) => {
  try {
    const { message, session_id, fast } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });

    // A session is only ever resumed by the user who owns it.
    let session = session_id ? await prisma.conversationSession.findFirst({ where: { id: String(session_id), user_id: req.user.id } }).catch(() => null) : null;
    let history = session ? JSON.parse(session.messages || '[]') : [];
    if (!session) session = await prisma.conversationSession.create({ data: { user_id: req.user.id } });

    const { answer, trace, engine } = fast ? await runOffline(message, req.user) : await runAgent(message, history, req.user);

    history.push({ role: 'user', content: message }, { role: 'assistant', content: answer });
    if (history.length > 12) history = history.slice(-12);
    await prisma.conversationSession.update({ where: { id: session.id }, data: { messages: JSON.stringify(history) } });

    res.json({ success: true, data: { answer, trace, engine, session_id: session.id } });
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ success: false, error: 'The assistant could not answer right now' });
  }
});

router.get('/status', authenticate, async (req, res) => {
  const model = await pickModel();
  res.json({ success: true, data: { online: !!model, model, fallback: 'keyword router' } });
});

// Rule-based insight cards for the dashboard
router.get('/insights', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const [apps, expiring, overdueU, reports] = await Promise.all([
      prisma.application.findMany({ where: { AND: [appScope(req.user), { stage: { in: ACTIVE_STAGES } }] } }),
      prisma.complianceDocument.count({ where: { institution: instScope(req.user), status: 'Expiring Soon', valid_to: { lte: new Date(now.getTime() + 30 * DAY) } } }),
      prisma.undertaking.count({ where: { institution: instScope(req.user), status: 'Overdue' } }),
      prisma.eVCVisit.count({ where: { application: appScope(req.user), status: 'Scheduled', visit_date: { lt: now } } }),
    ]);
    const breached = apps.map(a => ({ a, s: slaInfo(a, now) })).filter(x => x.s.breached);
    const byStage = {};
    breached.forEach(x => { byStage[x.a.stage] = (byStage[x.a.stage] || 0) + 1; });
    const worst = Object.entries(byStage).sort((a, b) => b[1] - a[1])[0];
    const out = [];
    if (worst) out.push({ type: 'danger', message: `Bottleneck: ${worst[1]} applications past SLA at ${worst[0].replace('_', ' ')}` });
    if (expiring) out.push({ type: 'warning', message: `${expiring} compliance documents lapse within 30 days` });
    if (overdueU) out.push({ type: 'danger', message: `${overdueU} undertakings are overdue — show-cause candidates` });
    if (reports) out.push({ type: 'warning', message: `${reports} EVC reports not filed after the visit` });
    out.push({ type: 'info', message: `${apps.length} applications in process, ${breached.length} beyond SLA` });
    res.json({ success: true, data: out });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/sessions/:id', authenticate, async (req, res) => {
  const out = await prisma.conversationSession.deleteMany({ where: { id: String(req.params.id), user_id: req.user.id } });
  if (!out.count) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
