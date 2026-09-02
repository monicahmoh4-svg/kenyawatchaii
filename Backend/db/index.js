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
    console.log('✅ Database tables verified');
  } finally {
    client.release();
  }
};

module.exports = { pool, initDB };
