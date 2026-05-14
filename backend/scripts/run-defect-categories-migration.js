// 마이그레이션: 하자 표준 DB (002_defect_categories.sql)
const path = require('path');
const fs = require('fs');
// backend/.env 우선 (어디서 실행하든). 셸에 이미 DATABASE_URL이 있어도 이 파일이 우선하도록 override.
const envCandidates = [
  path.join(__dirname, '..', '.env'),
  path.join(process.cwd(), 'backend', '.env'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '..', '.env'),
];
for (const p of envCandidates) {
  try {
    if (fs.existsSync(p)) {
      require('dotenv').config({ path: p, override: true });
      if (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) break;
    }
  } catch (e) {}
}
const { Client } = require('pg');

function getDatabaseUrl() {
  const u = process.env.DATABASE_URL && process.env.DATABASE_URL.trim();
  if (!u) {
    console.error('❌ DATABASE_URL이 없습니다. backend/.env 또는 프로젝트 루트 .env를 설정하세요.');
    process.exit(1);
  }
  return u;
}

async function migrate() {
  const url = getDatabaseUrl();
  const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
  const client = new Client({
    connectionString: url,
    ssl: isLocalhost ? false : { rejectUnauthorized: false }
  });

  const sqlPath = path.join(__dirname, '../../db/migrations/002_defect_categories.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const statements = sql
    .split(/;\s*\r?\n/)
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter((s) => s.length > 0);

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i] + ';';
      const preview = stmt.slice(0, 72).replace(/\s+/g, ' ') + '...';
      console.log(`📝 [${i + 1}/${statements.length}] ${preview}`);
      await client.query(stmt);
      console.log('   ✅ OK');
    }

    const count = await client.query('SELECT COUNT(*)::int AS n FROM defect_categories');
    console.log(`\n✅ Migration 002_defect_categories completed. defect_categories rows: ${count.rows[0].n}\n`);
  } catch (error) {
    const msg = error.message || String(error);
    console.error('❌ Migration failed:', msg);
    if (error.code) console.error('   code:', error.code);
    if (error.errors && error.errors[0]) console.error('   detail:', error.errors[0].message || error.errors[0]);
    process.exit(1);
  } finally {
    await client.end();
    console.log('✅ Database connection closed.\n');
  }
}

migrate();
