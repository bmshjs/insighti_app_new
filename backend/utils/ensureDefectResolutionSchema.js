/**
 * defect_resolution 테이블·인덱스를 idempotent 하게 보장합니다.
 * (admin_user FK 때문에 초기 마이그레이션이 실패·무시된 경우 복구)
 */
async function ensureDefectResolutionSchema(poolOrClient) {
  const ownsClient = typeof poolOrClient.connect === 'function';
  const client = ownsClient ? await poolOrClient.connect() : poolOrClient;

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS defect_resolution (
        id SERIAL PRIMARY KEY,
        defect_id TEXT REFERENCES defect(id),
        admin_user_id INTEGER REFERENCES admin_user(id),
        memo TEXT,
        contractor TEXT,
        worker TEXT,
        cost INTEGER,
        resolution_photos TEXT[],
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `);

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_resolution_defect ON defect_resolution(defect_id)`
    );

    return { ok: true };
  } finally {
    if (ownsClient) {
      client.release();
    }
  }
}

module.exports = { ensureDefectResolutionSchema };
