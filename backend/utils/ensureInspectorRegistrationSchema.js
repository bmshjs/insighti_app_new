/**
 * inspector_registration 테이블·인덱스·암호화 컬럼을 idempotent 하게 보장합니다.
 * (부트스트랩 SQL 파서가 FK 오류를 삼켜 테이블이 안 만들어지는 경우 복구)
 */
async function ensureInspectorRegistrationSchema(poolOrClient) {
  const ownsClient = typeof poolOrClient.connect === 'function';
  const client = ownsClient ? await poolOrClient.connect() : poolOrClient;

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS inspector_registration (
        id SERIAL PRIMARY KEY,
        complex_id INTEGER REFERENCES complex(id),
        dong TEXT NOT NULL,
        ho TEXT NOT NULL,
        inspector_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        company_name TEXT,
        license_number TEXT,
        email TEXT,
        registration_reason TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        approved_by INTEGER REFERENCES admin_user(id),
        approved_at TIMESTAMP,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `);

    await client.query(`
      ALTER TABLE inspector_registration
        ADD COLUMN IF NOT EXISTS inspector_name_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS phone_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS email_encrypted TEXT
    `);

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_inspector_registration_status ON inspector_registration(status)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_inspector_registration_complex ON inspector_registration(complex_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_inspector_registration_created ON inspector_registration(created_at)`
    );

    return { ok: true };
  } finally {
    if (ownsClient) {
      client.release();
    }
  }
}

module.exports = { ensureInspectorRegistrationSchema };
