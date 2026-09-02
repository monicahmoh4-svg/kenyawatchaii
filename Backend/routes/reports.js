const router = require('express').Router();
const { pool } = require('../db/index');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM reports ORDER BY created_at DESC");
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { type, county, description, amount, anonymous } = req.body;
    const case_number = 'KW-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);
    const credibility = Math.floor(60 + Math.random() * 35);
    const routing = type.includes('Bribery') ? 'EACC' : 'DPP';
    const { rows } = await pool.query(`INSERT INTO reports (case_number, type, county, description, amount, anonymous, ai_credibility_score, routing) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [case_number, type, county, description, amount || 0, anonymous !== false, credibility, routing]);
    if (req.app.locals.broadcast) req.app.locals.broadcast('new_report', { message: `New report: ${case_number}` });
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
module.exports = router;