const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { resolveDatabaseUrl, getPoolSslConfig } = require('../utils/databaseUrl');

const connectionString = resolveDatabaseUrl();
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

async function run() {
  const sqlPath = path.join(__dirname, 'ensure-inspection-schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(/;\s*\r?\n/)
    .map((stmt) => stmt.replace(/--[^\n]*/g, '').trim())
    .filter((stmt) => stmt.length > 0);

  const client = new Client({
    connectionString,
    ssl: getPoolSslConfig(connectionString),
  });

  await client.connect();
  try {
    for (const statement of statements) {
      try {
        await client.query(statement);
        console.log('OK:', statement.slice(0, 70).replace(/\s+/g, ' '));
      } catch (error) {
        const msg = error.message || '';
        if (
          msg.includes('already exists') ||
          msg.includes('duplicate key') ||
          (msg.includes('does not exist') && msg.includes('constraint'))
        ) {
          console.log('SKIP:', msg.slice(0, 100));
        } else {
          throw error;
        }
      }
    }

    const check = await client.query("SELECT to_regclass('public.inspection_item') AS table_name");
    console.log('inspection_item table:', check.rows[0].table_name || 'missing');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
