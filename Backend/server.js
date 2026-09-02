require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDB, pool } = require('./db/index');

const app = express();
const PORT = process.env.PORT || 5000;
let dbReady = false;

// ── SSE notification clients ──────────────────────────────────────────────────
const sseClients = new Set();
function broadcastNotification(event, data) {
  const payload = 'event: ' + event + '\n\ndata: ' + JSON.stringify(data) + '\n\n';
  sseClients.forEach(client => {
    try { client.write(payload); } catch (_) { sseClients.delete(client); }
  });
}
app.locals.broadcast = broadcastNotification;

// ── Paths ─────────────────────────────────────────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend', 'public');
const ADMIN_DIR = path.join(__dirname, 'admin');

// ── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());

// ── Rate limiters (Correct order, NO /api/sync limiter) ───────────────────────
app.use('/api/ai', rateLimit({ windowMs: 60000, max: 40, standardHeaders: true, legacyHeaders: false }));
app.use('/api/chatbot', rateLimit({ windowMs: 60000, max: 40, standardHeaders: true, legacyHeaders: false }));
app.use('/api', rateLimit({ windowMs: 60000, max: 500, standardHeaders: true, legacyHeaders: false }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => { console.log(req.method + ' ' + req.path); next(); });

// ── Admin panel ───────────────────────────────────────────────────────────────
app.use('/admin', express.static(ADMIN_DIR, { index: 'index.html' }));
app.get('/admin', (_req, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));
app.get('/admin/', (_req, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));

// ── Health (ALWAYS returns 200) ───────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  let dbOk = false;
  try { if (dbReady) { await pool.query('SELECT 1'); dbOk = true; } } catch (_) {}
  return res.status(200).json({
    status: dbOk ? 'ok' : 'starting',
    database: dbOk ? 'connected' : 'connecting',
    ai: process.env.GEMINI_API_KEY ? 'configured' : 'missing_api_key',
    maps: process.env.GOOGLE_MAPS_API_KEY ? 'configured' : 'missing',
    timestamp: new Date().toISOString(),
    version: '3.3.0',
  });
});

// ── Server-Sent Events ────────────────────────────────────────────────────────
app.get('/api/notifications/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write('event: connected\n\ndata: {"message":"KenyaWatch live feed connected"}\n\n');
  const ping = setInterval(() => {
    try { res.write('event: ping\n\ndata: {"ts":' + Date.now() + '}\n\n'); }
    catch (_) { clearInterval(ping); }
  }, 25000);
  sseClients.add(res);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});

// ── Dashboard stats ───────────────────────────────────────────────────────────
app.get('/api/stats', async (_req, res) => {
  try {
    const [c, r, g] = await Promise.all([
      pool.query("SELECT COUNT(*) FILTER (WHERE risk_level='HIGH') AS flagged, COALESCE(SUM(value) FILTER (WHERE risk_level='HIGH'),0) AS funds, COUNT(*) AS total FROM contracts"),
      pool.query("SELECT COUNT(*) AS total FROM reports WHERE created_at > NOW() - INTERVAL '30 days'"),
      pool.query("SELECT COUNT(*) FILTER (WHERE detection_status IN ('ghost','partial')) AS cnt FROM ghost_projects"),
    ]);
    return res.json({ success: true, data: {
      contracts_flagged: parseInt(c.rows[0].flagged) || 0,
      contracts_total: parseInt(c.rows[0].total) || 0,
      ghost_projects: parseInt(g.rows[0].cnt) || 0,
      reports_30d: parseInt(r.rows[0].total) || 0,
      funds_at_risk: parseInt(c.rows[0].funds) || 0,
    }});
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ── Feature routes ────────────────────────────────────────────────────────────
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/ghost-projects', require('./routes/ghostProjects'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/chatbot', require('./routes/chatbot'));
app.use('/api/sync', require('./routes/ocdsSync'));

// ── Serve frontend SPA ────────────────────────────────────────────────────────
app.use(express.static(FRONTEND_DIR));
app.get('*', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  if (!res.headersSent) res.status(err.status || 500).json({ success: false, error: err.message });
});

// ── Auto-sync scheduler ───────────────────────────────────────────────────────
function scheduleAutoSync() {
  setInterval(async () => {
    if (!dbReady) return;
    const year = new Date().getFullYear();
    const { rows } = await pool.query(
      "INSERT INTO ocds_sync_log (year, status) VALUES ($1,'running') RETURNING id", [year]
    );
    const { fetchAndIngest } = require('./routes/ocdsSync');
    fetchAndIngest(year, rows[0].id)
      .then(r => {
        pool.query("UPDATE ocds_sync_log SET status='complete',records=$1,finished_at=NOW() WHERE id=$2", [r.inserted, rows[0].id]);
        if (r.inserted > 0) broadcastNotification('new_contracts', { message: r.inserted + ' new contracts imported', count: r.inserted });
      })
      .catch(e => pool.query("UPDATE ocds_sync_log SET status='failed',error_msg=$1,finished_at=NOW() WHERE id=$2", [e.message, rows[0].id]));
  }, 6 * 60 * 60 * 1000);
}

// ── Startup order: listen FIRST ───────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 KenyaWatch AI on port ' + PORT);
  initDB()
    .then(() => { dbReady = true; scheduleAutoSync(); console.log('✅ Database ready'); })
    .catch(e  => console.error('DB init failed:', e.message));
});
