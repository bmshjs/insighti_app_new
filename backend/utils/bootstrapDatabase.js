const fs = require('fs');
const path = require('path');
const { restoreReferenceDataIfEmpty, restoreSampleCasesAndDefects, restoreReferenceData } = require('./restoreReferenceData');
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
        (msg.includes('does not exist') && msg.includes('constraint')) ||
        (msg.includes('does not exist') && msg.includes('relation'))
      ) {
        continue;
      }
      throw error;
    }
  }
}

async function ensureHouseholdColumns(client) {
  await client.query(
    `ALTER TABLE household ADD COLUMN IF NOT EXISTS user_type TEXT DEFAULT 'resident'`
  );
  await client.query(
    `ALTER TABLE household ADD COLUMN IF NOT EXISTS resident_name_encrypted TEXT`
  );
  await client.query(
    `ALTER TABLE household ADD COLUMN IF NOT EXISTS phone_encrypted TEXT`
  );
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

    console.log('[bootstrap] ensuring household columns...');
    await ensureHouseholdColumns(client);

    const hasComplex = await tableExists(client, 'complex');
    if (!hasComplex) {
      console.log('[bootstrap] fresh database detected, applying schema...');
    }

    for (const file of migrationFiles) {
      console.log(`[bootstrap] running ${file}`);
      await runSqlFile(client, file);
    }

    const defectCount = await client.query('SELECT COUNT(*)::int AS n FROM defect');
    if (defectCount.rows[0].n === 0) {
      console.log('[bootstrap] no defects found — restoring reference data');
      try {
        await restoreReferenceData(client);
        await restoreSampleCasesAndDefects(client);
      } catch (error) {
        console.error('[bootstrap] reference restore failed:', error.message);
      }
    } else {
      await restoreReferenceDataIfEmpty(client);
      try {
        await restoreSampleCasesAndDefects(client);
      } catch (error) {
        console.error('[bootstrap] restoreSampleCasesAndDefects failed:', error.message);
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
