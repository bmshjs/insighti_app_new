const fs = require('fs');
const path = require('path');

/**
 * DB 연결 후 스키마·점검원 계정·하자 카테고리를 idempotent 하게 준비합니다.
 */
async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1
     LIMIT 1`,
    [tableName]
  );
  return result.rows.length > 0;
}

async function runSqlFile(client, relativePath) {
  const sqlPath = path.join(__dirname, '..', relativePath);
  if (!fs.existsSync(sqlPath)) {
    console.warn(`[bootstrap] skip missing file: ${relativePath}`);
    return;
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(/;\s*\r?\n/)
    .map((stmt) => stmt.replace(/--[^\n]*/g, '').trim())
    .filter((stmt) => stmt.length > 0);

  for (const statement of statements) {
    try {
      await client.query(statement);
    } catch (error) {
      const msg = error.message || '';
      if (
        msg.includes('already exists') ||
        msg.includes('duplicate key') ||
        msg.includes('duplicate_object') ||
        msg.includes('does not exist') && msg.includes('constraint')
      ) {
        continue;
      }
      throw error;
    }
  }
}

async function bootstrapDatabase(pool) {
  if (!pool) {
    return { ok: false, reason: 'pool missing' };
  }

  const migrationFiles = [
    'scripts/init-db.sql',
    'scripts/ensure-core-schema.sql',
    'scripts/migrate-phase1.sql',
    'scripts/migrate-inspector-registration.sql',
    'scripts/migrate-encrypt-personal-data.sql',
    'scripts/migrate-inspection-photos.sql',
    'scripts/migrate-push-notifications.sql',
    '../../db/migrations/001_pdf_form_columns.sql',
    '../../db/migrations/002_defect_categories.sql',
  ];

  let client;
  try {
    client = await pool.connect();

    const hasComplex = await tableExists(client, 'complex');
    if (!hasComplex) {
      console.log('[bootstrap] fresh database detected, applying schema...');
    }

    for (const file of migrationFiles) {
      console.log(`[bootstrap] running ${file}`);
      await runSqlFile(client, file);
    }

    return { ok: true };
  } catch (error) {
    console.error('[bootstrap] failed:', error.message);
    return { ok: false, reason: error.message };
  } finally {
    if (client) {
      client.release();
    }
  }
}

module.exports = { bootstrapDatabase };
