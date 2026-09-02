const router = require('express').Router();
const { pool } = require('../db/index');

router.get('/', async (req, res) => {
  try {
    const { county, risk_level, search, limit = 20 } = req.query;
    let query = 'SELECT * FROM contracts WHERE 1=1';
    const params = []; let pIdx = 1;
    if (county && county !== 'All Counties') { query += ` AND county = $${pIdx}`; params.push(county); pIdx++; }
    if (risk_level && risk_level !== 'All Levels') { query += ` AND risk_level = $${pIdx}`; params.push(risk_level); pIdx++; }
    if (search) { query += ` AND (description ILIKE $${pIdx} OR supplier ILIKE $${pIdx})`; params.push(`%${search}%`); pIdx++; }
    query += ` ORDER BY risk_score DESC LIMIT $${pIdx}`; params.push(parseInt(limit));
    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/scan', async (req, res) => {
  try {
    const { contract_id, supplier, description, county, sector, value, bid_type } = req.body;
    let score = 0; const flags = [];
    if (bid_type === 'single_source') { score += 28; flags.push("Single-source award"); }
    if (value >= 500000000 && bid_type === 'single_source') { score += 22; flags.push("Value >= KES 500M single-source"); }
    score = Math.max(0, Math.min(100, score));
    const risk_level = score >= 75 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    const { rows } = await pool.query(`INSERT INTO contracts (contract_id, description, county, sector, value, supplier, bid_type, risk_score, risk_level, flags, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual') ON CONFLICT (contract_id) DO UPDATE SET risk_score=$8, risk_level=$9, flags=$10 RETURNING *`, [contract_id, description, county, sector, value, supplier, bid_type, score, risk_level, JSON.stringify(flags)]);
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
module.exports = router;