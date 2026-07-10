const fs = require('fs');
const path = require('path');

const SCHEMA_FILE = 'scripts/ensure-inspection-schema.sql';

function parseSqlStatements(sql) {
  return sql
    .split(/;\s*\r?\n/)
    .map((stmt) => stmt.replace(/--[^\n]*/g, '').trim())
    .filter((stmt) => stmt.length > 0);
}

function isIgnorableSchemaError(message) {
  const msg = message || '';
  return (
    msg.includes('already exists') ||
    msg.includes('duplicate key') ||
    msg.includes('duplicate_object') ||
    (msg.includes('does not exist') && msg.includes('constraint')) ||
    (msg.includes('does not exist') && msg.includes('relation'))
  );
}

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

async function ensureInspectionSchema(pool) {
  if (!pool) {
    return { ok: false, reason: 'pool missing' };
  }

  const sqlPath = path.join(__dirname, '..', SCHEMA_FILE);
  if (!fs.existsSync(sqlPath)) {
    return { ok: false, reason: `missing ${SCHEMA_FILE}` };
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = parseSqlStatements(sql);
  const client = await pool.connect();

  try {
    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (error) {
        if (!isIgnorableSchemaError(error.message)) {
          throw error;
        }
      }
    }

    const hasTable = await tableExists(client, 'inspection_item');
    return { ok: hasTable, inspection_item: hasTable };
  } finally {
    client.release();
  }
}

module.exports = { ensureInspectionSchema, tableExists };
