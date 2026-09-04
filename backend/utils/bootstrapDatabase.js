const fs = require('fs');
const path = require('path');
const { restoreReferenceDataIfEmpty, restoreSampleCasesAndDefects, restoreReferenceData, countNonAdminHouseholds } = require('./restoreReferenceData');
const { ensureInspectionSchema } = require('./ensureInspectionSchema');
const { ensureAdminUser } = require('./ensureAdminUser');
const { ensureInspectorRegistrationSchema } = require('./ensureInspectorRegistrationSchema');
const { ensureDefectResolutionSchema } = require('./ensureDefectResolutionSchema');
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
        (msg.includes('does not exist') && msg.includes('constraint'))
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
  await client.query(
    `ALTER TABLE household ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now()`
  );
  // 기존 세대: 최초 케이스/토큰 시각으로 등록일 보정
  await client.query(`
    UPDATE household h
    SET created_at = COALESCE(
      (
        SELECT MIN(ch.created_at)
        FROM case_header ch
        WHERE ch.household_id = h.id
      ),
      (
        SELECT MIN(at.starts_at)
        FROM access_token at
        WHERE at.household_id = h.id
      ),
      NOW()
    )
    WHERE h.created_at IS NULL
  `);
}

async function bootstrapDatabase(pool) {
  if (!pool) {
    return { ok: false, reason: 'pool missing' };
  }

  const migrationFiles = [
    'scripts/init-db.sql',
    'scripts/ensure-core-schema.sql',
    'scripts/ensure-inspection-schema.sql',
    'scripts/ensure-file-storage.sql',
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

    const inspectionSchema = await ensureInspectionSchema(pool);
    if (!inspectionSchema.ok) {
      console.warn('[bootstrap] inspection schema ensure incomplete');
    }

    try {
      const adminEnsure = await ensureAdminUser(client);
      console.log('[bootstrap] admin user:', adminEnsure);
    } catch (error) {
      console.error('[bootstrap] ensureAdminUser failed:', error.message);
    }

    try {
      const inspectorSchema = await ensureInspectorRegistrationSchema(client);
      console.log('[bootstrap] inspector_registration:', inspectorSchema);
    } catch (error) {
      console.error('[bootstrap] ensureInspectorRegistrationSchema failed:', error.message);
    }

    try {
      const resolutionSchema = await ensureDefectResolutionSchema(client);
      console.log('[bootstrap] defect_resolution:', resolutionSchema);
    } catch (error) {
      console.error('[bootstrap] ensureDefectResolutionSchema failed:', error.message);
    }

    const defectCount = await client.query('SELECT COUNT(*)::int AS n FROM defect');
    if (defectCount.rows[0].n === 0) {
      console.log('[bootstrap] no defects found — restoring reference data');
      try {
        const nonAdmin = await countNonAdminHouseholds(client);
        if (nonAdmin === 0) {
          await restoreReferenceData(client);
        } else {
          await restoreSampleCasesAndDefects(client);
        }
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
