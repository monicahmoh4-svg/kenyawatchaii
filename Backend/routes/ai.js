const router = require('express').Router();
const https = require('https');
const { pool } = require('../db/index');

router.post('/chat', async (req, res) => {
  const { message, session_id } = req.body || {};
  if (!message) return res.status(400).json({ success: false, error: 'message required' });
  if (!process.env.GEMINI_API_KEY) return res.json({ success: true, reply: '⚠️ Set GEMINI_API_KEY in Render environment variables.', fallback: true });

  try {
    const [cRes] = await Promise.all([pool.query("SELECT contract_id, county, value, risk_level FROM contracts ORDER BY risk_score DESC LIMIT 5")]);
    const liveCtx = `\nLIVE DATA:\n` + cRes.rows.map(c => `- ${c.contract_id} | ${c.county} | KES ${c.value} | ${c.risk_level}`).join('\n');
    const systemText = `You are KenyaWatch AI, an expert anti-corruption investigator for Kenya. Use PPADA 2015 and EACC patterns. Be specific, cite contract IDs, use **bold** for risks. Keep under 300 words.\n${liveCtx}`;
    
    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 800 }
    });

    const options = { 
      hostname: 'generativelanguage.googleapis.com', 
      path: '/v1beta/models/gemini-2.5-flash:generateContent', 
      method: 'POST', 
      headers: { 
        'Content-Type': 'application/json', 
        'x-goog-api-key': process.env.GEMINI_API_KEY, 
        'Content-Length': Buffer.byteLength(body) 
      } 
    };
    
    const reqHttps = https.request(options, (resp) => {
      let raw = '';
      resp.on('data', chunk => { raw += chunk; });
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const text = (parsed.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
          res.json({ success: true, reply: text || 'Could not process.', fallback: false });
        } catch (e) { res.json({ success: true, reply: 'AI parsing error.', fallback: true }); }
      });
    });
    reqHttps.on('error', () => res.json({ success: true, reply: 'Network error.', fallback: true }));
    reqHttps.write(body);
    reqHttps.end();
  } catch (e) { res.json({ success: true, reply: 'AI error: ' + e.message, fallback: true }); }
});

module.exports = router;
