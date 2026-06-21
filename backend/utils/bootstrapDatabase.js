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
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(';')
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0 && !stmt.startsWith('--'));

  for (const statement of statements) {
    try {
      await client.query(statement);
    } catch (error) {
      const msg = error.message || '';
      if (
        msg.includes('already exists') ||
        msg.includes('duplicate key') ||
        msg.includes('duplicate_object')
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

  let client;
  try {
    client = await pool.connect();

    const hasComplex = await tableExists(client, 'complex');
    if (!hasComplex) {
      console.log('[bootstrap] core schema initializing...');
      await runSqlFile(client, 'scripts/init-db.sql');
      console.log('[bootstrap] core schema ready');
    }

    const hasDefectCategories = await tableExists(client, 'defect_categories');
    if (!hasDefectCategories) {
      console.log('[bootstrap] defect_categories migration running...');
      await runSqlFile(client, '../../db/migrations/002_defect_categories.sql');
      console.log('[bootstrap] defect_categories ready');
    } else {
      const countResult = await client.query('SELECT COUNT(*)::int AS cnt FROM defect_categories');
      if (countResult.rows[0].cnt === 0) {
        console.log('[bootstrap] defect_categories empty, seeding...');
        await runSqlFile(client, '../../db/migrations/002_defect_categories.sql');
      }
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
