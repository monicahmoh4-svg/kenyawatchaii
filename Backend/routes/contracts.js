const router = require('express').Router();
const { pool } = require('../db/index');
const syncRouter = require('./ocdsSync');

router.get('/', async (req, res) => {
  try {
    const { county, risk_level, search, limit = 100 } = req.query;
    let query = 'SELECT * FROM contracts WHERE 1=1';
    const params = []; let pIdx = 1;
    if (county && county !== 'All Counties') { query += ` AND county = $${pIdx}`; params.push(county); pIdx++; }
    if (risk_level && risk_level !== 'All Levels') { query += ` AND risk_level = $${pIdx}`; params.push(risk_level); pIdx++; }
    if (search) { query += ` AND (description ILIKE $${pIdx} OR supplier ILIKE $${pIdx} OR contract_id ILIKE $${pIdx})`; params.push(`%${search}%`); pIdx++; }
    query += ` ORDER BY risk_score DESC, awarded_date DESC LIMIT $${pIdx}`;
    params.push(parseInt(limit));
    
    const { rows } = await pool.query(query, params);
    
    // Merge with memory fallback if DB is empty
    const memoryData = syncRouter.getMemoryContracts();
    const finalData = [...rows, ...memoryData];
    
    res.json({ success: true, data: finalData });
  } catch (e) {
    // DB completely failed, return memory data
    const memoryData = syncRouter.getMemoryContracts();
    res.json({ success: true, data: memoryData, fallback: true });
  }
});

router.post('/scan', async (req, res) => {
  try {
    const { contract_id, supplier, description, county, sector, value, bid_type, awarded_date } = req.body;
    let score = 0; const flags = [];
    if (bid_type === 'single_source' || bid_type === 'direct') { score += 30; flags.push("Single-source/direct award"); }
    if (value >= 500000000 && (bid_type === 'single_source' || bid_type === 'direct')) { score += 22; flags.push("High value single-source"); }
    score = Math.max(0, Math.min(100, score));
    const risk_level = score >= 75 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    
    // Try to save to DB, if fails, just return the calculated risk
    try {
      await pool.query(`INSERT INTO contracts (contract_id, description, county, sector, value, supplier, bid_type, awarded_date, risk_score, risk_level, flags, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual') ON CONFLICT (contract_id) DO UPDATE SET risk_score=$9, risk_level=$10, flags=$11 RETURNING *`, [contract_id, description, county, sector, value, supplier, bid_type, awarded_date, score, risk_level, JSON.stringify(flags)]);
    } catch(_) {}

    res.json({ success: true, data: { contract_id, risk_score: score, risk_level, flags, source: 'manual' } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
