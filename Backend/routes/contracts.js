const router = require('express').Router();
const { pool } = require('../db/index');

router.get('/', async (req, res) => {
  try {
    const { county, risk_level, source, search, page = 1, limit = 20 } = req.query;
    let query = 'SELECT * FROM contracts WHERE 1=1';
    const params = []; let pIdx = 1;
    if (county && county !== 'All Counties') { query += ` AND county = $${pIdx}`; params.push(county); pIdx++; }
    if (risk_level && risk_level !== 'All Levels') { query += ` AND risk_level = $${pIdx}`; params.push(risk_level); pIdx++; }
    if (source && source !== 'All Sources') { query += ` AND source = $${pIdx}`; params.push(source); pIdx++; }
    if (search) { query += ` AND (description ILIKE $${pIdx} OR supplier ILIKE $${pIdx} OR contract_id ILIKE $${pIdx})`; params.push(`%${search}%`); pIdx++; }
    query += ` ORDER BY risk_score DESC, awarded_date DESC LIMIT $${pIdx} OFFSET $${pIdx+1}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/scan', async (req, res) => {
  try {
    const { contract_id, supplier, description, county, sector, value, bid_type, supplier_reg_date, awarded_date, procuring_entity } = req.body;
    let score = 0; const flags = [];
    if (bid_type === 'single_source' || bid_type === 'direct') { score += 30; flags.push("Single-source/direct award"); }
    if (value >= 500000000 && (bid_type === 'single_source' || bid_type === 'direct')) { score += 22; flags.push("High value single-source"); }
    score = Math.max(0, Math.min(100, score));
    const risk_level = score >= 75 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    const { rows } = await pool.query(`INSERT INTO contracts (contract_id, description, county, sector, value, supplier, bid_type, awarded_date, risk_score, risk_level, flags, procuring_entity, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual') ON CONFLICT (contract_id) DO UPDATE SET risk_score=$9, risk_level=$10, flags=$11 RETURNING *`, [contract_id, description, county, sector, value, supplier, bid_type, awarded_date, score, risk_level, JSON.stringify(flags), procuring_entity]);
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
