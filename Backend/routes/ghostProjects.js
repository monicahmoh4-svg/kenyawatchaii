const router = require('express').Router();
const { pool } = require('../db/index');

const getSatelliteUrl = (lat, lng) => {
  if (process.env.GOOGLE_MAPS_API_KEY) return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=640x400&maptype=satellite&markers=color:red|size:mid|${lat},${lng}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/${Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 32768)}/${Math.floor((lng + 180) / 360 * 32768)}`;
};

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM ghost_projects ORDER BY CASE detection_status WHEN 'ghost' THEN 1 WHEN 'partial' THEN 2 ELSE 3 END, amount_at_risk DESC");
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/:id/refresh-satellite', async (req, res) => {
  try {
    const { rows: proj } = await pool.query("SELECT latitude, longitude FROM ghost_projects WHERE id=$1", [req.params.id]);
    if (!proj.length) return res.status(404).json({ success: false, error: 'Not found' });
    const url = getSatelliteUrl(proj[0].latitude, proj[0].longitude);
    const { rows } = await pool.query("UPDATE ghost_projects SET satellite_image_url=$1 WHERE id=$2 RETURNING *", [url, req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
module.exports = router;