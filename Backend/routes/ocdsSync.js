const router = require('express').Router();
const https = require('https');
const zlib = require('zlib');
const { pool } = require('../db/index');

function fetchAndIngest(year, logId) {
  return new Promise((resolve, reject) => {
    const url = `https://data.open-contracting.org/en/publication/147/download?name=${year}.jsonl.gz`;
    console.log(`📥 Fetching OCDS data from: ${url}`);

    const req = https.get(url, { timeout: 300000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return https.get(res.headers.location, { timeout: 300000 }, (res2) => processStream(res2, logId, resolve, reject));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from OCP registry`));
      }
      processStream(res, logId, resolve, reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

function processStream(res, logId, resolve, reject) {
  const gunzip = zlib.createGunzip();
  res.pipe(gunzip);
  gunzip.setEncoding('utf8');

  let buffer = '', inserted = 0, parsed = 0, batch = [], flushing = false;

  async function flush() {
    if (flushing || !batch.length) return;
    flushing = true;
    const rows = batch.splice(0);
    try {
      const client = await pool.connect();
      for (const r of rows) {
        try {
          await client.query(
            `INSERT INTO contracts (contract_id, description, county, sector, value, supplier, bid_type, awarded_date, risk_score, risk_level, flags, procuring_entity, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (contract_id) DO UPDATE SET description = EXCLUDED.description, risk_score = EXCLUDED.risk_score, risk_level = EXCLUDED.risk_level, flags = EXCLUDED.flags, updated_at = NOW()`,
            [r.contract_id, r.description, r.county, r.sector, r.value, r.supplier, r.bid_type, r.awarded_date, r.risk_score, r.risk_level, r.flags, r.procuring_entity, 'ppip_ocds']
          );
          inserted++;
        } catch (err) { /* Ignore individual row errors */ }
      }
      client.release();
      await pool.query('UPDATE ocds_sync_log SET records=$1 WHERE id=$2', [inserted, logId]);
    } catch (err) { console.error('Batch insert error:', err.message); }
    flushing = false;
  }

  gunzip.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        // Simplified parsing for stability
        if (rec.ocid && rec.tender?.title) {
          batch.push({
            contract_id: `OCDS-${rec.ocid}`.slice(0, 119),
            description: (rec.tender.title || '').slice(0, 499),
            county: 'National', // Inferred in a real app
            sector: 'Infrastructure',
            value: Math.round(rec.tender.value?.amount || 0),
            supplier: rec.awards?.[0]?.suppliers?.[0]?.name || 'Unknown',
            bid_type: rec.tender.procurementMethod || 'open',
            awarded_date: rec.awards?.[0]?.date?.slice(0, 10) || null,
            risk_score: 0, risk_level: 'LOW', flags: '[]', procuring_entity: rec.buyer?.name || ''
          });
          parsed++;
        }
      } catch (e) {}
      if (batch.length >= 50) {
        gunzip.pause();
        flush().then(() => gunzip.resume()).catch(() => gunzip.resume());
      }
    }
  });

  gunzip.on('end', async () => {
    await flush();
    console.log(`🎉 Sync complete: parsed ${parsed}, inserted ${inserted}`);
    resolve({ inserted });
  });
  gunzip.on('error', reject);
}

router.post('/ocds', async (req, res) => {
  try {
    const { year } = req.body;
    // Use ON CONFLICT to prevent crashing if year already exists
    const { rows } = await pool.query(
      `INSERT INTO ocds_sync_log (year, status) VALUES ($1, 'running') 
       ON CONFLICT (year) DO UPDATE SET status='running', records=0, error_msg=NULL, started_at=NOW() RETURNING id`, 
      [year]
    );
    
    res.json({ success: true, message: 'Sync started in background', logId: rows[0].id });
    
    setImmediate(async () => {
      try {
        const result = await fetchAndIngest(year, rows[0].id);
        await pool.query("UPDATE ocds_sync_log SET status='complete', finished_at=NOW() WHERE id=$2", [result.inserted, rows[0].id]);
      } catch (e) {
        console.error('Sync failed:', e.message);
        await pool.query("UPDATE ocds_sync_log SET status='failed', error_msg=$1, finished_at=NOW() WHERE id=$2", [e.message, rows[0].id]);
      }
    });
  } catch (e) { 
    res.status(500).json({ success: false, error: e.message }); 
  }
});

router.get('/status', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM ocds_sync_log ORDER BY started_at DESC LIMIT 5");
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
