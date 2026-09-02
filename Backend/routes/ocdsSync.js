const router = require('express').Router();
const https = require('https');
const zlib = require('zlib');
const { pool } = require('../db/index');

async function fetchAndIngest(year, logId) {
  return new Promise((resolve, reject) => {
    const url = `https://data.open-contracting.org/en/publication/147/download?name=${year}.jsonl.gz`;
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) { 
        https.get(res.headers.location, (res2) => processStream(res2, logId, resolve, reject)).on('error', reject); 
        return; 
      }
      if (res.statusCode !== 200) return resolve({ inserted: 0 });
      processStream(res, logId, resolve, reject);
    }).on('error', reject);
  });
}

function processStream(res, logId, resolve, reject) {
  let inserted = 0;
  const gunzip = zlib.createGunzip();
  let buffer = '';
  res.pipe(gunzip);
  gunzip.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    const batch = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        batch.push([data.ocid || `ocds-${Date.now()}`, data.tender?.title || 'Unknown', data.tender?.procuringEntity?.name || 'National', data.tender?.value?.amount || 0, data.awards?.[0]?.suppliers?.[0]?.name || 'Unknown', data.tender?.procurementMethod || 'open', 'ppip_ocds']);
      } catch (e) {}
    }
    if (batch.length > 0) {
      const vals = batch.map((_, i) => `($${i*7+1},$${i*7+2},$${i*7+3},$${i*7+4},$${i*7+5},$${i*7+6},$${i*7+7})`).join(',');
      pool.query(`INSERT INTO contracts (contract_id, description, county, value, supplier, bid_type, source) VALUES ${vals} ON CONFLICT (contract_id) DO NOTHING`, batch.flat())
        .then(r => { inserted += r.rowCount; })
        .catch(e => console.error('Batch error:', e.message));
    }
  });
  gunzip.on('end', () => resolve({ inserted }));
  gunzip.on('error', reject);
}

router.post('/ocds', async (req, res) => {
  try {
    const { year } = req.body;
    const { rows } = await pool.query("INSERT INTO ocds_sync_log (year, status) VALUES ($1, 'running') RETURNING id", [year]);
    res.json({ success: true, message: 'Sync started', logId: rows[0].id });
    setImmediate(async () => {
      try {
        const result = await fetchAndIngest(year, rows[0].id);
        await pool.query("UPDATE ocds_sync_log SET status='complete',records=$1,finished_at=NOW() WHERE id=$2", [result.inserted, rows[0].id]);
        if (req.app.locals.broadcast && result.inserted > 0) req.app.locals.broadcast('new_contracts', { message: `${result.inserted} contracts imported`, count: result.inserted });
      } catch (e) { await pool.query("UPDATE ocds_sync_log SET status='failed',error_msg=$1 WHERE id=$2", [e.message, rows[0].id]); }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/status', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM ocds_sync_log ORDER BY started_at DESC LIMIT 5");
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = { router, fetchAndIngest };