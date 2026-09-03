const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false, 
  connectionTimeoutMillis: 20000, 
  idleTimeoutMillis: 30000,
  max: 10 
});

pool.on('error', (err) => console.error('⚠️ DB Pool Error:', err.message));

const initDB = async () => {
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Connected to PostgreSQL');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY, contract_id VARCHAR(120) UNIQUE NOT NULL, description TEXT NOT NULL,
        county VARCHAR(100), sector VARCHAR(100), value BIGINT DEFAULT 0, supplier VARCHAR(300),
        supplier_reg_date DATE, bid_type VARCHAR(50) DEFAULT 'open', awarded_date DATE,
        risk_score INTEGER DEFAULT 0, risk_level VARCHAR(10) DEFAULT 'LOW', flags JSONB DEFAULT '[]',
        status VARCHAR(30) DEFAULT 'active', procuring_entity VARCHAR(300), ocds_ocid VARCHAR(120),
        source VARCHAR(50) DEFAULT 'manual', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY, case_number VARCHAR(25) UNIQUE NOT NULL, type VARCHAR(120) NOT NULL,
        county VARCHAR(100), sector VARCHAR(100), description TEXT NOT NULL, amount BIGINT,
        anonymous BOOLEAN DEFAULT true, status VARCHAR(30) DEFAULT 'pending', ai_credibility_score INTEGER DEFAULT 50,
        routing VARCHAR(20) DEFAULT 'EACC', keywords JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ghost_projects (
        id SERIAL PRIMARY KEY, contract_ref VARCHAR(120), project_name VARCHAR(300) NOT NULL,
        county VARCHAR(100), sector VARCHAR(100), claimed_status VARCHAR(200), satellite_status VARCHAR(200),
        amount_at_risk BIGINT DEFAULT 0, detection_status VARCHAR(20) DEFAULT 'flagged', confidence_score INTEGER DEFAULT 0,
        latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, satellite_image_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ocds_sync_log (
        id SERIAL PRIMARY KEY, year INTEGER UNIQUE, status VARCHAR(20) DEFAULT 'pending', records INTEGER DEFAULT 0,
        error_msg TEXT, started_at TIMESTAMPTZ DEFAULT NOW(), finished_at TIMESTAMPTZ
      );
    `);

    // Check if we need to seed data
    const { rowCount } = await client.query('SELECT 1 FROM contracts LIMIT 1');
    if (rowCount === 0) {
      console.log('🌱 Seeding database with 47-county contract data...');
      
      const counties = [
        'Mombasa','Kwale','Kilifi','Tana River','Lamu','Taita Taveta','Garissa','Wajir','Mandera','Marsabit',
        'Isiolo','Meru','Tharaka Nithi','Embu','Kitui','Machakos','Makueni','Nyandarua','Nyeri','Kirinyaga',
        "Murang'a",'Kiambu','Turkana','West Pokot','Samburu','Trans Nzoia','Uasin Gishu','Elgeyo Marakwet',
        'Nandi','Baringo','Laikipia','Nakuru','Narok','Kajiado','Kericho','Bomet','Kakamega','Vihiga','Bungoma',
        'Busia','Siaya','Kisumu','Homa Bay','Migori','Kisii','Nyamira','Nairobi'
      ];

      const sectors = ['Roads', 'Health', 'Education', 'Water', 'Agriculture', 'ICT', 'Security', 'Infrastructure'];
      const seedData = [];

      // Generate 2 high-profile contracts per county (94 total)
      counties.forEach((county, index) => {
        const sector = sectors[index % sectors.length];
        const year = 2023 + (index % 2);
        
        // Contract 1: High Risk / Suspicious
        seedData.push([
          `KE-${county.substring(0,3).toUpperCase()}-${year}-001`,
          `Construction of ${sector.toLowerCase()} facilities in ${county} County Phase 1`,
          county, sector, Math.floor(Math.random() * 500000000) + 100000000,
          `${county} Builders Ltd`, '2022-01-01', 'single_source', `${year}-06-15`,
          85, 'HIGH', '["Single-source award", "Company registered 3 months prior", "Director linked to official"]',
          `${county} County Government`, 'manual'
        ]);

        // Contract 2: Low Risk / Clean
        seedData.push([
          `KE-${county.substring(0,3).toUpperCase()}-${year}-002`,
          `Supply of essential ${sector.toLowerCase()} equipment for ${county} region`,
          county, sector, Math.floor(Math.random() * 50000000) + 5000000,
          `National ${sector} Suppliers Co-op`, '2015-05-10', 'open', `${year}-08-20`,
          15, 'LOW', '["Open competitive bidding", "Verified track record", "Within market benchmark"]',
          `Ministry of ${sector}`, 'manual'
        ]);
      });

      const vals = seedData.map((_, i) => `($${i*13+1},$${i*13+2},$${i*13+3},$${i*13+4},$${i*13+5},$${i*13+6},$${i*13+7},$${i*13+8},$${i*13+9},$${i*13+10},$${i*13+11},$${i*13+12},$${i*13+13})`).join(',');
      const flat = seedData.flat();
      
      await client.query(`INSERT INTO contracts 
        (contract_id, description, county, sector, value, supplier, supplier_reg_date, bid_type, awarded_date, risk_score, risk_level, flags, procuring_entity, source) 
        VALUES ${vals} ON CONFLICT (contract_id) DO NOTHING`, flat);
      
      console.log(`✅ Seeded ${seedData.length} contracts across all 47 counties.`);
    }
  } catch (err) {
    console.error('❌ DB Init Error:', err.message);
  } finally {
    if (client) client.release();
  }
};

module.exports = { pool, initDB };
