const router = require('express').Router();
const https = require('https');
const zlib = require('zlib');
const { pool } = require('../db/index');

// County inference mapping
const COUNTY_MAP = {
  'Nairobi': ['nairobi','city county','upper hill','westlands','kibera','langata','kasarani','embakasi'],
  'Mombasa': ['mombasa','kilindini','mvita','likoni','changamwe'],
  'Kisumu': ['kisumu','nyanza','winam'],
  'Nakuru': ['nakuru','naivasha','gilgil'],
  'Kiambu': ['kiambu','thika','ruiru','gatundu','limuru'],
  'Kisii': ['kisii','gusii'],
  'Kakamega': ['kakamega','mumias'],
  'Meru': ['meru county','meru '],
  'Kilifi': ['kilifi','malindi','kaloleni'],
  'Kwale': ['kwale','msambweni','kinango'],
  'Wajir': ['wajir'],
  'Mandera': ['mandera'],
  'Marsabit': ['marsabit','moyale'],
  'Turkana': ['turkana','lodwar'],
  'Garissa': ['garissa'],
  'Tana River': ['tana river','hola','garsen'],
  'Lamu': ['lamu'],
  'Baringo': ['baringo','kabarnet','eldama'],
  'Bomet': ['bomet'],
  'Busia': ['busia'],
  'Elgeyo Marakwet': ['elgeyo','marakwet','iten'],
  'Embu': ['embu'],
  'Homa Bay': ['homa bay','homabay'],
  'Isiolo': ['isiolo'],
  'Kajiado': ['kajiado','ngong'],
  'Kericho': ['kericho'],
  'Kirinyaga': ['kirinyaga','kerugoya'],
  'Kitui': ['kitui'],
  'Laikipia': ['laikipia','nyahururu'],
  'Machakos': ['machakos'],
  'Makueni': ['makueni','wote'],
  "Murang'a": ["murang'a",'muranga','kangema'],
  'Narok': ['narok'],
  'Nandi': ['nandi','kapsabet'],
  'Nyandarua': ['nyandarua','ol kalou'],
  'Nyamira': ['nyamira'],
  'Nyeri': ['nyeri'],
  'Samburu': ['samburu','maralal'],
  'Siaya': ['siaya'],
  'Taita Taveta': ['taita','taveta','wundanyi'],
  'Tharaka Nithi': ['tharaka nithi','chuka'],
  'Trans Nzoia': ['trans nzoia','kitale'],
  'Uasin Gishu': ['uasin gishu','eldoret'],
  'Vihiga': ['vihiga'],
  'West Pokot': ['west pokot','kapenguria'],
  'National': ['national','republic of kenya','government of kenya','ministry','state department'],
};

function inferCounty(text) {
  const lower = text.toLowerCase();
  for (const [county, keywords] of Object.entries(COUNTY_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return county;
    }
  }
  return 'National';
}

function inferSector(text) {
  const lower = text.toLowerCase();
  if (lower.includes('road') || lower.includes('highway') || lower.includes('tarmac') || lower.includes('bypass')) return 'Roads';
  if (lower.includes('health') || lower.includes('hospital') || lower.includes('clinic') || lower.includes('medical') || lower.includes('drugs')) return 'Health';
  if (lower.includes('school') || lower.includes('education') || lower.includes('classroom') || lower.includes('university')) return 'Education';
  if (lower.includes('water') || lower.includes('sewerage') || lower.includes('borehole')) return 'Water';
  if (lower.includes('agriculture') || lower.includes('fertiliser') || lower.includes('farming') || lower.includes('seed')) return 'Agriculture';
  if (lower.includes('ict') || lower.includes('computer') || lower.includes('software') || lower.includes('digital') || lower.includes('system')) return 'ICT';
  if (lower.includes('security') || lower.includes('cctv') || lower.includes('police')) return 'Security';
  return 'Infrastructure';
}

function scoreRisk(value, bid_type, supplier_reg_date, awarded_date) {
  let score = 0;
  const flags = [];
  const methods = { single_source: 30, direct: 28, restricted: 15, emergency: 10, negotiated: 8, open: 0 };
  score += methods[bid_type] || 0;
  if (bid_type === 'single_source' || bid_type === 'direct')
    flags.push('Single-source/direct award — no competitive bidding');

  const v = parseInt(value) || 0;
  if (v >= 5000000000) { score += 20; flags.push('Extremely high value — KES ' + (v/1e9).toFixed(1) + 'B'); }
  else if (v >= 1000000000 && bid_type !== 'open') { score += 18; flags.push('KES ' + (v/1e9).toFixed(1) + 'B via non-open process'); }
  else if (v >= 500000000 && (bid_type === 'single_source' || bid_type === 'direct')) { score += 22; flags.push('KES ' + (v/1e6).toFixed(0) + 'M single-source'); }

  if (supplier_reg_date && awarded_date) {
    const regDate = new Date(supplier_reg_date);
    const awardDate = new Date(awarded_date);
    const monthsOld = (awardDate - regDate) / (1000 * 60 * 60 * 30);
    if (monthsOld < 6) { score += 28; flags.push('Company registered only ' + Math.round(monthsOld) + ' months before award'); }
    else if (monthsOld < 18) { score += 15; flags.push('Company less than 18 months old at award'); }
  }

  score = Math.min(Math.max(score, 0), 100);
  const risk_level = score >= 75 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  if (!flags.length) flags.push('No significant fraud indicators detected');
  return { score, risk_level, flags };
}

function parseOCDSRecord(record) {
  const ocid = (record.ocid || '').trim();
  if (!ocid) return null;
  
  const releases = Array.isArray(record.releases) ? record.releases : [record];
  let description = '', supplier = '', value = 0, bid_type = 'open';
  let awarded_date = null, procuring_entity = '', supplier_reg_date = null;

  for (const r of releases) {
    if (r.tender && !description) {
      description = (r.tender.title || r.tender.description || '').trim();
      procuring_entity = ((r.buyer?.name) || (r.tender.procuringEntity?.name) || '').trim();
      const pm = (r.tender.procurementMethod || r.tender.procurementMethodDetails || '').toLowerCase();
      if (pm.includes('single') || pm.includes('direct')) bid_type = 'single_source';
      else if (pm.includes('restrict')) bid_type = 'restricted';
      else if (pm.includes('emergency')) bid_type = 'emergency';
      else if (pm.includes('negotiat')) bid_type = 'negotiated';
    }
    if (!supplier && r.awards?.length > 0) {
      const aw = r.awards[0];
      supplier = (aw.suppliers?.[0]?.name || '').trim();
      if (!value && aw.value?.amount) {
        value = Math.round(parseFloat(aw.value.amount) || 0);
        const cur = (aw.value.currency || 'KES').toUpperCase();
        if (cur === 'USD') value = Math.round(value * 130);
        else if (cur === 'EUR') value = Math.round(value * 140);
        else if (cur === 'GBP') value = Math.round(value * 165);
      }
      if (!awarded_date && aw.date) awarded_date = aw.date.slice(0, 10);
    }
    if (r.contracts?.length > 0) {
      const co = r.contracts[0];
      if (!awarded_date && co.dateSigned) awarded_date = co.dateSigned.slice(0, 10);
      if (!value && co.value?.amount) value = Math.round(parseFloat(co.value.amount) || 0);
    }
    if (!procuring_entity && r.buyer?.name) procuring_entity = r.buyer.name.trim();
  }

  if (!description || description.length < 4) return null;

  const contract_id = ('OCDS-' + ocid.replace(/[^a-zA-Z0-9-]/g, '-')).slice(0, 100);
  const county = inferCounty(description + ' ' + procuring_entity);
  const sector = inferSector(description);
  const { score, risk_level, flags } = scoreRisk(value, bid_type, supplier_reg_date, awarded_date);

  return { 
    contract_id, description: description.slice(0, 500), county, sector,
    value, supplier: (supplier || 'Unknown').slice(0, 200), bid_type,
    awarded_date: awarded_date || null, risk_score: score, risk_level,
    flags: JSON.stringify(flags), procuring_entity: procuring_entity.slice(0, 200),
    ocds_ocid: ocid.slice(0, 100), source: 'ppip_ocds'
  };
}

async function insertBatch(records) {
  if (!records.length) return 0;
  let count = 0;
  const client = await pool.connect();
  try {
    for (const r of records) {
      try {
        const result = await client.query(
          `INSERT INTO contracts
             (contract_id, description, county, sector, value, supplier, bid_type,
              awarded_date, risk_score, risk_level, flags, procuring_entity, ocds_ocid, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (contract_id) DO UPDATE SET
             description = EXCLUDED.description,
             risk_score  = EXCLUDED.risk_score,
             risk_level  = EXCLUDED.risk_level,
             flags       = EXCLUDED.flags,
             updated_at  = NOW()
           RETURNING (xmax = 0) AS is_new`,
          [r.contract_id, r.description, r.county, r.sector, r.value,
           r.supplier, r.bid_type, r.awarded_date, r.risk_score,
           r.risk_level, r.flags, r.procuring_entity, r.ocds_ocid, r.source]
        );
        if (result.rows[0]?.is_new) count++;
      } catch (err) {
        console.error('Insert error for', r.contract_id, err.message);
      }
    }
  } finally { 
    client.release(); 
  }
  return count;
}

function fetchAndIngest(year, logId) {
  return new Promise((resolve, reject) => {
    const urls = [
      `https://data.open-contracting.org/en/publication/147/download?name=${year}.jsonl.gz`,
      `https://data.open-contracting.org/data/kenya/ppra/ocds-5whusi/${year}.jsonl.gz`
    ];
    let urlIndex = 0;

    function doGet(targetUrl, hops) {
      if (hops > 5) {
        console.error(`Too many redirects for ${targetUrl}`);
        return tryNextUrl();
      }
      
      console.log(`📥 Attempting to download from: ${targetUrl}`);
      
      const mod = targetUrl.startsWith('https') ? https : require('http');
      const req = mod.get(targetUrl, { timeout: 300000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          console.log(`↩️ Redirecting to: ${res.headers.location}`);
          return doGet(res.headers.location, hops + 1);
        }
        if (res.statusCode === 404) {
          res.resume();
          console.log(`❌ 404 Not Found for ${targetUrl}, trying next URL...`);
          return tryNextUrl();
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode + ' from OCP data registry'));
        }
        
        console.log(`✅ Successfully connected, starting stream processing...`);
        const gunzip = zlib.createGunzip();
        res.pipe(gunzip);
        gunzip.setEncoding('utf8');

        let buffer = '', inserted = 0, parsed = 0, batch = [], flushing = false;

        async function flush() {
          if (flushing || !batch.length) return;
          flushing = true;
          const rows = batch.splice(0);
          try {
            const count = await insertBatch(rows);
            inserted += count;
            console.log(` Inserted ${count} contracts (Total: ${inserted})`);
            await pool.query('UPDATE ocds_sync_log SET records=$1 WHERE id=$2', [inserted, logId]);
          } catch (err) {
            console.error('Batch insert error:', err.message);
          }
          flushing = false;
        }

        gunzip.on('data', (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const l = line.trim();
            if (!l) continue;
            try {
              const rec = parseOCDSRecord(JSON.parse(l));
              if (rec) { batch.push(rec); parsed++; }
            } catch (e) {
              // Ignore individual line parse errors
            }
            if (batch.length >= 50) {
              gunzip.pause();
              flush().then(() => gunzip.resume()).catch(() => gunzip.resume());
            }
          }
        });

        gunzip.on('end', async () => {
          if (buffer.trim()) {
            try { 
              const rec = parseOCDSRecord(JSON.parse(buffer)); 
              if (rec) batch.push(rec); 
            } catch (_) {}
          }
          await flush();
          console.log(`🎉 Sync complete: parsed ${parsed} records, inserted ${inserted} new contracts.`);
          resolve({ year, parsed, inserted });
        });

        gunzip.on('error', (err) => {
          console.error('Gunzip error:', err.message);
          reject(err);
        });
      });
      
      req.on('error', (err) => {
        console.error('Request error:', err.message);
        tryNextUrl();
      });
      
      req.on('timeout', () => { 
        req.destroy(); 
        console.error('Download timeout, trying next URL...');
        tryNextUrl(); 
      });
    }

    function tryNextUrl() {
      urlIndex++;
      if (urlIndex < urls.length) {
        console.log(`🔄 Trying alternative URL (${urlIndex + 1}/${urls.length}): ${urls[urlIndex]}`);
        doGet(urls[urlIndex], 0);
      } else {
        reject(new Error('All download URLs failed (404 or network error). The PPRA may not have published data for this year yet.'));
      }
    }

    doGet(urls[urlIndex], 0);
  });
}

router.post('/ocds', async (req, res) => {
  try {
    const { year } = req.body;
    if (!year) return res.status(400).json({ success: false, error: 'Year is required' });
    
    console.log(`🚀 Starting OCDS sync for year ${year}...`);
    
    // FIXED: Removed ON CONFLICT clause which was crashing the DB query
    const { rows } = await pool.query(
      "INSERT INTO ocds_sync_log (year, status) VALUES ($1, 'running') RETURNING id", 
      [year]
    );
    
    // Return HTTP 200 immediately
    res.json({ success: true, message: 'Sync started in background', logId: rows[0].id });
    
    // Process in setImmediate after response is sent
    setImmediate(async () => {
      try {
        const result = await fetchAndIngest(year, rows[0].id);
        await pool.query("UPDATE ocds_sync_log SET status='complete', finished_at=NOW() WHERE id=$2", [result.inserted, rows[0].id]);
        console.log(`✅ OCDS sync completed successfully: ${result.inserted} new contracts imported`);
        if (req.app.locals.broadcast && result.inserted > 0) {
          req.app.locals.broadcast('new_contracts', { message: result.inserted + ' new contracts imported', count: result.inserted, year });
        }
      } catch (e) {
        console.error('❌ Sync background error:', e.message);
        await pool.query("UPDATE ocds_sync_log SET status='failed', error_msg=$1, finished_at=NOW() WHERE id=$2", [e.message, rows[0].id]);
      }
    });
  } catch (e) { 
    console.error('❌ Sync endpoint error:', e);
    res.status(500).json({ success: false, error: e.message || String(e) }); 
  }
});

router.get('/status', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM ocds_sync_log ORDER BY started_at DESC LIMIT 5");
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
module.exports.fetchAndIngest = fetchAndIngest;
