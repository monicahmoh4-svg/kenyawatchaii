const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false, 
  connectionTimeoutMillis: 30000, 
  max: 20 
});

const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id               SERIAL PRIMARY KEY,
        contract_id      VARCHAR(120) UNIQUE NOT NULL,
        description      TEXT         NOT NULL,
        county           VARCHAR(100),
        sector           VARCHAR(100),
        value            BIGINT       DEFAULT 0,
        supplier         VARCHAR(300),
        supplier_reg_date DATE,
        bid_type         VARCHAR(50)  DEFAULT 'open',
        awarded_date     DATE,
        risk_score       INTEGER      DEFAULT 0,
        risk_level       VARCHAR(10)  DEFAULT 'LOW',
        flags            JSONB        DEFAULT '[]',
        status           VARCHAR(30)  DEFAULT 'active',
        procuring_entity VARCHAR(300),
        ocds_ocid        VARCHAR(120),
        source           VARCHAR(50)  DEFAULT 'manual',
        created_at       TIMESTAMPTZ  DEFAULT NOW(),
        updated_at       TIMESTAMPTZ  DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS reports (
        id                   SERIAL PRIMARY KEY,
        case_number          VARCHAR(25) UNIQUE NOT NULL,
        type                 VARCHAR(120) NOT NULL,
        county               VARCHAR(100),
        sector               VARCHAR(100),
        description          TEXT         NOT NULL,
        amount               BIGINT,
        anonymous            BOOLEAN      DEFAULT true,
        status               VARCHAR(30)  DEFAULT 'pending',
        ai_credibility_score INTEGER      DEFAULT 50,
        routing              VARCHAR(20)  DEFAULT 'EACC',
        keywords             JSONB        DEFAULT '[]',
        created_at           TIMESTAMPTZ  DEFAULT NOW(),
        updated_at           TIMESTAMPTZ  DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ghost_projects (
        id                 SERIAL PRIMARY KEY,
        contract_ref       VARCHAR(120),
        project_name       VARCHAR(300) NOT NULL,
        county             VARCHAR(100),
        sector             VARCHAR(100),
        claimed_status     VARCHAR(300),
        satellite_status   VARCHAR(300),
        amount_at_risk     BIGINT       DEFAULT 0,
        detection_status   VARCHAR(20)  DEFAULT 'ghost',
        confidence_score   INTEGER      DEFAULT 0,
        latitude           DOUBLE PRECISION,
        longitude          DOUBLE PRECISION,
        satellite_image_url TEXT,
        satellite_provider VARCHAR(50),
        satellite_zoom     INTEGER      DEFAULT 17,
        last_satellite_check TIMESTAMPTZ,
        satellite_metadata JSONB        DEFAULT '{}',
        created_at         TIMESTAMPTZ  DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ocds_sync_log (
        id          SERIAL PRIMARY KEY,
        year        INTEGER,
        status      VARCHAR(20)  DEFAULT 'pending',
        records     INTEGER      DEFAULT 0,
        error_msg   TEXT,
        started_at  TIMESTAMPTZ  DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS chat_logs (
        id         SERIAL PRIMARY KEY,
        session_id VARCHAR(120),
        role       VARCHAR(20),
        content    TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    const { rowCount } = await client.query('SELECT 1 FROM contracts LIMIT 1');
    if (rowCount === 0) {
      // Rich, realistic seed data across multiple Kenyan counties
      const contracts = [
        ['KE-NBO-2024-0001', 'Rehabilitation of Waiyaki Way, Nairobi', 'Nairobi', 'Roads', 1500000000, 'China Road and Bridge Corp', 'open', 15, 'LOW', '["Established international contractor", "Open competitive bidding"]', 'Kenya National Highways Authority'],
        ['KE-NBO-2024-0002', 'Supply of Medical Equipment to KNH', 'Nairobi', 'Health', 450000000, 'MediSupply Kenya Ltd', 'single_source', 88, 'HIGH', '["Single-source award", "Price 250% above market benchmark", "Company registered 3 months prior"]', 'Ministry of Health'],
        ['KE-MBA-2024-0003', 'Construction of Likoni Ferry Terminal', 'Mombasa', 'Infrastructure', 890000000, 'Coastal Builders Ltd', 'open', 25, 'LOW', '["Open competitive tender", "Verified track record"]', 'Kenya Ferry Services'],
        ['KE-KIS-2024-0004', 'Lake Victoria Water Intake Expansion', 'Kisumu', 'Water', 650000000, 'AquaTech Solutions', 'restricted', 65, 'MEDIUM', '["Restricted tender without full PPRA justification"]', 'Lake Victoria South Water Services'],
        ['KE-KIA-2024-0005', 'Kiambu County Referral Hospital Upgrade', 'Kiambu', 'Health', 320000000, 'HealthBuild Contractors', 'open', 20, 'LOW', '["Open competitive bidding", "World Bank co-funded"]', 'Kiambu County Government'],
        ['KE-NAK-2024-0006', 'Nakuru City Street Lighting Project', 'Nakuru', 'ICT', 120000000, 'BrightLights Kenya', 'single_source', 82, 'HIGH', '["Single-source award KES 120M", "Director linked to county official"]', 'Nakuru County Government'],
        ['KE-KII-2024-0007', 'Kisii Central Market Renovation', 'Kisii', 'Infrastructure', 45000000, 'Kisii Builders Co', 'open', 18, 'LOW', '["Open competitive tender", "Community verified"]', 'Kisii County Government'],
        ['KE-TUR-2024-0008', 'Turkana North Girls Secondary School', 'Turkana', 'Education', 98000000, 'Northlands Builders', 'single_source', 96, 'HIGH', '["Ghost project confirmed by satellite", "Company 2 months old at award", "No physical construction detected"]', 'Turkana County Government'],
        ['KE-GAR-2024-0009', 'Garissa County Borehole Drilling (50 units)', 'Garissa', 'Water', 75000000, 'AquaDrill East Africa', 'open', 30, 'LOW', '["Open competitive tender", "UNICEF co-funded"]', 'Garissa County Government'],
        ['KE-MER-2024-0010', 'Meru Tea Factory Modernization', 'Meru', 'Agriculture', 210000000, 'Tecalemit Kenya Ltd', 'open', 22, 'LOW', '["Established firm", "Farmer co-operative verified"]', 'Meru County Government'],
        ['KE-KAK-2024-0011', 'Kakamega Urban Roads Drainage', 'Kakamega', 'Roads', 180000000, 'RoadWorks West', 'restricted', 70, 'MEDIUM', '["Partial completion detected", "Restricted tender process"]', 'Kakamega County Government'],
        ['KE-NAT-2024-0012', 'National Fertilizer Subsidy Programme', 'National', 'Agriculture', 3200000000, 'AgriChem Solutions Ltd', 'single_source', 97, 'HIGH', '["Single-source award KES 3.2B", "Company only 4 months old at award", "No competitive bidding"]', 'National Cereals and Produce Board'],
        ['KE-NAT-2024-0013', 'National ID Digitisation System Upgrade', 'National', 'ICT', 3500000000, 'Idemia Group France', 'negotiated', 25, 'LOW', '["Strategic negotiated procurement", "Proprietary system justified"]', 'National Registration Bureau'],
        ['KE-BAR-2024-0014', 'Baringo County ECDE Classrooms Construction', 'Baringo', 'Education', 55000000, 'Rift Valley Builders', 'open', 20, 'LOW', '["Open competitive tender"]', 'Baringo County Government'],
        ['KE-KIL-2024-0015', 'Kilifi County Coconut Value Chain Support', 'Kilifi', 'Agriculture', 85000000, 'CoastalAgri Ltd', 'open', 15, 'LOW', '["IFAD co-funded", "Open tender"]', 'Kilifi County Government'],
        ['KE-MAN-2024-0016', 'Mandera Border Post Upgrading', 'Mandera', 'Infrastructure', 120000000, 'Frontier Construction', 'single_source', 85, 'HIGH', '["Single-source award", "Company 5 months old"]', 'Mandera County Government'],
        ['KE-WAJ-2024-0017', 'Wajir Solar Water Kiosks (20 units)', 'Wajir', 'Water', 45000000, 'SolarWater Kenya', 'open', 35, 'LOW', '["GIZ co-funded", "Open tender"]', 'Wajir County Government'],
        ['KE-NYE-2024-0018', 'Nyeri County Coffee Processing Plant', 'Nyeri', 'Agriculture', 150000000, 'Highland Processors', 'open', 20, 'LOW', '["Open competitive bidding"]', 'Nyeri County Government'],
        ['KE-UAS-2024-0019', 'Uasin Gishu Eldoret Ring Road Bypass', 'Uasin Gishu', 'Roads', 1450000000, 'Sinohydro Corporation', 'open', 18, 'LOW', '["Established international contractor", "KfW co-financed"]', 'Kenya National Highways Authority'],
        ['KE-MAC-2024-0020', 'Machakos County Integrated Revenue System', 'Machakos', 'ICT', 65000000, 'RevTech Systems', 'single_source', 80, 'HIGH', '["Single-source KES 65M", "Director is relative of county treasurer"]', 'Machakos County Treasury'],
        ['KE-KER-2024-0021', 'Kericho County Tea Road Rehabilitation', 'Kericho', 'Roads', 230000000, 'Mau Escarpment Builders', 'open', 25, 'LOW', '["Open competitive tender"]', 'Kericho County Government'],
        ['KE-HOM-2024-0022', 'Homa Bay County Referral Hospital Equipment', 'Homa Bay', 'Health', 110000000, 'MedEquip Africa', 'single_source', 78, 'HIGH', '["Single-source award", "Price 180% above KEMSA benchmark"]', 'Homa Bay County Government'],
        ['KE-NYA-2024-0023', 'Nyandarua County Potato Cold Storage', 'Nyandarua', 'Agriculture', 95000000, 'ColdChain Kenya', 'open', 30, 'LOW', '["Open competitive tender", "EU co-funded"]', 'Nyandarua County Government'],
        ['KE-LAI-2024-0024', 'Laikipia County Wildlife Conservancy Fencing', 'Laikipia', 'Security', 175000000, 'Safeguard Fencing Ltd', 'open', 22, 'LOW', '["Open competitive bidding"]', 'Laikipia County Government']
      ];

      const vals = contracts.map((_, i) => `($${i*11+1},$${i*11+2},$${i*11+3},$${i*11+4},$${i*11+5},$${i*11+6},$${i*11+7},$${i*11+8},$${i*11+9},$${i*11+10},$${i*11+11})`).join(',');
      const flat = contracts.flat();
      
      await client.query(`INSERT INTO contracts 
        (contract_id, description, county, sector, value, supplier, bid_type, risk_score, risk_level, flags, procuring_entity, source) 
        VALUES ${vals} ON CONFLICT (contract_id) DO NOTHING`, flat);
      
      // Seed Ghost Projects
      await client.query(`INSERT INTO ghost_projects (contract_ref, project_name, county, claimed_status, satellite_status, amount_at_risk, detection_status, confidence_score, latitude, longitude) VALUES 
        ('KE-TUR-2024-0008','Turkana North Girls Secondary School','Turkana','100% complete','Empty scrubland, no structures',98000000,'ghost',96,3.1121,35.5986),
        ('KE-KIA-2024-0005','Kiambu Girls Secondary 8 Classrooms','Kiambu','100% complete','Bare undisturbed land',28000000,'ghost',96,-1.1731,36.8328)`);
    }
    console.log('✅ Database tables verified and seeded');
  } finally {
    client.release();
  }
};

module.exports = { pool, initDB };
