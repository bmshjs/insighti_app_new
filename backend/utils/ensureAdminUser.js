const bcrypt = require('bcryptjs');

const DEFAULT_ADMIN_EMAIL = 'admin@insighti.com';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

async function ensureAdminUserTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_user (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin')),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT now(),
      last_login TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_email ON admin_user(email)`);
}

/**
 * admin_user 테이블과 기본 관리자 계정을 보장합니다.
 * 기존 데이터가 있어도 관리자만 없으면 생성하고, 해시가 깨져 있으면 재설정합니다.
 */
async function ensureAdminUser(poolOrClient) {
  const ownsClient = typeof poolOrClient.connect === 'function';
  const client = ownsClient ? await poolOrClient.connect() : poolOrClient;

  try {
    await ensureAdminUserTable(client);

    const existing = await client.query(
      `SELECT id, password_hash, is_active FROM admin_user WHERE email = $1 LIMIT 1`,
      [DEFAULT_ADMIN_EMAIL]
    );

    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

    if (existing.rows.length === 0) {
      await client.query(
        `INSERT INTO admin_user (email, password_hash, name, role, is_active)
         VALUES ($1, $2, $3, 'super_admin', true)`,
        [DEFAULT_ADMIN_EMAIL, passwordHash, 'Super Admin']
      );
      console.log(`[ensureAdmin] created ${DEFAULT_ADMIN_EMAIL}`);
      return { created: true, repaired: false };
    }

    const row = existing.rows[0];
    const hashOk = typeof row.password_hash === 'string' && row.password_hash.startsWith('$2');
    if (!hashOk || row.is_active === false) {
      await client.query(
        `UPDATE admin_user
         SET password_hash = $1, is_active = true, name = COALESCE(name, 'Super Admin'), role = 'super_admin'
         WHERE email = $2`,
        [passwordHash, DEFAULT_ADMIN_EMAIL]
      );
      console.log(`[ensureAdmin] repaired ${DEFAULT_ADMIN_EMAIL}`);
      return { created: false, repaired: true };
    }

    return { created: false, repaired: false };
  } finally {
    if (ownsClient) {
      client.release();
    }
  }
}

module.exports = {
  ensureAdminUser,
  ensureAdminUserTable,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
};
