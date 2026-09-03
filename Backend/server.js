require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDB } = require('./db/index');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Security & CORS ───────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());

app.use('/api/ai', rateLimit({ windowMs: 60000, max: 40 }));
app.use('/api/chatbot', rateLimit({ windowMs: 60000, max: 40 }));
app.use('/api', rateLimit({ windowMs: 60000, max: 500 }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/ghost-projects', require('./routes/ghostProjects'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/chatbot', require('./routes/chatbot'));
app.use('/api/sync', require('./routes/ocdsSync'));

app.get('/health', async (_req, res) => res.status(200).json({ status: 'ok', version: '3.4.0' }));

// ── Startup: LISTEN FIRST ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 KenyaWatch AI Backend running on port ${PORT}`);
  initDB().then(() => console.log('✅ Database initialized and seeded')).catch(e => console.error('DB Error:', e));
});
