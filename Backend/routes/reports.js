const router = require('express').Router();
const { pool } = require('../db/index');

router.get('/', async (req, res) => {
  try {
    const { status, county } = req.query;
    let query = 'SELECT * FROM reports WHERE 1=1';
    const params = []; let pIdx = 1;
    if (status) { query += ` AND status = $${pIdx}`; params.push(status); pIdx++; }
    if (county) { query += ` AND county = $${pIdx}`; params.push(county); pIdx++; }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { type, county, sector, description, amount, anonymous } = req.body;
    const case_number = 'KW-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);
    const credibility = Math.floor(60 + Math.random() * 35);
    const routing = type.includes('Bribery') || type.includes('Embezzlement') ? 'EACC' : (type.includes('Procurement') ? 'PPRA' : 'DPP');
    const { rows } = await pool.query(`INSERT INTO reports (case_number, type, county, sector, description, amount, anonymous, ai_credibility_score, routing) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [case_number, type, county, sector, description, amount || 0, anonymous !== false, credibility, routing]);
    if (req.app.locals.broadcast) req.app.locals.broadcast('new_report', { message: `New report: ${case_number}` });
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { rows } = await pool.query("UPDATE reports SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *", [req.body.status, req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
