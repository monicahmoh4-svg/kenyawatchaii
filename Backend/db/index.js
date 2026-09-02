const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false, 
  connectionTimeoutMillis: 30000, 
  max: 20 
});

const initDB = async () => {
  const client = await pool.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS contracts (
      id SERIAL PRIMARY KEY, contract_id VARCHAR(120) UNIQUE, description TEXT, county VARCHAR(100), 
      sector VARCHAR(100), value BIGINT DEFAULT 0, supplier VARCHAR(300), bid_type VARCHAR(50), 
      awarded_date DATE, risk_score INTEGER DEFAULT 0, risk_level VARCHAR(10) DEFAULT 'LOW', 
      flags JSONB DEFAULT '[]', source VARCHAR(50) DEFAULT 'manual', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY, case_number VARCHAR(25) UNIQUE, type VARCHAR(120), county VARCHAR(100), 
      description TEXT, amount BIGINT, anonymous BOOLEAN DEFAULT true, status VARCHAR(30) DEFAULT 'pending', 
      ai_credibility_score INTEGER DEFAULT 50, routing VARCHAR(20) DEFAULT 'EACC', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ghost_projects (
      id SERIAL PRIMARY KEY, contract_ref VARCHAR(120), project_name VARCHAR(300), county VARCHAR(100), 
      claimed_status VARCHAR(200), satellite_status VARCHAR(200), amount_at_risk BIGINT DEFAULT 0, 
      detection_status VARCHAR(20) DEFAULT 'flagged', confidence_score INTEGER DEFAULT 0, 
      latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, satellite_image_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ocds_sync_log (
      id SERIAL PRIMARY KEY, year INTEGER, status VARCHAR(20) DEFAULT 'pending', records INTEGER DEFAULT 0, 
      started_at TIMESTAMPTZ DEFAULT NOW(), finished_at TIMESTAMPTZ
    );
  `);
  
  const { rowCount } = await client.query('SELECT 1 FROM contracts LIMIT 1');
  if (rowCount === 0) {
    await client.query(`INSERT INTO contracts (contract_id, description, county, sector, value, supplier, bid_type, risk_score, risk_level, flags, source) VALUES 
    ('KE-AGR-2025-0005','Fertiliser supply 47 counties','National','Agriculture',3200000000,'AgriChem Solutions Ltd','single_source',97,'HIGH','["Single-source","Company 4 months old"]','manual'),
    ('KE-EDU-2024-0112','Kiambu Girls Secondary 8 Classrooms','Kiambu','Education',28000000,'BuildRight Ltd','single_source',96,'HIGH','["Company 4 months old"]','manual'),
    ('KE-RDS-2025-0011','Kisumu-Kakamega highway dualling','Kisumu','Roads',1850000000,'China Road and Bridge Corp','open',20,'LOW','["Established contractor"]','manual')`);
    
    await client.query(`INSERT INTO ghost_projects (contract_ref, project_name, county, claimed_status, satellite_status, amount_at_risk, detection_status, confidence_score, latitude, longitude) VALUES 
    ('KE-EDU-2024-0112','Kiambu Girls Secondary 8 Classrooms','Kiambu','Complete','Bare undisturbed land',28000000,'ghost',96,-1.1731,36.8328),
    ('KE-RDS-2024-0043','Tana River-Garissa Road 35km','Tana River','Rehabilitated','Road surface unchanged',285000000,'ghost',94,-1.4617,40.1364)`);
    
    await client.query(`INSERT INTO reports (case_number, type, county, description, amount, anonymous, ai_credibility_score, routing) VALUES 
    ('KW-2026-1001','Bribery','Nairobi','Officer demanded 2M kickback',2000000,true,91,'DPP'),
    ('KW-2026-1002','Ghost project','Kiambu','Classrooms do not exist',28000000,true,95,'EACC')`);
  }
  client.release();
};
module.exports = { pool, initDB };